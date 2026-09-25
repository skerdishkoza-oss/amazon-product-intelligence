/**
 * Spec v1.1 sections 5.2, 5.4 (C1, C4).
 *
 * Records are only ever constructed here, so no code path can emit a record
 * without scrapedAt, without a location block, or with a null field that has
 * no status explaining it.
 */

import { canonicalProductUrl } from '../input/normalizer.js';
import type {
    AvailabilityBlock,
    BuyBoxBlock,
    DiscoverySource,
    FailureRecord,
    InputRef,
    LocationBlock,
    MarketplaceCode,
    MediaBlock,
    MonitoringBlock,
    OffersBlock,
    PricingBlock,
    ProductContentBlock,
    ProductRecord,
    ProxyTier,
    QualityBlock,
    RankingsBlock,
    RatingsBlock,
    RetrievalBlock,
    SellerProfilesBlock,
    VariantMode,
    VariantsBlock,
} from '../types/output.js';
import { SCHEMA_VERSION } from '../types/output.js';
import { FIELD_STATUS, RECORD_STATUS, type FailureReason, type FieldStatus, type RecordStatus } from '../types/status.js';

export const PARSER_VERSION = '2026-09-25.1';

/** C1: ISO 8601 UTC with a Z suffix, taken at response receipt. */
export function nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function emptyPricing(status: FieldStatus = FIELD_STATUS.PARSER_MISS): PricingBlock {
    return {
        currentPrice: null,
        listPrice: null,
        discountAmount: null,
        discountPercent: null,
        dealPrice: null,
        dealType: null,
        coupon: null,
        subscribeAndSave: null,
        unitPrice: null,
        priceSource: null,
        status,
    };
}

export function emptyAvailability(status: FieldStatus = FIELD_STATUS.PARSER_MISS): AvailabilityBlock {
    return {
        state: 'UNKNOWN',
        inStock: null,
        availabilityText: null,
        stockLeftText: null,
        deliveryDate: null,
        deliveryText: null,
        shippingPrice: null,
        primeEligible: null,
        shipsFrom: null,
        soldBy: null,
        status,
    };
}

export function emptyRankings(status: FieldStatus = FIELD_STATUS.PARSER_MISS): RankingsBlock {
    return {
        mainBSR: null,
        mainBSRCategory: null,
        all: [],
        boughtInPastMonthRaw: null,
        boughtInPastMonthMin: null,
        source: null,
        status,
    };
}

export function emptyRatings(status: FieldStatus = FIELD_STATUS.PARSER_MISS): RatingsBlock {
    return { rating: null, reviewCount: null, starDistribution: null, status };
}

export function emptyBuyBox(status: FieldStatus = FIELD_STATUS.PARSER_MISS): BuyBoxBlock {
    return {
        present: false,
        seller: null,
        sellerId: null,
        price: null,
        shipsFrom: null,
        fulfillment: 'UNKNOWN',
        amazonIsSeller: null,
        status,
    };
}

/**
 * C13: in `discover` mode the per-child price and availability keys are absent
 * rather than null, so a consumer can distinguish "not requested" from
 * "requested and missing".
 */
export function emptyVariants(mode: VariantMode, status: FieldStatus = FIELD_STATUS.NOT_APPLICABLE): VariantsBlock {
    return { mode, dimensions: [], items: [], truncated: false, status };
}

export function emptyProductContent(status: FieldStatus = FIELD_STATUS.PARSER_MISS): ProductContentBlock {
    return {
        bullets: [],
        description: null,
        specifications: {},
        technicalDetails: {},
        manufacturer: null,
        model: null,
        partNumber: null,
        productType: null,
        breadcrumb: [],
        dimensions: null,
        packageDimensions: null,
        weight: null,
        dateFirstAvailable: null,
        aPlusContent: null,
        badges: [],
        status,
    };
}

export function emptyMedia(status: FieldStatus = FIELD_STATUS.PARSER_MISS): MediaBlock {
    return { mainImage: null, images: [], videos: [], status };
}

export function emptyOffers(requested = false, status?: FieldStatus): OffersBlock {
    return {
        requested,
        totalCount: null,
        items: [],
        truncated: false,
        status: status ?? (requested ? FIELD_STATUS.PARSER_MISS : FIELD_STATUS.NOT_APPLICABLE),
    };
}

export function emptySellerProfiles(requested = false, status?: FieldStatus): SellerProfilesBlock {
    return {
        requested,
        items: [],
        status: status ?? (requested ? FIELD_STATUS.PARSER_MISS : FIELD_STATUS.NOT_APPLICABLE),
    };
}

