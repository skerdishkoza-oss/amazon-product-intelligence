/**
 * The run loop. Spec v1.1 sections 4, 8.2, 9.5, 10.3.
 *
 * This file owns the accounting contract. Every requested input is registered
 * before work starts; every discovered item is registered as it is enqueued;
 * every exit path settles all of them. The ceiling, charge-cap and
 * circuit-breaker checks live here in one visible place rather than inside a
 * crawler's request handler, because a handler that silently drops a request
 * would make the run summary lie.
 */

import type { BillingEvents } from '../billing/events.js';
import { parseSearchPage } from '../amazon/parsers/search.js';
import { parseProductPage } from '../amazon/parsers/product.js';
import { parseOffers } from '../amazon/parsers/offers.js';
import { parseSellerProfile, sellerProfileUrl } from '../amazon/parsers/seller.js';
import { getMarketplace } from '../amazon/marketplace-config/index.js';
import { canonicalProductUrl, classifyUrl, dedupeKey, locationKey, searchUrl } from '../input/normalizer.js';
import { includesBlock, usesEssentialProductEvent } from '../input/profiles.js';
import type { ValidatedInput } from '../input/validate.js';
import type { FetchResult, Fetcher } from '../fetch/types.js';
import { scoreCompleteness } from '../quality/completeness.js';
import { compareProduct, historyKey } from '../history/compare.js';
import { RunAccounting } from '../output/accounting.js';
import { DatasetSchemaError, type DatasetWriter } from '../output/dataset-writer.js';
import { projectRecordToBlocks } from '../output/profile-projector.js';
import {
    buildFailureRecord,
    buildProductRecord,
    emptyAvailability,
    emptyBuyBox,
    emptyMonitoring,
    emptyOffers,
    emptyProductContent,
    emptyRankings,
    emptySellerProfiles,
    emptyVariants,
    locationBlock,
    qualityBlock,
} from '../output/record-builder.js';
import { FIELD_STATUS, FAILURE_REASON, RECORD_STATUS, type FailureReason } from '../types/status.js';
import type { AvailabilityState, MarketplaceCode, OffersBlock, ProductBillingEvent, ProductRecord, SellerProfile, SellerProfilesBlock, VariantItem } from '../types/output.js';
import { matchDiscoveryCard } from './discovery-filter.js';
import { WorkQueue, type WorkItem } from './queue.js';

export interface RunDeps {
    validated: ValidatedInput;
    fetcher: Fetcher;
    writer: DatasetWriter;
    billing: BillingEvents;
    accounting: RunAccounting;
    log: (msg: string, data?: Record<string, unknown>) => void;
    /** Upper bound on parallel fetches. The breaker lowers the live limit. */
    maxConcurrency?: number;
    /** Injected in tests so the degraded-health path does not really sleep. */
    sleep?: (ms: number) => Promise<void>;
    /** Prior SUCCESS rows indexed by marketplace + ASIN + resolved location for monitor mode. */
    previousRecords?: Map<string, Record<string, unknown>>;
}

export interface RunOutcome {
    processed: number;
    discovered: number;
    searchPagesFetched: number;
    discoveryTruncated: boolean;
    filteredOut: number;
    aborted: number;
    abortReason: FailureReason | null;
    peakConcurrency: number;
    monitoringChecked: number;
    monitoringCompared: number;
    monitoringChanged: number;
}

const DEFAULT_CONCURRENCY = 8;

/** Turn validated input into the initial work list. */
export function planInputs(validated: ValidatedInput): WorkItem[] {
    const { input, rejected } = validated;
    const planned: WorkItem[] = [];
    let sequence = 0;

    const push = (item: WorkItem): void => {
        if (input.deduplicate) planned.push(item);
        else planned.push({ ...item, key: `${item.key}|requested:${sequence++}` });
    };

    // Items rejected during validation still need a row (10.3).
    for (const item of rejected) {
        push({
            kind: 'PRODUCT',
            key: `invalid|${item.type}|${item.value}`,
            ref: { type: item.type, value: item.value },
            marketplace: input.marketplace,
            asin: null,
            url: '',
            invalidReason: item.reason,
        });
    }

    const locKey = locationKey(input.postalCode);

    for (const asin of input.asins) {
        push({
            kind: 'PRODUCT',
            key: `${input.marketplace}|${asin}|${locKey}`,
            ref: { type: 'asin', value: asin },
            marketplace: input.marketplace,
            asin,
            url: canonicalProductUrl(input.marketplace, asin),
            discoveries: [{ type: 'asin', value: asin }],
        });
    }

    for (const raw of input.urls) {
        const classified = classifyUrl(raw);
        if (!classified.ok) {
            push({
                kind: 'PRODUCT',
                key: `invalid|url|${raw}`,
                ref: { type: 'url', value: raw },
                marketplace: input.marketplace,
                asin: null,
                url: raw,
                invalidReason: classified.reason,
            });
            continue;
        }
        const v = classified.value;
        if (v.asin !== null) {
            push({
                kind: 'PRODUCT',
                key: dedupeKey(v.marketplace, v.asin, input.postalCode),
                ref: { type: 'url', value: raw },
                marketplace: v.marketplace,
                asin: v.asin,
                url: v.canonical,
                discoveries: [{ type: 'url', value: raw }],
            });
        } else {
            // Search, category and bestseller URLs expand into products
            // through the same listing parser.
            push({
                kind: 'SEARCH',
                key: `${v.marketplace}|${v.type}|${v.canonical}|${locKey}`,
                ref: { type: v.type === 'keyword' ? 'keyword' : v.type, value: raw },
                marketplace: v.marketplace,
                asin: null,
                // A public /sp seller profile is not a catalog surface. Turn
                // its seller ID into Amazon's /s?me= storefront listing.
                url: v.type === 'seller' && v.sellerId !== null
                    ? `https://${getMarketplace(v.marketplace).host}/s?me=${encodeURIComponent(v.sellerId)}`
                    : v.canonical,
                keyword: v.keyword,
            });
        }
    }

    for (const keyword of input.keywords) {
        push({
            kind: 'SEARCH',
            key: `${input.marketplace}|keyword|${keyword}|${locKey}`,
            ref: { type: 'keyword', value: keyword },
            marketplace: input.marketplace,
            asin: null,
            url: searchUrl(input.marketplace, keyword, 1),
            keyword,
        });
    }

    return planned;
}

