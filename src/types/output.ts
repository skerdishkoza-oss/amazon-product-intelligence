/**
 * Output schema v1.5. Spec sections 5.2, 5.4, 5.5, 6.x, 7, Appendix A and B.
 *
 * Every block that can fail carries its own `status`. A null value without a
 * status is a bug, and the JSON-Schema golden test in quality/validation.ts
 * rejects it.
 */

import type { Money } from './money.js';
import type { FailureReason, FieldStatus, RecordStatus } from './status.js';
import type { DataBlock, DataProfile } from './input.js';

export const SCHEMA_VERSION = '1.5';

export type MarketplaceCode = 'US' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES' | 'CA';

export type ProxyTier = 'DATACENTER' | 'RESIDENTIAL' | 'EXTERNAL' | 'BROWSER' | 'NONE';

export type InputType = 'asin' | 'url' | 'keyword' | 'dataset' | 'category' | 'bestsellers' | 'seller' | 'variant';

export interface InputRef {
    type: InputType;
    value: string;
}

export interface DiscoverySource {
    type: InputType;
    value: string;
    page?: number;
    position?: number;
    /** Position within the source page, including sponsored results. */
    pagePosition?: number;
    sponsored?: boolean;
    /** Position among organic results across every parsed page for this source. */
    organicPosition?: number | null;
    /** Position among sponsored results across every parsed page for this source. */
    sponsoredPosition?: number | null;
}

/* ------------------------------------------------------------------ blocks */

export type PriceSource =
    | 'BUY_BOX'
    | 'DEAL_PRICE'
    | 'CORE_PRICE_DISPLAY'
    | 'JSON_LD'
    | 'SEARCH_CARD'
    | 'TWISTER'
    | 'DETAIL_BULLETS';

export interface Coupon {
    text: string | null;
    type: 'PERCENT' | 'AMOUNT' | 'UNKNOWN';
    percent: number | null;
    amount: Money | null;
}

export interface PricingBlock {
    currentPrice: Money | null;
    listPrice: Money | null;
    discountAmount: Money | null;
    discountPercent: number | null;
    dealPrice: Money | null;
    dealType: string | null;
    coupon: Coupon | null;
    subscribeAndSave: Money | null;
    unitPrice: string | null;
    priceSource: PriceSource | null;
    status: FieldStatus;
}

export type AvailabilityState =
    | 'IN_STOCK'
    | 'OUT_OF_STOCK'
    | 'PREORDER'
    | 'BACKORDER'
    | 'LIMITED_STOCK'
    | 'UNKNOWN';

export interface AvailabilityBlock {
    state: AvailabilityState;
    inStock: boolean | null;
    availabilityText: string | null;
    stockLeftText: string | null;
    deliveryDate: string | null;
    deliveryText: string | null;
    shippingPrice: Money | null;
    primeEligible: boolean | null;
    shipsFrom: string | null;
    soldBy: string | null;
    status: FieldStatus;
}

export type RankingSource = 'DETAIL_BULLETS' | 'PRODUCT_DETAILS_TABLE' | 'PRODUCT_INFORMATION';

export interface RankEntry {
    rank: number;
    category: string;
}

export interface RankingsBlock {
    mainBSR: number | null;
    mainBSRCategory: string | null;
    all: RankEntry[];
    boughtInPastMonthRaw: string | null;
    boughtInPastMonthMin: number | null;
    /** C20: which surface produced the ranks. */
    source: RankingSource | null;
    status: FieldStatus;
}

export interface RatingsBlock {
    rating: number | null;
    reviewCount: number | null;
    starDistribution: Record<string, number> | null;
    status: FieldStatus;
}

export type Fulfillment = 'AMZ' | 'FBA' | 'FBM' | 'UNKNOWN';

export interface BuyBoxBlock {
    present: boolean;
    seller: string | null;
    sellerId: string | null;
    price: Money | null;
    shipsFrom: string | null;
    fulfillment: Fulfillment;
    amazonIsSeller: boolean | null;
    status: FieldStatus;
}

