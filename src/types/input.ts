/** Spec v1.1 section 3.2. The shape after normalization and defaulting. */

import type { MarketplaceCode, VariantMode } from './output.js';

export type RunMode = 'fast' | 'detail' | 'intelligence' | 'monitor';
export type DataProfile = 'essential' | 'catalog' | 'competitive' | 'custom';
export type DataBlock =
    | 'pricing'
    | 'availability'
    | 'ratings'
    | 'rankings'
    | 'buyBox'
    | 'variants'
    | 'product'
    | 'media'
    | 'offers'
    | 'sellerProfiles';
export type SponsoredPolicy = 'include' | 'exclude' | 'only';

export interface DiscoveryFiltersInput {
    minPrice?: number | null;
    maxPrice?: number | null;
    minRating?: number | null;
    minReviewCount?: number | null;
    primeOnly?: boolean;
    sponsoredPolicy?: string;
    minBoughtInPastMonth?: number | null;
    minDiscountPercent?: number | null;
}

export interface DiscoveryFilters {
    minPrice: number | null;
    maxPrice: number | null;
    minRating: number | null;
    minReviewCount: number | null;
    primeOnly: boolean;
    sponsoredPolicy: SponsoredPolicy;
    minBoughtInPastMonth: number | null;
    minDiscountPercent: number | null;
}

export interface ProxyInput {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
}

/** Raw input as it arrives from the Apify Input UI or API. Everything optional. */
export interface RawActorInput {
    mode?: string;
    marketplace?: string;
    asins?: unknown;
    urls?: unknown;
    keywords?: unknown;
    /** Raw JSON item rows: strings or objects containing one of asin/url/keyword. */
    items?: unknown;
    datasetId?: string | null;
    datasetField?: string;
    deliveryCountry?: string | null;
    postalCode?: string | null;
    requireLocation?: boolean;
    dataProfile?: string;
    dataBlocks?: unknown;
    discoveryFilters?: DiscoveryFiltersInput | null;
    variantMode?: string;
    includeOffers?: boolean;
    maxOffersPerProduct?: number;
    includeSellerDetails?: boolean;
    maxProducts?: number;
    maxSearchPages?: number;
    maxVariants?: number;
    maxRetries?: number;
    deduplicate?: boolean;
    allowResidentialFallback?: boolean;
    proxyConfiguration?: ProxyInput | null;
    compareWithDatasetId?: string | null;
    schemaVersion?: string;
}

/** Validated, defaulted, internal shape. Nothing downstream sees RawActorInput. */
export interface ActorInput {
    mode: RunMode;
    marketplace: MarketplaceCode;
    asins: string[];
    urls: string[];
    keywords: string[];
    datasetId: string | null;
    datasetField: string;
    deliveryCountry: string | null;
    postalCode: string | null;
    requireLocation: boolean;
    dataProfile: DataProfile;
    /** Resolved blocks after expanding the selected profile and legacy flags. */
    dataBlocks: DataBlock[];
    discoveryFilters: DiscoveryFilters;
    variantMode: VariantMode;
    includeOffers: boolean;
    maxOffersPerProduct: number;
    includeSellerDetails: boolean;
    maxProducts: number;
    maxSearchPages: number;
    maxVariants: number;
    maxRetries: number;
    deduplicate: boolean;
    allowResidentialFallback: boolean;
    proxyConfiguration: ProxyInput | null;
    compareWithDatasetId: string | null;
    /** What the caller said they expect; mismatch is a warning only. */
    requestedSchemaVersion: string;
}

export const INPUT_DEFAULTS = {
    mode: 'detail',
    marketplace: 'US',
    datasetField: 'asin',
    requireLocation: false,
    dataProfile: 'catalog',
    discoveryFilters: {
        minPrice: null,
        maxPrice: null,
        minRating: null,
        minReviewCount: null,
        primeOnly: false,
        sponsoredPolicy: 'include',
        minBoughtInPastMonth: null,
        minDiscountPercent: null,
    },
    variantMode: 'discover',
    includeOffers: false,
    maxOffersPerProduct: 10,
    includeSellerDetails: false,
    maxProducts: 1000,
    maxSearchPages: 5,
    maxVariants: 50,
    maxRetries: 3,
    deduplicate: true,
    allowResidentialFallback: true,
} as const;
