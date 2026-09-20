/**
 * Spec v1.1 section 9.3. The fetch seam.
 *
 * Everything above this interface is testable offline. The HTTP implementation
 * (session pool, compression, blocker detection, location priming, circuit
 * breaker, escalation budget) is step 4 of the build order.
 */

import type { MarketplaceCode, PageType, ProxyTier } from '../types/output.js';
import type { FailureReason } from '../types/status.js';

export interface FetchRequest {
    url: string;
    marketplace: MarketplaceCode;
    /** Postal code to apply to the session before this fetch, if any. */
    postalCode: string | null;
    /** Delivery country, used by the location primer alongside the postal code. */
    deliveryCountry?: string | null;
    label: 'PRODUCT' | 'SEARCH' | 'OFFERS' | 'SELLER' | 'VARIANT';
}

export interface FetchSuccess {
    ok: true;
    html: string;
    finalUrl: string;
    statusCode: number;
    /** C1: recorded at response receipt, not at write time. */
    receivedAt: string;
    attempts: number;
    proxyTier: ProxyTier;
    pageType: PageType;
    /** Whether the delivery location was applied and verified on this session. */
    locationApplied: boolean;
    resolvedPostalCode: string | null;
}

export interface FetchFailure {
    ok: false;
    reason: FailureReason;
    attempts: number;
    proxyTier: ProxyTier;
    statusCode: number | null;
    blocked: boolean;
    /** True for a not-found page, which is a real answer rather than a failure. */
    notFound: boolean;
    receivedAt: string;
    message?: string;
}

export type FetchResult = FetchSuccess | FetchFailure;

export type FetchHealth = 'HEALTHY' | 'DEGRADED' | 'ABORT';

export interface Fetcher {
    fetch(request: FetchRequest): Promise<FetchResult>;
    /**
     * Trailing health, read by the run loop's circuit breaker (spec 9.5).
     * Optional so test doubles and the offline fetcher stay trivial.
     */
    healthState?(): FetchHealth;
    /** Rolling health, consumed by the circuit breaker and the run summary. */
    stats(): {
        requests: number;
        blockedProductPages: number;
        productPageRequests: number;
        blockedSearchPages: number;
        searchPageRequests: number;
        residentialEscalations: number;
        primingRequests: number;
    };
}