export type VariantMode = 'none' | 'discover' | 'price' | 'full';

/**
 * C13: in `discover` mode `price` and `availability` are absent, not null, so a
 * consumer can tell "not requested" from "requested and missing".
 */
export interface VariantItem {
    asin: string;
    options: Record<string, string>;
    price?: Money | null;
    availability?: AvailabilityState;
    status?: FieldStatus;
}

export interface VariantsBlock {
    mode: VariantMode;
    dimensions: string[];
    items: VariantItem[];
    truncated: boolean;
    truncatedAt?: number;
    status: FieldStatus;
}

export interface ProductContentBlock {
    bullets: string[];
    description: string | null;
    specifications: Record<string, string>;
    technicalDetails: Record<string, string>;
    manufacturer: string | null;
    model: string | null;
    partNumber: string | null;
    productType: string | null;
    breadcrumb: string[];
    dimensions: string | null;
    packageDimensions: string | null;
    weight: string | null;
    dateFirstAvailable: string | null;
    aPlusContent: boolean | null;
    badges: string[];
    status: FieldStatus;
}

export interface MediaBlock {
    mainImage: string | null;
    images: string[];
    videos: string[];
    status: FieldStatus;
}

export type OfferCondition = 'NEW' | 'USED' | 'REFURBISHED' | 'COLLECTIBLE' | 'UNKNOWN';

export interface OfferItem {
    sellerId: string | null;
    sellerName: string | null;
    condition: OfferCondition;
    itemPrice: Money | null;
    shippingPrice: Money | null;
    landedPrice: Money | null;
    primeEligible: boolean | null;
    fulfillment: Fulfillment;
    deliveryText: string | null;
    sellerRating: number | null;
    sellerFeedbackCount: number | null;
    sourceUrl: string;
    status: FieldStatus;
}

export interface OffersBlock {
    requested: boolean;
    totalCount: number | null;
    items: OfferItem[];
    truncated: boolean;
    status: FieldStatus;
}

export interface SellerFeedbackWindow {
    positivePercent: number | null;
    neutralPercent: number | null;
    negativePercent: number | null;
    count: number | null;
}

export interface SellerProfile {
    sellerId: string;
    sellerName: string | null;
    businessName: string | null;
    businessAddress: string | null;
    rating: number | null;
    feedbackCount: number | null;
    feedback30Days: SellerFeedbackWindow | null;
    feedback90Days: SellerFeedbackWindow | null;
    feedback365Days: SellerFeedbackWindow | null;
    legalIdentifiers: Record<string, string>;
    sourceUrl: string;
    status: FieldStatus;
}

export interface SellerProfilesBlock {
    requested: boolean;
    items: SellerProfile[];
    status: FieldStatus;
}

export type ChangeType =
    | 'PRICE_CHANGED'
    | 'DISCOUNT_CHANGED'
    | 'COUPON_ADDED'
    | 'COUPON_REMOVED'
    | 'OUT_OF_STOCK'
    | 'BACK_IN_STOCK'
    | 'BUY_BOX_CHANGED'
    | 'SELLER_COUNT_CHANGED'
    | 'BSR_CHANGED'
    | 'RATING_CHANGED'
    | 'REVIEW_COUNT_CHANGED'
    | 'PRODUCT_REMOVED_OR_UNAVAILABLE';

export interface ProductChange {
    type: ChangeType;
    field: string;
    before: unknown;
    after: unknown;
    percentChange: number | null;
}

export interface MonitoringBlock {
    requested: boolean;
    compared: boolean;
    previousDatasetId: string | null;
    previousScrapedAt: string | null;
    changed: boolean;
    changes: ProductChange[];
    /** Machine-readable reasons why a comparison was unavailable or a block was suppressed. */
    warnings: string[];
    status: FieldStatus;
}

/** C4. `applied: false` means the price is whatever an unlocated session sees. */
export interface LocationBlock {
    requestedCountry: string | null;
    requestedPostalCode: string | null;
    resolvedPostalCode: string | null;
    applied: boolean;
    method: 'SESSION_COOKIE' | 'QUERY_PARAM' | 'NONE' | null;
    status: FieldStatus;
}