export async function runPipeline(deps: RunDeps): Promise<RunOutcome> {
    const { validated, fetcher, writer, billing, accounting, log } = deps;
    const { input } = validated;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const ceilingConcurrency = Math.max(1, deps.maxConcurrency ?? DEFAULT_CONCURRENCY);

    const queue = new WorkQueue();
    const planned = planInputs(validated);
    let queuedProducts = 0;
    for (const item of planned) {
        if (queue.push(item)) {
            accounting.register(item.key);
            if (item.kind === 'PRODUCT' && item.invalidReason === undefined) queuedProducts += 1;
        }
        else accounting.registerDuplicate();
    }
    accounting.registerRequested(
        input.asins.length + input.urls.length + input.keywords.length + validated.rejected.length,
    );

    const mode = input.mode === 'monitor' ? 'detail' : input.mode;
    const scoringMode = mode === 'fast' ? 'fast' : mode === 'intelligence' ? 'intelligence' : 'detail';
    const effectiveVariantMode = includesBlock(input.dataBlocks, 'variants') ? input.variantMode : 'none';
    const detailBillingEvent: ProductBillingEvent = input.mode === 'monitor'
        ? 'product-check'
        : usesEssentialProductEvent(input.dataBlocks)
            ? 'product-essential'
            : 'product-detail';
    const listingBillingEvent: ProductBillingEvent = 'product-basic';

    const state = {
        processed: 0,
        discovered: 0,
        searchPages: 0,
        discoveryTruncated: false,
        filteredOut: 0,
        abortReason: null as FailureReason | null,
        peakConcurrency: 0,
        monitoringChecked: 0,
        monitoringCompared: 0,
        monitoringChanged: 0,
    };
    let discoveredSequence = 0;
    let commitTail: Promise<void> = Promise.resolve();
    const fastDiscoveries = new Map<string, ProductRecord['discoveredFrom']>();
    const sellerProfileCache = new Map<string, Promise<SellerProfile | null>>();

    async function withCommitLock<T>(work: () => Promise<T>): Promise<T> {
        const previous = commitTail;
        let release!: () => void;
        commitTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
            return await work();
        } finally {
            release();
        }
    }

    /** 9.5: the breaker lowers the live limit rather than killing the run outright. */
    const liveLimit = (): number => {
        const health = fetcher.healthState?.() ?? 'HEALTHY';
        if (health === 'ABORT') return 0;
        if (health === 'DEGRADED') return Math.max(1, Math.floor(ceilingConcurrency / 2));
        return ceilingConcurrency;
    };

    const shouldStop = (respectProductLimit = true): FailureReason | null => {
        if (state.abortReason !== null) return state.abortReason;
        if (respectProductLimit && state.processed >= input.maxProducts) return FAILURE_REASON.MAX_PRODUCTS_REACHED;
        if (billing.isCapReached()) return FAILURE_REASON.CHARGE_CAP_REACHED;
        if ((fetcher.healthState?.() ?? 'HEALTHY') === 'ABORT') return FAILURE_REASON.CIRCUIT_BREAKER_TRIPPED;
        return null;
    };

    const capacityLeft = (): number => Math.max(0, input.maxProducts - state.processed - queuedProducts);

    /** Register-and-enqueue is one operation so discovery cannot escape accounting. */
    const enqueueDiscovered = (item: WorkItem): boolean => {
        if (input.deduplicate && queue.has(item.key)) {
            queue.mergeDiscoveries(item.key, item.discoveries ?? []);
            accounting.registerDuplicate();
            return false;
        }
        if (item.kind === 'PRODUCT' && capacityLeft() <= 0) {
            state.discoveryTruncated = true;
            return false;
        }
        if (!input.deduplicate) item.key = `${item.key}|discovered:${discoveredSequence++}`;
        queue.push(item);
        accounting.register(item.key);
        if (item.kind === 'PRODUCT') {
            queuedProducts += 1;
            state.discovered += 1;
        }
        return true;
    };

    async function handleProduct(item: WorkItem): Promise<void> {
        if (item.invalidReason !== undefined) {
            await writer.write(
                buildFailureRecord({
                    status: RECORD_STATUS.INVALID_INPUT,
                    input: item.ref,
                    marketplace: item.marketplace,
                    reason: item.invalidReason,
                }),
            );
            accounting.settle(item.key, RECORD_STATUS.INVALID_INPUT);
            return;
        }

        const fetched = await fetcher.fetch({
            url: item.url,
            marketplace: item.marketplace,
            postalCode: input.postalCode,
            deliveryCountry: input.deliveryCountry,
            label: 'PRODUCT',
        });

        if (!fetched.ok) {
            await settleFetchFailure(item, fetched);
            return;
        }

        if (input.requireLocation && !fetched.locationApplied) {
            await writer.write(
                buildFailureRecord({
                    status: RECORD_STATUS.REQUIRES_LOCATION,
                    input: item.ref,
                    marketplace: item.marketplace,
                    asin: item.asin,
                    attempts: fetched.attempts,
                    reason: FAILURE_REASON.LOCATION_NOT_APPLIED,
                    lastProxyTier: fetched.proxyTier,
                    scrapedAt: fetched.receivedAt,
                }),
            );
            accounting.settle(item.key, RECORD_STATUS.REQUIRES_LOCATION);
            return;
        }

        const parsed = parseProductPage({
            html: fetched.html,
            url: fetched.finalUrl,
            marketplace: item.marketplace,
            variantMode: effectiveVariantMode,
            maxVariants: input.maxVariants,
            pageType: fetched.pageType,
        });

        if (!parsed.hasAnyCriticalField) {
            await writer.write(
                buildFailureRecord({
                    status: RECORD_STATUS.PARSER_ERROR,
                    input: item.ref,
                    marketplace: item.marketplace,
                    asin: item.asin,
                    attempts: fetched.attempts,
                    reason: FAILURE_REASON.NO_CRITICAL_FIELDS,
                    lastProxyTier: fetched.proxyTier,
                    scrapedAt: fetched.receivedAt,
                }),
            );
            accounting.settle(item.key, RECORD_STATUS.PARSER_ERROR);
            return;
        }

        const warnings = [...parsed.warnings];
        let variants = parsed.variants ?? emptyVariants(effectiveVariantMode);
        let offers = emptyOffers(input.includeOffers);
        let sellerProfiles = emptySellerProfiles(input.includeSellerDetails);

        if (input.includeOffers) {
            offers = await fetchOffers(item.marketplace, parsed.asin ?? item.asin ?? '', warnings);
        }

        if (input.includeSellerDetails) {
            const sellerIds = new Set<string>();
            if (parsed.buyBox.sellerId !== null) sellerIds.add(parsed.buyBox.sellerId);
            for (const offer of offers.items) if (offer.sellerId !== null) sellerIds.add(offer.sellerId);
            sellerProfiles = await fetchSellerProfiles(item.marketplace, [...sellerIds], warnings);
        }

        // P1 brought forward: exact child price and stock, bounded by maxVariants.
        if (effectiveVariantMode === 'price' && variants.items.length > 0) {
            const enriched = await enrichVariantPrices(item.marketplace, variants.items, warnings);
            variants = { ...variants, items: enriched };
        }

        // `full` mode promotes each child to its own fully-detailed record, so
        // each one is registered and charged as a product in its own right.
        if (effectiveVariantMode === 'full' && variants.items.length > 0) {
            for (const child of variants.items) {
                const variantDiscovery = { type: 'variant' as const, value: item.asin ?? '' };
                if (child.asin === parsed.asin) {
                    const discoveries = item.discoveries ?? (item.discoveries = []);
                    if (!discoveries.some((source) => source.type === 'variant' && source.value === variantDiscovery.value)) {
                        discoveries.push(variantDiscovery);
                    }
                    state.discovered += 1;
                    accounting.registerDuplicate();
                    continue;
                }
                enqueueDiscovered({
                    kind: 'PRODUCT',
                    key: dedupeKey(item.marketplace, child.asin, fetched.resolvedPostalCode),
                    ref: { type: 'asin', value: child.asin },
                    marketplace: item.marketplace,
                    asin: child.asin,
                    url: canonicalProductUrl(item.marketplace, child.asin),
                    discoveries: [variantDiscovery],
                    derived: true,
                });
            }
        }

        const record = buildProductRecord({
            input: item.ref,
            marketplace: item.marketplace,
            asin: parsed.asin ?? item.asin ?? '',
            parentAsin: parsed.parentAsin,
            title: parsed.title,
            brand: parsed.brand,
            retrieval: {
                profile: input.dataProfile,
                requestedBlocks: [...input.dataBlocks],
                billingEvent: detailBillingEvent,
            },
            pricing: parsed.pricing,
            availability: parsed.availability,
            rankings: parsed.rankings,
            ratings: parsed.ratings,
            buyBox: parsed.buyBox,
            variants,
            product: parsed.product,
            media: parsed.media,
            offers,
            sellerProfiles,
            monitoring: emptyMonitoring(
                input.mode === 'monitor' || input.compareWithDatasetId !== null,
                input.compareWithDatasetId,
            ),
            location: locationBlock({
                requestedCountry: input.deliveryCountry,
                requestedPostalCode: input.postalCode,
                resolvedPostalCode: fetched.resolvedPostalCode,
                applied: fetched.locationApplied,
                method: fetched.locationApplied ? 'SESSION_COOKIE' : 'NONE',
            }),
            sources: {
                detailPage: fetched.finalUrl,
                ...(input.includeOffers ? { offersPage: offers.items[0]?.sourceUrl ?? offersUrl(item.marketplace, parsed.asin ?? item.asin ?? '') } : {}),
                priceStrategy: parsed.pricing.priceSource,
            },
            quality: qualityBlock({
                fetchAttempts: fetched.attempts,
                proxyTier: fetched.proxyTier,
                pageType: fetched.pageType,
                blocked: false,
                warnings,
            }),
            discoveredFrom: item.discoveries ?? [{ type: item.ref.type, value: item.ref.value }],
            scrapedAt: fetched.receivedAt,
        });

        projectRecordToBlocks(record, input.dataBlocks);

        if (input.compareWithDatasetId !== null) {
            record.monitoring = compareProduct(
                record,
                deps.previousRecords?.get(historyKey(record.marketplace, record.asin, record.location.resolvedPostalCode)),
                input.compareWithDatasetId,
            );
        }

        const committed = await finishRecord(
            item,
            record,
            detailBillingEvent,
            scoringMode,
        );
        if (committed && input.mode === 'monitor') {
            state.monitoringChecked += 1;
            if (record.monitoring.compared) state.monitoringCompared += 1;
            if (record.monitoring.changed) state.monitoringChanged += 1;
        }
    }

    function offersUrl(marketplace: MarketplaceCode, asin: string): string {
        const cfg = getMarketplace(marketplace);
        return `https://${cfg.host}${cfg.paths.offers.replace('{asin}', asin)}`;
    }

    async function fetchOffers(
        marketplace: MarketplaceCode,
        asin: string,
        warnings: string[],
    ): Promise<OffersBlock> {
        const cfg = getMarketplace(marketplace);
        const url = offersUrl(marketplace, asin);
        const result = await fetcher.fetch({
            url,
            marketplace,
            postalCode: input.postalCode,
            deliveryCountry: input.deliveryCountry,
            label: 'OFFERS',
        });
        if (!result.ok) {
            warnings.push(`OFFERS_FETCH_FAILED:${result.reason}`);
            return emptyOffers(true, result.notFound ? FIELD_STATUS.NOT_PRESENT : FIELD_STATUS.PARSER_MISS);
        }
        return parseOffers({ html: result.html, cfg, sourceUrl: result.finalUrl, maxOffers: input.maxOffersPerProduct });
    }

    async function fetchSellerProfiles(
        marketplace: MarketplaceCode,
        sellerIds: string[],
        warnings: string[],
    ): Promise<SellerProfilesBlock> {
        if (sellerIds.length === 0) return emptySellerProfiles(true, FIELD_STATUS.NOT_PRESENT);
        const cfg = getMarketplace(marketplace);
        const items: SellerProfile[] = [];
        for (const sellerId of sellerIds.slice(0, input.maxOffersPerProduct)) {
            if (billing.isCapReached()) break;
            const cacheKey = `${marketplace}|${sellerId}`;
            let pending = sellerProfileCache.get(cacheKey);
            if (pending === undefined) {
                pending = (async (): Promise<SellerProfile | null> => {
                    const url = sellerProfileUrl(cfg, sellerId);
                    const result = await fetcher.fetch({
                        url,
                        marketplace,
                        postalCode: input.postalCode,
                        deliveryCountry: input.deliveryCountry,
                        label: 'SELLER',
                    });
                    if (!result.ok) {
                        warnings.push(`SELLER_FETCH_FAILED:${sellerId}:${result.reason}`);
                        return null;
                    }
                    const profile = parseSellerProfile({ html: result.html, cfg, sellerId, sourceUrl: result.finalUrl });
                    if (profile.status !== FIELD_STATUS.EXTRACTED) {
                        warnings.push(`SELLER_PARSER_MISS:${sellerId}`);
                        return null;
                    }
                    return profile;
                })();
                sellerProfileCache.set(cacheKey, pending);
            }
            const profile = await pending;
            if (profile !== null) items.push(profile);
        }
        return {
            requested: true,
            items,
            status: items.length > 0 ? FIELD_STATUS.EXTRACTED : FIELD_STATUS.PARSER_MISS,
        };
    }

    /** One extra request per child; billing is committed after the base product. */
    async function enrichVariantPrices(
        marketplace: MarketplaceCode,
        items: VariantItem[],
        warnings: string[],
    ): Promise<VariantItem[]> {
        const out: VariantItem[] = [];
        for (const child of items) {
            if (billing.isCapReached()) {
                out.push({ ...child, status: FIELD_STATUS.NOT_APPLICABLE });
                continue;
            }
            const childFetch = await fetcher.fetch({
                url: canonicalProductUrl(marketplace, child.asin),
                marketplace,
                postalCode: input.postalCode,
                deliveryCountry: input.deliveryCountry,
                label: 'VARIANT',
            });
            if (!childFetch.ok) {
                warnings.push(`VARIANT_FETCH_FAILED:${child.asin}:${childFetch.reason}`);
                out.push({ ...child, price: null, availability: 'UNKNOWN', status: FIELD_STATUS.PARSER_MISS });
                continue;
            }
            const childParsed = parseProductPage({
                html: childFetch.html,
                url: childFetch.finalUrl,
                marketplace,
                variantMode: 'none',
            });
            const state: AvailabilityState = childParsed.availability.state;
            out.push({
                ...child,
                price: childParsed.pricing.currentPrice,
                availability: state,
                status: childParsed.pricing.status,
            });
        }
        return out;
    }

    async function handleSearch(item: WorkItem): Promise<void> {
        const cfg = getMarketplace(item.marketplace);
        let page = 1;
        let anyPageParsed = false;
        let totalCards = 0;
        let organicSeen = 0;
        let sponsoredSeen = 0;
        let lastFailure: FetchResult | null = null;

        while (page <= input.maxSearchPages) {
            if (shouldStop() !== null) break;

            const url =
                item.keyword != null && item.keyword !== ''
                    ? searchUrl(item.marketplace, item.keyword, page)
                    : withPageParam(item.url, page);

            const fetched = await fetcher.fetch({
                url,
                marketplace: item.marketplace,
                postalCode: input.postalCode,
                deliveryCountry: input.deliveryCountry,
                label: 'SEARCH',
            });
            state.searchPages += 1;

            if (!fetched.ok) {
                lastFailure = fetched;
                break;
            }

            if (input.requireLocation && !fetched.locationApplied) {
                await writer.write(
                    buildFailureRecord({
                        status: RECORD_STATUS.REQUIRES_LOCATION,
                        input: item.ref,
                        marketplace: item.marketplace,
                        attempts: fetched.attempts,
                        reason: FAILURE_REASON.LOCATION_NOT_APPLIED,
                        lastProxyTier: fetched.proxyTier,
                        scrapedAt: fetched.receivedAt,
                    }),
                );
                accounting.settle(item.key, RECORD_STATUS.REQUIRES_LOCATION);
                return;
            }

            const result = parseSearchPage({
                html: fetched.html,
                marketplace: item.marketplace,
                cfg,
                page,
            });
            anyPageParsed = true;
            const cardsBeforePage = totalCards;
            totalCards += result.cards.length;
            const organicBeforePage = organicSeen;
            const sponsoredBeforePage = sponsoredSeen;

            for (const [cardIndex, card] of result.cards.entries()) {
                const filter = matchDiscoveryCard(card, input.discoveryFilters);
                if (!filter.matches) {
                    state.filteredOut += 1;
                    continue;
                }
                const discovery = {
                    type: item.ref.type,
                    value: item.ref.value,
                    page,
                    position: cardsBeforePage + cardIndex + 1,
                    pagePosition: cardIndex + 1,
                    sponsored: card.sponsored,
                    organicPosition: card.sponsored || card.organicPosition === null
                        ? null
                        : organicBeforePage + card.organicPosition,
                    sponsoredPosition: !card.sponsored || card.sponsoredPosition === null
                        ? null
                        : sponsoredBeforePage + card.sponsoredPosition,
                };

                if (mode === 'fast') {
                    // Spec 4.1: listing data only, no product-page fetch.
                    if (capacityLeft() <= 0) {
                        state.discoveryTruncated = true;
                        break;
                    }
                    const baseKey = dedupeKey(item.marketplace, card.asin, fetched.resolvedPostalCode);
                    let key = baseKey;
                    let discoveries: ProductRecord['discoveredFrom'];
                    if (input.deduplicate) {
                        if (queue.has(baseKey)) {
                            queue.mergeDiscoveries(baseKey, [discovery]);
                            accounting.registerDuplicate();
                            continue;
                        }
                        const existing = fastDiscoveries.get(baseKey);
                        if (existing !== undefined) {
                            if (!existing.some((source) => source.type === discovery.type
                                && source.value === discovery.value
                                && source.page === discovery.page
                                && source.position === discovery.position)) {
                                existing.push(discovery);
                            }
                            accounting.registerDuplicate();
                            continue;
                        }
                        discoveries = [discovery];
                        fastDiscoveries.set(baseKey, discoveries);
                    } else {
                        key = `${baseKey}|fast:${discoveredSequence++}`;
                        discoveries = [discovery];
                    }
                    // Registered but deliberately NOT queued: the record is
                    // built right here from listing data, so queueing it would
                    // settle the same key twice.
                    accounting.register(key);
                    state.discovered += 1;
                    state.processed += 1;

                    const record = buildProductRecord({
                        input: item.ref,
                        marketplace: item.marketplace,
                        asin: card.asin,
                        canonicalUrl: card.url,
                        title: card.title,
                        brand: null,
                        retrieval: {
                            profile: input.dataProfile,
                            requestedBlocks: [...input.dataBlocks],
                            billingEvent: listingBillingEvent,
                        },
                        pricing: {
                            currentPrice: card.price,
                            listPrice: card.listPrice,
                            discountAmount: null,
                            discountPercent: null,
                            dealPrice: null,
                            dealType: card.badge,
                            coupon: null,
                            subscribeAndSave: null,
                            unitPrice: null,
                            priceSource: card.price === null ? null : 'SEARCH_CARD',
                            status: card.price === null ? FIELD_STATUS.NOT_PRESENT : FIELD_STATUS.EXTRACTED,
                        },
                        availability: {
                            ...emptyAvailability(FIELD_STATUS.NOT_PRESENT),
                            deliveryText: card.deliveryText,
                            primeEligible: card.primeEligible,
                        },
                        rankings: {
                            ...emptyRankings(FIELD_STATUS.NOT_APPLICABLE),
                            boughtInPastMonthRaw: card.boughtInPastMonthRaw,
                            boughtInPastMonthMin: card.boughtInPastMonthMin,
                        },
                        ratings: {
                            rating: card.rating,
                            reviewCount: card.reviewCount,
                            starDistribution: null,
                            status: card.rating === null && card.reviewCount === null
                                ? FIELD_STATUS.NOT_PRESENT
                                : FIELD_STATUS.EXTRACTED,
                        },
                        buyBox: emptyBuyBox(FIELD_STATUS.NOT_APPLICABLE),
                        variants: emptyVariants('none'),
                        product: emptyProductContent(FIELD_STATUS.NOT_APPLICABLE),
                        media: {
                            mainImage: card.thumbnail,
                            images: card.thumbnail === null ? [] : [card.thumbnail],
                            videos: [],
                            status: card.thumbnail === null ? FIELD_STATUS.NOT_PRESENT : FIELD_STATUS.EXTRACTED,
                        },
                        location: locationBlock({
                            requestedCountry: input.deliveryCountry,
                            requestedPostalCode: input.postalCode,
                            resolvedPostalCode: fetched.resolvedPostalCode,
                            applied: fetched.locationApplied,
                            method: fetched.locationApplied ? 'SESSION_COOKIE' : 'NONE',
                        }),
                        sources: { searchPage: fetched.finalUrl, priceStrategy: card.price === null ? null : 'SEARCH_CARD' },
                        quality: qualityBlock({
                            fetchAttempts: fetched.attempts,
                            proxyTier: fetched.proxyTier,
                            pageType: 'SEARCH',
                            warnings: ['FROM_SEARCH_CARD'],
                        }),
                        discoveredFrom: discoveries,
                        scrapedAt: fetched.receivedAt,
                    });
                    projectRecordToBlocks(record, input.dataBlocks);
                    await finishRecord({ ...item, key, asin: card.asin }, record, listingBillingEvent, scoringMode);
                    continue;
                }

                enqueueDiscovered({
                    kind: 'PRODUCT',
                    key: dedupeKey(item.marketplace, card.asin, fetched.resolvedPostalCode),
                    ref: { type: 'asin', value: card.asin },
                    marketplace: item.marketplace,
                    asin: card.asin,
                    url: card.url,
                    discoveries: [discovery],
                    derived: true,
                });
            }

            organicSeen += result.cards.filter((card) => !card.sponsored).length;
            sponsoredSeen += result.cards.filter((card) => card.sponsored).length;

            if (!result.hasNextPage || result.cards.length === 0) break;
            page += 1;
        }

        if (!anyPageParsed || totalCards === 0) {
            const failure = lastFailure !== null && !lastFailure.ok ? lastFailure : null;
            // A listing surface with genuinely no matches is a real answer, so
            // it reports PRODUCT_NOT_FOUND rather than a transport failure.
            const status = failure?.notFound === true
                ? RECORD_STATUS.PRODUCT_NOT_FOUND
                : failure?.blocked === true
                    ? RECORD_STATUS.BLOCKED
                    : RECORD_STATUS.FETCH_FAILED;
            await writer.write(
                buildFailureRecord({
                    status,
                    input: item.ref,
                    marketplace: item.marketplace,
                    attempts: failure?.attempts ?? 0,
                    reason: failure?.reason ?? FAILURE_REASON.EMPTY_TEMPLATE,
                    lastProxyTier: failure?.proxyTier ?? 'NONE',
                }),
            );
            accounting.settle(item.key, status);
            return;
        }

        // The keyword itself produced results; the products are the output, so
        // no dataset row for the keyword. It is still settled, which is what
        // keeps the invariant true.
        accounting.settle(item.key, RECORD_STATUS.SUCCESS);
    }

    async function settleFetchFailure(item: WorkItem, fetched: Extract<FetchResult, { ok: false }>): Promise<void> {
        const status = fetched.notFound
            ? RECORD_STATUS.PRODUCT_NOT_FOUND
            : fetched.blocked
                ? RECORD_STATUS.BLOCKED
                : RECORD_STATUS.FETCH_FAILED;
        await writer.write(
            buildFailureRecord({
                status,
                input: item.ref,
                marketplace: item.marketplace,
                asin: item.asin,
                attempts: fetched.attempts,
                reason: fetched.reason,
                lastProxyTier: fetched.proxyTier,
                scrapedAt: fetched.receivedAt,
                ...(fetched.message === undefined ? {} : { message: fetched.message }),
            }),
        );
        accounting.settle(item.key, status);
    }

    async function chargeAncillary(record: ProductRecord): Promise<void> {
        if (record.offers.items.length > 0) {
            const outcome = await billing.chargeOffers(RECORD_STATUS.SUCCESS, record.offers.items.length);
            if (outcome.chargedCount < record.offers.items.length) {
                log('offer billing stopped after the durable result was written', {
                    asin: record.asin,
                    charged: outcome.chargedCount,
                    delivered: record.offers.items.length,
                    reason: outcome.reason,
                });
                state.abortReason = outcome.reason === 'CAP_REACHED'
                    ? FAILURE_REASON.CHARGE_CAP_REACHED
                    : FAILURE_REASON.BILLING_FAILED;
                return;
            }
        }
        for (const profile of record.sellerProfiles.items) {
            const outcome = await billing.chargeSellerDetail(RECORD_STATUS.SUCCESS);
            if (!outcome.charged) {
                log('seller-profile billing stopped after the durable result was written', {
                    asin: record.asin,
                    sellerId: profile.sellerId,
                    reason: outcome.reason,
                });
                state.abortReason = outcome.reason === 'CAP_REACHED'
                    ? FAILURE_REASON.CHARGE_CAP_REACHED
                    : FAILURE_REASON.BILLING_FAILED;
                return;
            }
        }
        if (effectiveVariantMode !== 'price') return;
        for (const child of record.variants.items) {
            if (child.status !== FIELD_STATUS.EXTRACTED) continue;
            const outcome = await billing.chargeVariantDetail(RECORD_STATUS.SUCCESS);
            if (!outcome.charged) {
                log('variant billing stopped after the durable result was written', {
                    asin: record.asin,
                    childAsin: child.asin,
                    reason: outcome.reason,
                });
                state.abortReason = outcome.reason === 'CAP_REACHED'
                    ? FAILURE_REASON.CHARGE_CAP_REACHED
                    : FAILURE_REASON.BILLING_FAILED;
                return;
            }
        }
    }

    async function finishRecord(
        item: WorkItem,
        record: ProductRecord,
        event: ProductBillingEvent,
        scoring: 'fast' | 'detail' | 'intelligence',
    ): Promise<boolean> {
        const completeness = scoreCompleteness(record, scoring);
        record.quality.completenessScore = completeness.score;
        record.quality.criticalFieldsMissing = completeness.missing;

        return withCommitLock(async () => {
            const knownBillingStop = billing.isCapReached()
                ? FAILURE_REASON.CHARGE_CAP_REACHED
                : state.abortReason === FAILURE_REASON.BILLING_FAILED
                    ? FAILURE_REASON.BILLING_FAILED
                    : null;
            if (knownBillingStop !== null) {
                state.abortReason = knownBillingStop;
                await writer.write(buildFailureRecord({
                    status: RECORD_STATUS.RUN_ABORTED,
                    input: item.ref,
                    marketplace: item.marketplace,
                    asin: item.asin,
                    reason: knownBillingStop,
                }));
                accounting.settle(item.key, RECORD_STATUS.RUN_ABORTED);
                return false;
            }

            const emitted = await writer.write(record);
            if (emitted) {
                // The append is acknowledged before charging. Commits are
                // serialized so a cap discovered by one worker stops every
                // waiting worker before it can emit unpaid value.
                const outcome = event === 'product-basic'
                    ? await billing.chargeProductBasic(record.status)
                    : event === 'product-essential'
                        ? await billing.chargeProductEssential(record.status)
                        : event === 'product-check'
                            ? await billing.chargeProductCheck(record.status)
                            : await billing.chargeProductDetail(record.status);
                if (!outcome.charged) {
                    const reason = outcome.reason === 'CAP_REACHED'
                        ? FAILURE_REASON.CHARGE_CAP_REACHED
                        : FAILURE_REASON.BILLING_FAILED;
                    state.abortReason = reason;
                    log('base billing failed after the durable result was written; stopping new work', {
                        asin: record.asin,
                        event,
                        reason,
                    });
                    accounting.settle(item.key, RECORD_STATUS.SUCCESS);
                    return false;
                }
                await chargeAncillary(record);
            } else {
                accounting.registerDuplicate();
            }
            accounting.settle(item.key, RECORD_STATUS.SUCCESS);
            return emitted;
        });
    }

    // ---- driver: bounded concurrency, dynamic limit, cooperative shutdown ----

    const inFlight = new Set<Promise<void>>();
    let inFlightSearches = 0;

    while (true) {
        if (queue.length === 0 && inFlight.size === 0) break;
        const stop = shouldStop(queue.length > 0);
        if (stop !== null) {
            state.abortReason = stop;
            break;
        }

        const limit = liveLimit();
        while (queue.length > 0 && inFlight.size < limit) {
            // Finish all listing discovery before product records can be
            // committed. This lets duplicate cards from concurrent keywords
            // merge every source into one durable discoveredFrom array.
            if (inFlightSearches > 0 && !queue.hasKind('SEARCH')) break;
            if (state.processed >= input.maxProducts) {
                state.abortReason = FAILURE_REASON.MAX_PRODUCTS_REACHED;
                break;
            }
            const item = queue.shift();
            if (item === undefined) break;
            if (item.kind === 'SEARCH') inFlightSearches += 1;
            if (item.kind === 'PRODUCT' && item.invalidReason === undefined) {
                queuedProducts -= 1;
                state.processed += 1;
            }
            const task = (async () => {
                try {
                    if (item.kind === 'SEARCH') await handleSearch(item);
                    else await handleProduct(item);
                } catch (err) {
                    // An unexpected throw must still settle the input, or the
                    // invariant assertion at summary time would fail (10.3).
                    const schemaFailure = err instanceof DatasetSchemaError;
                    const status = schemaFailure ? RECORD_STATUS.PARSER_ERROR : RECORD_STATUS.FETCH_FAILED;
                    const reason = schemaFailure ? FAILURE_REASON.OUTPUT_SCHEMA_VIOLATION : FAILURE_REASON.HTTP_STATUS;
                    log(`worker threw; settling input as ${status}`, {
                        key: item.key,
                        error: (err as Error).message,
                    });
                    await writer.write(
                        buildFailureRecord({
                            status,
                            input: item.ref,
                            marketplace: item.marketplace,
                            asin: item.asin,
                            reason,
                            message: (err as Error).message.slice(0, 200),
                        }),
                    );
                    accounting.settle(item.key, status);
                } finally {
                    if (item.kind === 'SEARCH') inFlightSearches -= 1;
                }
            })();
            const tracked = task.finally(() => {
                inFlight.delete(tracked);
            });
            inFlight.add(tracked);
        }

        state.peakConcurrency = Math.max(state.peakConcurrency, inFlight.size);

        if (inFlight.size === 0) {
            if (queue.length === 0) break;
            // Limit is zero (breaker) with work still queued: wait for it to
            // recover, or let shouldStop end the run on the next pass.
            await sleep(50);
            continue;
        }
        await Promise.race([...inFlight]);
    }

    await Promise.allSettled([...inFlight]);

    // C9: every input still pending is emitted as RUN_ABORTED with a reason, on
    // every exit path. This is what makes the accounting invariant survive a
    // ceiling, a charge cap or a block storm.
    const pending = accounting.pending();
    const reason = state.abortReason ?? FAILURE_REASON.RUN_TIMED_OUT;
    const byKey = new Map([...planned, ...queue.remaining()].map((p) => [p.key, p]));
    for (const key of pending) {
        const item = byKey.get(key);
        await writer.write(
            buildFailureRecord({
                status: RECORD_STATUS.RUN_ABORTED,
                input: item?.ref ?? { type: 'asin', value: key },
                marketplace: item?.marketplace ?? null,
                asin: item?.asin ?? null,
                reason,
            }),
        );
        accounting.settle(key, RECORD_STATUS.RUN_ABORTED);
    }

    return {
        processed: state.processed,
        discovered: state.discovered,
        searchPagesFetched: state.searchPages,
        discoveryTruncated: state.discoveryTruncated,
        filteredOut: state.filteredOut,
        aborted: pending.length,
        abortReason: state.abortReason,
        peakConcurrency: state.peakConcurrency,
        monitoringChecked: state.monitoringChecked,
        monitoringCompared: state.monitoringCompared,
        monitoringChanged: state.monitoringChanged,
    };
}

function withPageParam(url: string, page: number): string {
    try {
        const parsed = new URL(url);
        if (page > 1) parsed.searchParams.set('page', String(page));
        return parsed.toString();
    } catch {
        return url;
    }
}
