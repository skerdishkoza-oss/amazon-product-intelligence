/**
 * Spec v1.1 sections 3.1, 5.1. ASIN and URL normalization, and the dedupe key.
 */

import { getMarketplace, marketplaceFromHost } from '../amazon/marketplace-config/index.js';
import type { InputType, MarketplaceCode } from '../types/output.js';
import { FAILURE_REASON, type FailureReason } from '../types/status.js';

/** ISBN-10 ASINs are all digits, so do not require a leading B0. */
const ASIN_RE = /^[A-Z0-9]{10}$/;

const ASIN_IN_PATH = [
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/dp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
];

export function normalizeAsin(raw: string): string | null {
    const s = raw.trim().toUpperCase();
    return ASIN_RE.test(s) ? s : null;
}

export interface ClassifiedUrl {
    type: Extract<InputType, 'url' | 'keyword' | 'category' | 'bestsellers' | 'seller'>;
    marketplace: MarketplaceCode;
    asin: string | null;
    keyword: string | null;
    node: string | null;
    sellerId: string | null;
    canonical: string;
}

export type UrlClassification =
    | { ok: true; value: ClassifiedUrl }
    | { ok: false; reason: FailureReason };

/**
 * Classify a user-supplied Amazon URL. Never throws; an unsupported URL becomes
 * a structured INVALID_INPUT row rather than a dropped input.
 */
export function classifyUrl(raw: string): UrlClassification {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return { ok: false, reason: FAILURE_REASON.URL_UNSUPPORTED };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, reason: FAILURE_REASON.URL_UNSUPPORTED };
    }

    const marketplace = marketplaceFromHost(url.hostname);
    if (marketplace === null) return { ok: false, reason: FAILURE_REASON.MARKETPLACE_UNSUPPORTED };
    const cfg = getMarketplace(marketplace);

    const asinFromQuery = url.searchParams.get('asin');
    let asin: string | null = asinFromQuery ? normalizeAsin(asinFromQuery) : null;
    if (asin === null) {
        for (const re of ASIN_IN_PATH) {
            const m = re.exec(url.pathname);
            if (m?.[1]) {
                asin = normalizeAsin(m[1]);
                if (asin !== null) break;
            }
        }
    }
    if (asin !== null) {
        return {
            ok: true,
            value: {
                type: 'url',
                marketplace,
                asin,
                keyword: null,
                node: null,
                sellerId: null,
                canonical: `https://${cfg.host}/dp/${asin}`,
            },
        };
    }

    const path = url.pathname.toLowerCase();

    const sellerId = url.searchParams.get('seller') ?? url.searchParams.get('me');
    if (sellerId || path.includes('/stores/') || path === '/sp' || path.startsWith('/sp/')) {
        return {
            ok: true,
            value: {
                type: 'seller',
                marketplace,
                asin: null,
                keyword: null,
                node: null,
                sellerId,
                canonical: url.toString(),
            },
        };
    }

    if (path.includes('/bestsellers') || path.includes('/gp/bestsellers') || path.includes('/zgbs')) {
        return {
            ok: true,
            value: {
                type: 'bestsellers',
                marketplace,
                asin: null,
                keyword: null,
                node: url.searchParams.get('node'),
                sellerId: null,
                canonical: url.toString(),
            },
        };
    }

    if (path === '/s' || path.startsWith('/s/') || url.searchParams.has('k')) {
        const keyword = url.searchParams.get('k');
        return {
            ok: true,
            value: {
                type: 'keyword',
                marketplace,
                asin: null,
                keyword,
                node: url.searchParams.get('rh') ?? url.searchParams.get('node'),
                sellerId: null,
                canonical: url.toString(),
            },
        };
    }

    if (url.searchParams.has('node') || path.includes('/b/') || path.includes('/gp/browse')) {
        return {
            ok: true,
            value: {
                type: 'category',
                marketplace,
                asin: null,
                keyword: null,
                node: url.searchParams.get('node'),
                sellerId: null,
                canonical: url.toString(),
            },
        };
    }

    return { ok: false, reason: FAILURE_REASON.URL_NO_ASIN };
}

export function canonicalProductUrl(marketplace: MarketplaceCode, asin: string): string {
    const cfg = getMarketplace(marketplace);
    return `https://${cfg.host}${cfg.paths.product.replace('{asin}', asin)}`;
}

export function searchUrl(marketplace: MarketplaceCode, keyword: string, page = 1): string {
    const cfg = getMarketplace(marketplace);
    const url = new URL(`https://${cfg.host}/s`);
    url.searchParams.set('k', keyword);
    if (page > 1) url.searchParams.set('page', String(page));
    return url.toString();
}

/**
 * C3: the dedupe key includes the resolved delivery location. Amazon prices
 * differ by location, so marketplace + ASIN alone silently discards the second
 * observation when one run covers two postal codes.
 */
export function locationKey(resolvedPostalCode: string | null): string {
    return resolvedPostalCode && resolvedPostalCode.trim() !== '' ? resolvedPostalCode.trim() : 'default';
}

export function dedupeKey(
    marketplace: MarketplaceCode,
    asin: string,
    resolvedPostalCode: string | null,
): string {
    return `${marketplace}|${asin}|${locationKey(resolvedPostalCode)}`;
}