export interface SourcesBlock {
    detailPage?: string;
    searchPage?: string;
    offersPage?: string;
    priceStrategy?: PriceSource | null;
    [key: string]: string | null | undefined;
}

export type PageType =
    | 'STANDARD_PRODUCT'
    | 'BOOK_OR_MEDIA'
    | 'VARIATION_PARENT'
    | 'UNAVAILABLE'
    | 'NOT_FOUND'
    | 'CHALLENGE'
    | 'SEARCH'
    | 'UNKNOWN';

export interface QualityBlock {
    completenessScore: number;
    fetchAttempts: number;
    proxyTier: ProxyTier;
    pageType: PageType;
    blocked: boolean;
    criticalFieldsMissing: string[];
    warnings: string[];
    parserVersion: string;
}

export type ProductBillingEvent = 'product-basic' | 'product-essential' | 'product-detail' | 'product-check';

export interface RetrievalBlock {
    profile: DataProfile;
    requestedBlocks: DataBlock[];
    billingEvent: ProductBillingEvent;
}

/* ----------------------------------------------------------------- records */

export interface ProductRecord {
    schemaVersion: string;
    status: 'SUCCESS';
    /** C1: ISO 8601 UTC, taken at response receipt. */
    scrapedAt: string;
    input: InputRef;
    marketplace: MarketplaceCode;
    asin: string;
    parentAsin: string | null;
    canonicalUrl: string;
    title: string | null;
    brand: string | null;
    retrieval: RetrievalBlock;
    pricing: PricingBlock;
    availability: AvailabilityBlock;
    rankings: RankingsBlock;
    ratings: RatingsBlock;
    buyBox: BuyBoxBlock;
    variants: VariantsBlock;
    product: ProductContentBlock;
    media: MediaBlock;
    offers: OffersBlock;
    sellerProfiles: SellerProfilesBlock;
    monitoring: MonitoringBlock;
    location: LocationBlock;
    sources: SourcesBlock;
    quality: QualityBlock;
    discoveredFrom: DiscoverySource[];
    deprecations: string[];
}

export interface FailureRecord {
    schemaVersion: string;
    status: Exclude<RecordStatus, 'SUCCESS'>;
    scrapedAt: string;
    input: InputRef;
    marketplace: MarketplaceCode | null;
    asin: string | null;
    attempts: number;
    reason: FailureReason;
    lastProxyTier: ProxyTier;
    chargedProductEvent: false;
    message?: string;
}

export type DatasetRecord = ProductRecord | FailureRecord;

export function isProductRecord(r: DatasetRecord): r is ProductRecord {
    return r.status === 'SUCCESS';
}

/* ----------------------------------------------------------------- summary */

export interface RunSummary {
    schemaVersion: string;
    runStartedAt: string;
    runFinishedAt: string;
    marketplaces: MarketplaceCode[];
    mode: string;
    requested: number;
    uniqueInputs: number;
    success: number;
    productNotFound: number;
    blocked: number;
    fetchFailed: number;
    parserError: number;
    geoRestricted: number;
    invalidInput: number;
    requiresLocation: number;
    runAborted: number;
    accountedFor: number;
    /** C9/10.3: asserted in code before this object is written. */
    accountingInvariantHolds: boolean;
    duplicatesMerged: number;
    filteredOut: number;
    /** Products found by keyword/category discovery rather than requested directly. */
    discoveredProducts: number;
    searchPagesFetched: number;
    /** True when discovery hit maxProducts and stopped enqueuing. */
    discoveryTruncated: boolean;
    monitoringChecked: number;
    monitoringCompared: number;
    monitoringChanged: number;
    peakConcurrency: number;
    primingRequests: number;
    blockRateProductPages: number;
    blockRateSearchPages: number;
    residentialEscalations: number;
    successfulPaidEvents: number;
    failedPaidEvents: number;
    chargeCapReached: boolean;
    warnings: string[];
    parserVersion: string;
}
