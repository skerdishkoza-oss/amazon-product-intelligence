/**
 * Spec v1.1 section 3.2. Validate and default the raw input.
 *
 * Rejected *items* (a malformed ASIN) are not thrown away here -- they are
 * returned as rejections so main.ts can emit an INVALID_INPUT row for each,
 * which is what keeps the 10.3 accounting invariant true. Only a structurally
 * unusable *input object* throws.
 */

import { isSupportedMarketplace, SUPPORTED_MARKETPLACES } from '../amazon/marketplace-config/index.js';
import {
    INPUT_DEFAULTS,
    type ActorInput,
    type DataBlock,
    type DataProfile,
    type DiscoveryFilters,
    type DiscoveryFiltersInput,
    type RawActorInput,
    type RunMode,
    type SponsoredPolicy,
} from '../types/input.js';
import type { MarketplaceCode, VariantMode } from '../types/output.js';
import { FAILURE_REASON, type FailureReason } from '../types/status.js';
import { canonicalProductUrl, normalizeAsin, searchUrl } from './normalizer.js';
import { DATA_BLOCKS, resolveDataBlocks } from './profiles.js';

const MODES: RunMode[] = ['fast', 'detail', 'intelligence', 'monitor'];
const VARIANT_MODES: VariantMode[] = ['none', 'discover', 'price', 'full'];
const DATA_PROFILES: DataProfile[] = ['essential', 'catalog', 'competitive', 'custom'];
const SPONSORED_POLICIES: SponsoredPolicy[] = ['include', 'exclude', 'only'];
const FAST_BLOCKS = new Set<DataBlock>(['pricing', 'availability', 'ratings', 'rankings', 'media']);

export class InputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InputError';
    }
}

export interface RejectedItem {
    type: 'asin' | 'url' | 'keyword' | 'dataset';
    value: string;
    reason: FailureReason;
}

export interface ValidatedInput {
    input: ActorInput;
    rejected: RejectedItem[];
    warnings: string[];
}

function asStringArray(value: unknown, field: string, splitPattern: RegExp = /[\s,;\n]+/): string[] {
    if (value === undefined || value === null) return [];
    if (typeof value === 'string') return value.split(splitPattern).map((s) => s.trim()).filter((s) => s !== '');
    if (!Array.isArray(value)) throw new InputError(`${field} must be an array of strings`);
    const out: string[] = [];
    for (const item of value) {
        if (typeof item === 'string') {
            if (item.trim() !== '') out.push(item.trim());
        } else if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
            // requestListSources editor shape: [{ url: '...' }]
            out.push((item as { url: string }).url.trim());
        } else {
            throw new InputError(`${field} contains a value that is neither a string nor { url }`);
        }
    }
    return out;
}

function clampInt(value: unknown, fallback: number, min: number, max: number, field: string, warnings: string[]): number {
    if (value === undefined || value === null) return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) throw new InputError(`${field} must be a number`);
    const i = Math.trunc(n);
    if (i < min) {
        warnings.push(`${field}=${i} below minimum ${min}; clamped`);
        return min;
    }
    if (i > max) {
        warnings.push(`${field}=${i} above maximum ${max}; clamped`);
        return max;
    }
    return i;
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function optionalNumber(value: unknown, field: string, min: number, max: number, integer = false): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new InputError(`${field} must be a finite number`);
    if (integer && !Number.isInteger(value)) throw new InputError(`${field} must be an integer`);
    if (value < min || value > max) throw new InputError(`${field} must be between ${min} and ${max}`);
    return value;
}

function validateDiscoveryFilters(raw: DiscoveryFiltersInput | null | undefined): DiscoveryFilters {
    if (raw === undefined || raw === null) return { ...INPUT_DEFAULTS.discoveryFilters };
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('discoveryFilters must be an object');

    const allowed = new Set([
        'minPrice',
        'maxPrice',
        'minRating',
        'minReviewCount',
        'primeOnly',
        'sponsoredPolicy',
        'minBoughtInPastMonth',
        'minDiscountPercent',
    ]);
    const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
    if (unknown.length > 0) throw new InputError(`unknown discoveryFilters: ${unknown.join(', ')}`);

    const sponsoredPolicy = (raw.sponsoredPolicy ?? INPUT_DEFAULTS.discoveryFilters.sponsoredPolicy) as SponsoredPolicy;
    if (!SPONSORED_POLICIES.includes(sponsoredPolicy)) {
        throw new InputError(`discoveryFilters.sponsoredPolicy must be one of ${SPONSORED_POLICIES.join(', ')}`);
    }

    const filters: DiscoveryFilters = {
        minPrice: optionalNumber(raw.minPrice, 'discoveryFilters.minPrice', 0, 10_000_000),
        maxPrice: optionalNumber(raw.maxPrice, 'discoveryFilters.maxPrice', 0, 10_000_000),
        minRating: optionalNumber(raw.minRating, 'discoveryFilters.minRating', 0, 5),
        minReviewCount: optionalNumber(raw.minReviewCount, 'discoveryFilters.minReviewCount', 0, 1_000_000_000, true),
        primeOnly: bool(raw.primeOnly, INPUT_DEFAULTS.discoveryFilters.primeOnly),
        sponsoredPolicy,
        minBoughtInPastMonth: optionalNumber(
            raw.minBoughtInPastMonth,
            'discoveryFilters.minBoughtInPastMonth',
            0,
            1_000_000_000,
            true,
        ),
        minDiscountPercent: optionalNumber(raw.minDiscountPercent, 'discoveryFilters.minDiscountPercent', 0, 100),
    };
    if (filters.minPrice !== null && filters.maxPrice !== null && filters.minPrice > filters.maxPrice) {
        throw new InputError('discoveryFilters.minPrice cannot be greater than maxPrice');
    }
    return filters;
}