export function emptyMonitoring(requested = false, previousDatasetId: string | null = null): MonitoringBlock {
    return {
        requested,
        compared: false,
        previousDatasetId,
        previousScrapedAt: null,
        changed: false,
        changes: [],
        warnings: [],
        status: requested ? FIELD_STATUS.NOT_PRESENT : FIELD_STATUS.NOT_APPLICABLE,
    };
}

export function locationBlock(args: {
    requestedCountry: string | null;
    requestedPostalCode: string | null;
    resolvedPostalCode: string | null;
    applied: boolean;
    method: LocationBlock['method'];
}): LocationBlock {
    const status = args.requestedPostalCode === null
        ? FIELD_STATUS.NOT_APPLICABLE
        : args.applied
            ? FIELD_STATUS.EXTRACTED
            : FIELD_STATUS.REQUIRES_LOCATION;
    return { ...args, status };
}

export function qualityBlock(overrides: Partial<QualityBlock> = {}): QualityBlock {
    return {
        completenessScore: 0,
        fetchAttempts: 0,
        proxyTier: 'NONE',
        pageType: 'UNKNOWN',
        blocked: false,
        criticalFieldsMissing: [],
        warnings: [],
        parserVersion: PARSER_VERSION,
        ...overrides,
    };
}

export interface ProductRecordDraft {
    input: InputRef;
    marketplace: MarketplaceCode;
    asin: string;
    parentAsin?: string | null;
    canonicalUrl?: string;
    title?: string | null;
    brand?: string | null;
    retrieval?: RetrievalBlock;
    pricing?: PricingBlock;
    availability?: AvailabilityBlock;
    rankings?: RankingsBlock;
    ratings?: RatingsBlock;
    buyBox?: BuyBoxBlock;
    variants?: VariantsBlock;
    product?: ProductContentBlock;
    media?: MediaBlock;
    offers?: OffersBlock;
    sellerProfiles?: SellerProfilesBlock;
    monitoring?: MonitoringBlock;
    location: LocationBlock;
    sources?: ProductRecord['sources'];
    quality?: QualityBlock;
    discoveredFrom?: DiscoverySource[];
    scrapedAt?: string;
}

export function buildProductRecord(draft: ProductRecordDraft): ProductRecord {
    return {
        schemaVersion: SCHEMA_VERSION,
        status: RECORD_STATUS.SUCCESS,
        scrapedAt: draft.scrapedAt ?? nowIso(),
        input: draft.input,
        marketplace: draft.marketplace,
        asin: draft.asin,
        parentAsin: draft.parentAsin ?? null,
        canonicalUrl: draft.canonicalUrl ?? canonicalProductUrl(draft.marketplace, draft.asin),
        title: draft.title ?? null,
        brand: draft.brand ?? null,
        retrieval: draft.retrieval ?? {
            profile: 'catalog',
            requestedBlocks: ['pricing', 'availability', 'ratings', 'rankings', 'buyBox', 'variants', 'product', 'media'],
            billingEvent: 'product-detail',
        },
        pricing: draft.pricing ?? emptyPricing(),
        availability: draft.availability ?? emptyAvailability(),
        rankings: draft.rankings ?? emptyRankings(),
        ratings: draft.ratings ?? emptyRatings(),
        buyBox: draft.buyBox ?? emptyBuyBox(),
        variants: draft.variants ?? emptyVariants('none'),
        product: draft.product ?? emptyProductContent(),
        media: draft.media ?? emptyMedia(),
        offers: draft.offers ?? emptyOffers(),
        sellerProfiles: draft.sellerProfiles ?? emptySellerProfiles(),
        monitoring: draft.monitoring ?? emptyMonitoring(),
        location: draft.location,
        sources: draft.sources ?? {},
        quality: draft.quality ?? qualityBlock(),
        discoveredFrom: draft.discoveredFrom ?? [],
        deprecations: [],
    };
}

export function buildFailureRecord(args: {
    status: Exclude<RecordStatus, 'SUCCESS'>;
    input: InputRef;
    marketplace: MarketplaceCode | null;
    asin?: string | null;
    attempts?: number;
    reason: FailureReason;
    lastProxyTier?: ProxyTier;
    message?: string;
    scrapedAt?: string;
}): FailureRecord {
    const record: FailureRecord = {
        schemaVersion: SCHEMA_VERSION,
        status: args.status,
        scrapedAt: args.scrapedAt ?? nowIso(),
        input: args.input,
        marketplace: args.marketplace,
        asin: args.asin ?? null,
        attempts: args.attempts ?? 0,
        reason: args.reason,
        lastProxyTier: args.lastProxyTier ?? 'NONE',
        chargedProductEvent: false,
    };
    if (args.message !== undefined) record.message = args.message;
    return record;
}
