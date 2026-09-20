/** Shared test doubles. Keeps the fetch seam swappable without a network. */

import type { FetchHealth, FetchRequest, FetchResult, Fetcher } from '../fetch/types.js';
import * as F from './fixtures/pages.js';

export const RECEIVED_AT = '2026-09-04T11:22:33Z';

/** Rewrite a fixture so it answers for a specific ASIN. */
const ASIN_INPUT_RE = /(id="ASIN"(?:\s+name="ASIN")?\s+value=")[A-Z0-9]{10}(")/;

export function fixtureFor(asin: string, base = F.US_STANDARD): string {
    // Assert on the pattern, not on whether the output differs: rewriting a
    // fixture to the ASIN it already has is a legitimate no-op.
    if (!ASIN_INPUT_RE.test(base)) {
        throw new Error('fixtureFor could not find the ASIN input; fixture changed shape');
    }
    return base.replace(ASIN_INPUT_RE, `$1${asin}$2`);
}

export function ok(html: string, overrides: Partial<Extract<FetchResult, { ok: true }>> = {}): FetchResult {
    return {
        ok: true,
        html,
        finalUrl: 'https://www.amazon.com/dp/B0CX23V2ZK',
        statusCode: 200,
        receivedAt: RECEIVED_AT,
        attempts: 1,
        proxyTier: 'DATACENTER',
        pageType: 'STANDARD_PRODUCT',
        locationApplied: false,
        resolvedPostalCode: null,
        ...overrides,
    };
}

export const BLOCKED: FetchResult = {
    ok: false,
    reason: 'BLOCKED_AFTER_FALLBACK',
    attempts: 3,
    proxyTier: 'RESIDENTIAL',
    statusCode: 503,
    blocked: true,
    notFound: false,
    receivedAt: RECEIVED_AT,
};

export const NOT_FOUND: FetchResult = {
    ok: false,
    reason: 'DOG_PAGE',
    attempts: 1,
    proxyTier: 'DATACENTER',
    statusCode: 404,
    blocked: false,
    notFound: true,
    receivedAt: RECEIVED_AT,
};

export interface ScriptedOptions {
    /** Per-ASIN or per-keyword overrides, keyed by ASIN or by search keyword. */
    script?: Record<string, FetchResult>;
    /** Default product fixture for any ASIN with no override. */
    productFixture?: string;
    /** Default search fixture. */
    searchFixture?: string;
    /** Default All Offers Display fragment. */
    offerFixture?: string;
    /** Default public seller-profile page. */
    sellerFixture?: string;
    health?: FetchHealth | (() => FetchHealth);
}

export class ScriptedFetcher implements Fetcher {
    readonly requests: FetchRequest[] = [];

    constructor(private readonly options: ScriptedOptions = {}) {}

    async fetch(request: FetchRequest): Promise<FetchResult> {
        this.requests.push(request);
        const script = this.options.script ?? {};

        if (request.label === 'SEARCH') {
            const keyword = new URL(request.url).searchParams.get('k') ?? request.url;
            const scripted = script[keyword] ?? script[request.url];
            if (scripted) return scripted;
            return ok(this.options.searchFixture ?? F.US_SEARCH_PAGE, {
                finalUrl: request.url,
                pageType: 'SEARCH',
                locationApplied: request.postalCode !== null,
                resolvedPostalCode: request.postalCode,
            });
        }

        if (request.label === 'OFFERS') {
            const scripted = script[request.url];
            if (scripted) return scripted;
            return ok(this.options.offerFixture ?? F.US_OFFERS, {
                finalUrl: request.url,
                pageType: 'UNKNOWN',
                locationApplied: request.postalCode !== null,
                resolvedPostalCode: request.postalCode,
            });
        }

        if (request.label === 'SELLER') {
            const sellerId = new URL(request.url).searchParams.get('seller') ?? request.url;
            const scripted = script[sellerId] ?? script[request.url];
            if (scripted) return scripted;
            return ok(this.options.sellerFixture ?? F.US_SELLER_PROFILE, {
                finalUrl: request.url,
                pageType: 'UNKNOWN',
                locationApplied: request.postalCode !== null,
                resolvedPostalCode: request.postalCode,
            });
        }

        const asin = /\/dp\/([A-Z0-9]{10})/.exec(request.url)?.[1] ?? '';
        const scripted = script[asin];
        if (scripted) return scripted;
        // An explicit fixture is served verbatim; the default one is rewritten
        // so each requested ASIN gets a distinct page.
        const html = this.options.productFixture ?? fixtureFor(asin);
        return ok(html, {
            finalUrl: request.url,
            locationApplied: request.postalCode !== null,
            resolvedPostalCode: request.postalCode,
        });
    }

    healthState(): FetchHealth {
        const h = this.options.health;
        if (typeof h === 'function') return h();
        return h ?? 'HEALTHY';
    }

    stats(): ReturnType<Fetcher['stats']> {
        const search = this.requests.filter((r) => r.label === 'SEARCH').length;
        const product = this.requests.length - search;
        return {
            requests: this.requests.length,
            blockedProductPages: 0,
            productPageRequests: product,
            blockedSearchPages: 0,
            searchPageRequests: search,
            residentialEscalations: 0,
            primingRequests: 0,
        };
    }
}
