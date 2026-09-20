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
import { getMarketplace } from '../amazon/marketplace-config/index.js';
import { canonicalProductUrl, classifyUrl, dedupeKey, locationKey, searchUrl } from '../input/normalizer.js';
import type { ValidatedInput } from '../input/validate.js';
import type { FetchResult, Fetcher } from '../fetch/types.js';
import { scoreCompleteness } from '../quality/completeness.js';
import { RunAccounting } from '../output/accounting.js';
import { DatasetSchemaError, type DatasetWriter } from '../output/dataset-writer.js';
import {
    buildFailureRecord,
    buildProductRecord,
    emptyAvailability,
    emptyBuyBox,
    emptyProductContent,
    emptyRankings,
    emptyVariants,
    locationBlock,
    qualityBlock,
} from '../output/record-builder.js';
import { FIELD_STATUS, FAILURE_REASON, RECORD_STATUS, type FailureReason } from '../types/status.js';
import type { AvailabilityState, MarketplaceCode, ProductRecord, VariantItem } from '../types/output.js';
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
}

export interface RunOutcome {
    processed: number;
    discovered: number;
    searchPagesFetched: number;
    discoveryTruncated: boolean;
    aborted: number;
    abortReason: FailureReason | null;
    peakConcurrency: number;
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
        if (v.type === 'seller') {
            push({
                kind: 'PRODUCT',
                key: `invalid|url|${raw}`,
                ref: { type: 'seller', value: raw },
                marketplace: v.marketplace,
                asin: null,
                url: raw,
                invalidReason: FAILURE_REASON.SELLER_INPUT_NOT_AVAILABLE,
            });
            continue;
        }
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
                url: v.canonical,
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
    for (const item of planned) {
        if (queue.push(item)) accounting.register(item.key);
        else accounting.registerDuplicate();
    }
    accounting.registerRequested(
        input.asins.length + input.urls.length + input.keywords.length + validated.rejected.length,
    );

    const mode = input.mode === 'monitor' ? 'detail' : input.mode;
    const scoringMode = mode === 'fast' ? 'fast' : mode === 'intelligence' ? 'intelligence' : 'detail';

    const state = {
        processed: 0,
        discovered: 0,
        searchPages: 0,
        discoveryTruncated: false,
        abortReason: null as FailureReason | null,
        peakConcurrency: 0,
    };
    let discoveredSequence = 0;
    const fastDiscoveries = new Map<string, ProductRecord['discoveredFrom']>();

    /** 9.5: the breaker lowers the live limit rather than killing the run outright. */
    const liveLimit = (): number => {
        const health = fetcher.healthState?.() ?? 'HEALTHY';
        if (health === 'ABORT') return 0;
        if (health === 'DEGRADED') return Math.max(1, Math.floor(ceilingConcurrency / 2));
        return ceilingConcurrency;
    };

    const shouldStop = (): FailureReason | null => {
        if (state.abortReason !== null) return state.abortReason;
        if (state.processed >= input.maxProducts) return FAILURE_REASON.MAX_PRODUCTS_REACHED;
        if (billing.isCapReached()) return FAILURE_REASON.CHARGE_CAP_REACHED;
        if ((fetcher.healthState?.() ?? 'HEALTHY') === 'ABORT') return FAILURE_REASON.CIRCUIT_BREAKER_TRIPPED;
        return null;
    };

    const capacityLeft = (): number => Math.max(0, input.maxProducts - state.processed - inFlightProducts);
    let inFlightProducts = 0;

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
        if (item.kind === 'PRODUCT') state.discovered += 1;
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

        state.processed += 1;

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
            variantMode: input.variantMode,
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
        let variants = parsed.variants ?? emptyVariants(input.variantMode);

        // P1 brought forward: exact child price and stock, bounded by maxVariants.
        if (input.variantMode === 'price' && variants.items.length > 0) {
            const enriched = await enrichVariantPrices(item.marketplace, variants.items, warnings);
            variants = { ...variants, items: enriched };
        }

