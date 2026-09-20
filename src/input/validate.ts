/**
 * Spec v1.1 section 3.2. Validate and default the raw input.
 *
 * Rejected *items* (a malformed ASIN) are not thrown away here -- they are
 * returned as rejections so main.ts can emit an INVALID_INPUT row for each,
 * which is what keeps the 10.3 accounting invariant true. Only a structurally
 * unusable *input object* throws.
 */

import { isSupportedMarketplace, SUPPORTED_MARKETPLACES } from '../amazon/marketplace-config/index.js';
import { INPUT_DEFAULTS, type ActorInput, type RawActorInput, type RunMode } from '../types/input.js';
import type { MarketplaceCode, VariantMode } from '../types/output.js';
import { FAILURE_REASON, type FailureReason } from '../types/status.js';
import { normalizeAsin } from './normalizer.js';

const MODES: RunMode[] = ['fast', 'detail'];
const VARIANT_MODES: VariantMode[] = ['none', 'discover', 'price', 'full'];

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

export function validateInput(raw: RawActorInput | null | undefined): ValidatedInput {
    const src = raw ?? {};
    const warnings: string[] = [];
    const rejected: RejectedItem[] = [];

    const mode = (src.mode ?? INPUT_DEFAULTS.mode) as RunMode;
    if (!MODES.includes(mode)) throw new InputError(`mode must be one of ${MODES.join(', ')}`);

    if (src.marketplace !== undefined && typeof src.marketplace !== 'string') {
        throw new InputError('marketplace must be a string');
    }
    const marketplaceRaw = (src.marketplace ?? INPUT_DEFAULTS.marketplace).toUpperCase();
    if (!isSupportedMarketplace(marketplaceRaw)) {
        throw new InputError(
            `marketplace "${marketplaceRaw}" is not supported in V1. Supported: ${SUPPORTED_MARKETPLACES.join(', ')}`,
        );
    }
    const marketplace = marketplaceRaw as MarketplaceCode;

    const variantMode = (src.variantMode ?? INPUT_DEFAULTS.variantMode) as VariantMode;
    if (!VARIANT_MODES.includes(variantMode)) {
        throw new InputError(`variantMode must be one of ${VARIANT_MODES.join(', ')}`);
    }

    const asins: string[] = [];
    for (const candidate of asStringArray(src.asins, 'asins')) {
        const normalized = normalizeAsin(candidate);
        if (normalized === null) {
            rejected.push({ type: 'asin', value: candidate, reason: FAILURE_REASON.ASIN_MALFORMED });
        } else {
            asins.push(normalized);
        }
    }

    const urls = asStringArray(src.urls, 'urls');
    // A single API keyword such as "coffee maker" is one search phrase, not
    // two separate keywords. Arrays remain the unambiguous multi-keyword form.
    const keywords = asStringArray(src.keywords, 'keywords', /[;\n]+/);

    if (src.datasetId !== undefined && src.datasetId !== null && typeof src.datasetId !== 'string') {
        throw new InputError('datasetId must be a string');
    }
    const datasetId = src.datasetId?.trim() || null;

    if (asins.length === 0 && urls.length === 0 && keywords.length === 0 && datasetId === null && rejected.length === 0) {
        throw new InputError('no inputs provided: supply at least one of asins, urls, keywords or datasetId');
    }

    if (src.includeOffers === true) {
        throw new InputError('includeOffers is planned for V1.2 and is not available in this release');
    }
    if (src.includeSellerDetails === true) {
        throw new InputError('includeSellerDetails is planned for V1.2 and is not available in this release');
    }
    if (src.compareWithDatasetId != null && String(src.compareWithDatasetId).trim() !== '') {
        throw new InputError('compareWithDatasetId is planned for V1.4 and is not available in this release');
    }

    const requestedSchemaVersion = src.schemaVersion ?? '1.1';
    if (requestedSchemaVersion !== '1.1') {
        warnings.push(`caller expects schemaVersion ${requestedSchemaVersion}; this Actor emits 1.1`);
    }

    const postalCode = src.postalCode?.trim() || null;
    const requireLocation = bool(src.requireLocation, INPUT_DEFAULTS.requireLocation);
    if (requireLocation && postalCode === null) {
        warnings.push('requireLocation is on but no postalCode was given; no location will be applied');
    }

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
        variantMode,
        includeOffers: bool(src.includeOffers, INPUT_DEFAULTS.includeOffers),
        maxOffersPerProduct: clampInt(src.maxOffersPerProduct, INPUT_DEFAULTS.maxOffersPerProduct, 1, 100, 'maxOffersPerProduct', warnings),
        includeSellerDetails: bool(src.includeSellerDetails, INPUT_DEFAULTS.includeSellerDetails),
        maxProducts: clampInt(src.maxProducts, INPUT_DEFAULTS.maxProducts, 1, 1_000_000, 'maxProducts', warnings),
        maxSearchPages: clampInt(src.maxSearchPages, INPUT_DEFAULTS.maxSearchPages, 1, 20, 'maxSearchPages', warnings),
        maxVariants: clampInt(src.maxVariants, INPUT_DEFAULTS.maxVariants, 1, 500, 'maxVariants', warnings),
        maxRetries: clampInt(src.maxRetries, INPUT_DEFAULTS.maxRetries, 0, 10, 'maxRetries', warnings),
        deduplicate: bool(src.deduplicate, INPUT_DEFAULTS.deduplicate),
        allowResidentialFallback: bool(src.allowResidentialFallback, INPUT_DEFAULTS.allowResidentialFallback),
        proxyConfiguration: src.proxyConfiguration ?? null,
        compareWithDatasetId: src.compareWithDatasetId?.trim() || null,
        requestedSchemaVersion,
    };

    return { input, rejected, warnings };
}
