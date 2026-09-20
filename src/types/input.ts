/** Spec v1.1 section 3.2. The shape after normalization and defaulting. */

import type { MarketplaceCode, VariantMode } from './output.js';

export type RunMode = 'fast' | 'detail' | 'intelligence' | 'monitor';

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