        // `full` mode promotes each child to its own fully-detailed record, so
        // each one is registered and charged as a product in its own right.
        if (input.variantMode === 'full' && variants.items.length > 0) {
            for (const child of variants.items) {
                enqueueDiscovered({
                    kind: 'PRODUCT',
                    key: dedupeKey(item.marketplace, child.asin, input.postalCode),
                    ref: { type: 'asin', value: child.asin },
                    marketplace: item.marketplace,
                    asin: child.asin,
                    url: canonicalProductUrl(item.marketplace, child.asin),
                    discoveries: [{ type: 'variant', value: item.asin ?? '' }],
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
            pricing: parsed.pricing,
            availability: parsed.availability,
            rankings: parsed.rankings,
            ratings: parsed.ratings,
            buyBox: parsed.buyBox,
            variants,
            product: parsed.product,
            media: parsed.media,
            location: locationBlock({
                requestedCountry: input.deliveryCountry,
                requestedPostalCode: input.postalCode,
                resolvedPostalCode: fetched.resolvedPostalCode,
                applied: fetched.locationApplied,
                method: fetched.locationApplied ? 'SESSION_COOKIE' : 'NONE',
            }),
            sources: { detailPage: fetched.finalUrl, priceStrategy: parsed.pricing.priceSource },
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

        const committed = await finishRecord(item, record, mode === 'fast' ? 'basic' : 'detail', scoringMode);
        if (committed && input.variantMode === 'price') {
            // The base product is charged first. Exact child data is revealed
            // only for variant-detail events that the platform actually
            // accepted; this prevents a charge cap from leaking unpaid value.
            for (const child of record.variants.items) {
                if (child.status !== FIELD_STATUS.EXTRACTED) continue;
                const outcome = await billing.chargeVariantDetail(RECORD_STATUS.SUCCESS);
                if (!outcome.charged) {
                    child.price = null;
                    child.availability = 'UNKNOWN';
                    child.status = FIELD_STATUS.NOT_APPLICABLE;
                    record.quality.warnings.push(`VARIANT_DETAIL_NOT_CHARGED:${child.asin}:${outcome.reason ?? 'UNKNOWN'}`);
                }
            }
        }
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

            const result = parseSearchPage({
                html: fetched.html,
                marketplace: item.marketplace,
                cfg,
                page,
            });
            anyPageParsed = true;
            totalCards += result.cards.length;

            for (const card of result.cards) {
                const discovery = {
                    type: item.ref.type,
                    value: item.ref.value,
                    page,
                    position: card.position,
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
                    await finishRecord({ ...item, key, asin: card.asin }, record, 'basic', scoringMode);
                    continue;
                }

                enqueueDiscovered({
                    kind: 'PRODUCT',
                    key: dedupeKey(item.marketplace, card.asin, input.postalCode),
                    ref: { type: 'asin', value: card.asin },
                    marketplace: item.marketplace,
                    asin: card.asin,
                    url: card.url,
                    discoveries: [discovery],
                    derived: true,
                });
            }

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

    async function finishRecord(
        item: WorkItem,
        record: ProductRecord,
        event: 'basic' | 'detail',
        scoring: 'fast' | 'detail' | 'intelligence',
    ): Promise<boolean> {
        const completeness = scoreCompleteness(record, scoring);
        record.quality.completenessScore = completeness.score;
        record.quality.criticalFieldsMissing = completeness.missing;

        const emitted = await writer.write(record);
        if (emitted) {
            // Charge derives from the record's own status, never the caller's intent.
            const outcome = event === 'basic'
                ? await billing.chargeProductBasic(record.status)
                : await billing.chargeProductDetail(record.status);
            if (!outcome.charged) {
                writer.discard(record);
                const reason = outcome.reason === 'CAP_REACHED'
                    ? FAILURE_REASON.CHARGE_CAP_REACHED
                    : FAILURE_REASON.BILLING_FAILED;
                state.abortReason = reason;
                await writer.write(
                    buildFailureRecord({
                        status: RECORD_STATUS.RUN_ABORTED,
                        input: item.ref,
                        marketplace: item.marketplace,
                        asin: item.asin,
                        reason,
                    }),
                );
                accounting.settle(item.key, RECORD_STATUS.RUN_ABORTED);
                return false;
            }
        } else {
            accounting.registerDuplicate();
        }
        accounting.settle(item.key, RECORD_STATUS.SUCCESS);
        return emitted;
    }

    // ---- driver: bounded concurrency, dynamic limit, cooperative shutdown ----

    const inFlight = new Set<Promise<void>>();

    while (true) {
        const stop = shouldStop();
        if (stop !== null) {
            state.abortReason = stop;
            break;
        }

        const limit = liveLimit();
        while (queue.length > 0 && inFlight.size < limit) {
            const item = queue.shift();
            if (item === undefined) break;
            if (item.kind === 'PRODUCT' && item.invalidReason === undefined) inFlightProducts += 1;
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
                    if (item.kind === 'PRODUCT' && item.invalidReason === undefined) inFlightProducts -= 1;
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

    await writer.flush();

    return {
        processed: state.processed,
        discovered: state.discovered,
        searchPagesFetched: state.searchPages,
        discoveryTruncated: state.discoveryTruncated,
        aborted: pending.length,
        abortReason: state.abortReason,
        peakConcurrency: state.peakConcurrency,
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