export function validateInput(raw: RawActorInput | null | undefined): ValidatedInput {
    const src = raw ?? {};
    const warnings: string[] = [];
    const rejected: RejectedItem[] = [];

    const mode = (src.mode ?? INPUT_DEFAULTS.mode) as RunMode;
    if (!MODES.includes(mode)) throw new InputError(`mode must be one of ${MODES.join(', ')}`);

    const defaultProfile: DataProfile = mode === 'fast' ? 'essential' : INPUT_DEFAULTS.dataProfile;
    const dataProfile = (src.dataProfile ?? defaultProfile) as DataProfile;
    if (!DATA_PROFILES.includes(dataProfile)) {
        throw new InputError(`dataProfile must be one of ${DATA_PROFILES.join(', ')}`);
    }
    let customBlocks: DataBlock[] = [];
    if (src.dataBlocks !== undefined && src.dataBlocks !== null) {
        if (!Array.isArray(src.dataBlocks) || src.dataBlocks.some((block) => typeof block !== 'string')) {
            throw new InputError('dataBlocks must be an array of block names');
        }
        const invalid = src.dataBlocks.filter((block) => !DATA_BLOCKS.includes(block as DataBlock));
        if (invalid.length > 0) throw new InputError(`unknown dataBlocks: ${invalid.join(', ')}`);
        customBlocks = [...new Set(src.dataBlocks as DataBlock[])];
    }
    if (dataProfile === 'custom' && customBlocks.length === 0) {
        throw new InputError('custom dataProfile requires at least one dataBlocks value');
    }
    if (dataProfile !== 'custom' && customBlocks.length > 0) {
        warnings.push('dataBlocks is ignored unless dataProfile is custom');
    }

    if (src.marketplace !== undefined && typeof src.marketplace !== 'string') {
        throw new InputError('marketplace must be a string');
    }
    const marketplaceRaw = (src.marketplace ?? INPUT_DEFAULTS.marketplace).toUpperCase();
    if (!isSupportedMarketplace(marketplaceRaw)) {
        throw new InputError(
            `marketplace "${marketplaceRaw}" is not supported. Supported: ${SUPPORTED_MARKETPLACES.join(', ')}`,
        );
    }
    const marketplace = marketplaceRaw as MarketplaceCode;

    const variantMode = (src.variantMode ?? INPUT_DEFAULTS.variantMode) as VariantMode;
    if (!VARIANT_MODES.includes(variantMode)) {
        throw new InputError(`variantMode must be one of ${VARIANT_MODES.join(', ')}`);
    }

    const asinCandidates = asStringArray(src.asins, 'asins');
    const urls = asStringArray(src.urls, 'urls');
    // A single API keyword such as "coffee maker" is one search phrase, not
    // two separate keywords. Arrays remain the unambiguous multi-keyword form.
    const keywords = asStringArray(src.keywords, 'keywords', /[;\n]+/);

    if (src.items !== undefined && src.items !== null) {
        if (!Array.isArray(src.items)) throw new InputError('items must be a JSON array');
        for (const rawItem of src.items) {
            if (typeof rawItem === 'string') {
                const value = rawItem.trim();
                if (/^https?:\/\//i.test(value)) urls.push(value);
                else asinCandidates.push(value);
                continue;
            }
            if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
                rejected.push({ type: 'url', value: JSON.stringify(rawItem) ?? String(rawItem), reason: FAILURE_REASON.URL_UNSUPPORTED });
                continue;
            }
            const row = rawItem as Record<string, unknown>;
            const supplied = ['asin', 'url', 'keyword'].filter((field) => typeof row[field] === 'string' && String(row[field]).trim() !== '');
            if (supplied.length !== 1) {
                rejected.push({ type: 'url', value: JSON.stringify(rawItem), reason: FAILURE_REASON.URL_UNSUPPORTED });
                continue;
            }
            const itemMarketplaceRaw = typeof row.marketplace === 'string' ? row.marketplace.toUpperCase() : marketplace;
            if (!isSupportedMarketplace(itemMarketplaceRaw)) {
                rejected.push({ type: 'url', value: JSON.stringify(rawItem), reason: FAILURE_REASON.MARKETPLACE_UNSUPPORTED });
                continue;
            }
            const field = supplied[0]!;
            const value = String(row[field]).trim();
            if (field === 'url') urls.push(value);
            else if (field === 'keyword') {
                if (itemMarketplaceRaw === marketplace) keywords.push(value);
                else urls.push(searchUrl(itemMarketplaceRaw, value));
            } else {
                const normalized = normalizeAsin(value);
                if (normalized === null) rejected.push({ type: 'asin', value, reason: FAILURE_REASON.ASIN_MALFORMED });
                else if (itemMarketplaceRaw === marketplace) asinCandidates.push(normalized);
                else urls.push(canonicalProductUrl(itemMarketplaceRaw, normalized));
            }
        }
    }

    const asins: string[] = [];
    for (const candidate of asinCandidates) {
        const normalized = normalizeAsin(candidate);
        if (normalized === null) {
            rejected.push({ type: 'asin', value: candidate, reason: FAILURE_REASON.ASIN_MALFORMED });
        } else {
            asins.push(normalized);
        }
    }

    if (src.datasetId !== undefined && src.datasetId !== null && typeof src.datasetId !== 'string') {
        throw new InputError('datasetId must be a string');
    }
    const datasetId = src.datasetId?.trim() || null;

    if (asins.length === 0 && urls.length === 0 && keywords.length === 0 && datasetId === null && rejected.length === 0) {
        throw new InputError('no inputs provided: supply at least one of asins, urls, keywords or datasetId');
    }

    if (src.compareWithDatasetId !== undefined
        && src.compareWithDatasetId !== null
        && typeof src.compareWithDatasetId !== 'string') {
        throw new InputError('compareWithDatasetId must be a string');
    }
    const compareWithDatasetId = src.compareWithDatasetId?.trim() || null;
    if (mode === 'monitor' && compareWithDatasetId === null) {
        throw new InputError('monitor mode requires compareWithDatasetId');
    }
    const includeOffersRequested = bool(src.includeOffers, INPUT_DEFAULTS.includeOffers);
    const includeSellerDetailsRequested = bool(src.includeSellerDetails, INPUT_DEFAULTS.includeSellerDetails);
    const dataBlocks = resolveDataBlocks({
        profile: dataProfile,
        customBlocks,
        includeOffers: includeOffersRequested,
        includeSellerDetails: includeSellerDetailsRequested,
    });
    const includeOffers = dataBlocks.includes('offers');
    const includeSellerDetails = dataBlocks.includes('sellerProfiles');

    if (includeSellerDetails && !includeOffers) {
        warnings.push('includeSellerDetails is enabled without includeOffers; only the Buy Box seller can be enriched');
    }
    if (mode === 'fast') {
        const unsupported = dataBlocks.filter((block) => !FAST_BLOCKS.has(block));
        if (unsupported.length > 0) {
            throw new InputError(`fast mode cannot provide data blocks: ${unsupported.join(', ')}; use detail or intelligence mode`);
        }
    }

    const requestedSchemaVersion = src.schemaVersion ?? '1.5';
    if (requestedSchemaVersion !== '1.5') {
        warnings.push(`caller expects schemaVersion ${requestedSchemaVersion}; this Actor emits 1.5`);
    }

    const postalCode = src.postalCode?.trim() || null;
    const requireLocation = bool(src.requireLocation, INPUT_DEFAULTS.requireLocation);
    if (requireLocation && postalCode === null) {
        warnings.push('requireLocation is on but no postalCode was given; no location will be applied');
    }

    const discoveryFilters = validateDiscoveryFilters(src.discoveryFilters);

    const input: ActorInput = {
        mode,
        marketplace,
        asins,
        urls,
        keywords,
        datasetId,
        datasetField: src.datasetField?.trim() || INPUT_DEFAULTS.datasetField,
        deliveryCountry: src.deliveryCountry?.trim() || null,
        postalCode,
        requireLocation,
        dataProfile,
        dataBlocks,
        discoveryFilters,
        variantMode,
        includeOffers,
        maxOffersPerProduct: clampInt(src.maxOffersPerProduct, INPUT_DEFAULTS.maxOffersPerProduct, 1, 100, 'maxOffersPerProduct', warnings),
        includeSellerDetails,
        maxProducts: clampInt(src.maxProducts, INPUT_DEFAULTS.maxProducts, 1, 1_000_000, 'maxProducts', warnings),
        maxSearchPages: clampInt(src.maxSearchPages, INPUT_DEFAULTS.maxSearchPages, 1, 20, 'maxSearchPages', warnings),
        maxVariants: clampInt(src.maxVariants, INPUT_DEFAULTS.maxVariants, 1, 500, 'maxVariants', warnings),
        maxRetries: clampInt(src.maxRetries, INPUT_DEFAULTS.maxRetries, 0, 10, 'maxRetries', warnings),
        deduplicate: bool(src.deduplicate, INPUT_DEFAULTS.deduplicate),
        allowResidentialFallback: bool(src.allowResidentialFallback, INPUT_DEFAULTS.allowResidentialFallback),
        proxyConfiguration: src.proxyConfiguration ?? null,
        compareWithDatasetId,
        requestedSchemaVersion,
    };

    return { input, rejected, warnings };
}
