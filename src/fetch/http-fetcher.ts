/**
 * HTTP-first fetcher. Spec v1.1 sections 9.3, 9.4, 9.5, 10.1, 10.2.
 *
 * Why this is not a CheerioCrawler: the accounting invariant in 10.3 requires
 * one place that knows every input's fate. A crawler owning its own queue can
 * drop a request on an internal error, and then the summary lies. So the run
 * loop drives, and this class is a plain request/response service with the
 * session, proxy-tier and health logic inside it.
 *
 * Cost controls that are load-bearing here:
 *   - Compression is mandatory (C11). Residential proxy is billed on wire
 *     bytes, and Amazon HTML compresses roughly 4:1.
 *   - Residential escalation is capped per run as a share of total requests
 *     (8.3), so a bad proxy day cannot turn a run into a loss.
 *   - Location priming happens once per session, not per product (C12).
 */

import { ProxyConfiguration } from 'apify';
import { SessionPool, type Session } from 'crawlee';
import { gotScraping, type Response } from 'got-scraping';
import { getMarketplace } from '../amazon/marketplace-config/index.js';
import { classifyPage } from '../amazon/parsers/page-type.js';
import type { ProxyTier } from '../types/output.js';
import { FAILURE_REASON, type FailureReason } from '../types/status.js';
import { applyLocation, verifyLocation } from './location-primer.js';
import type { FetchRequest, FetchResult, Fetcher } from './types.js';

export interface HttpFetcherOptions {
    maxRetries: number;
    allowResidentialFallback: boolean;
    /** Share of total requests allowed to use the residential tier (8.3). */
    residentialBudgetRatio: number;
    /** External proxy URLs supplied by the user keep traffic off the platform bill. */
    proxyConfiguration: ProxyConfiguration | null;
    /** Separate Apify RESIDENTIAL configuration used only after a block. */
    residentialProxyConfiguration: ProxyConfiguration | null;
    primaryProxyTier: Extract<ProxyTier, 'DATACENTER' | 'RESIDENTIAL' | 'EXTERNAL' | 'NONE'>;
    externalProxyUrls: string[];
    requestTimeoutSecs: number;
    log: (msg: string, data?: Record<string, unknown>) => void;
    sleep?: (ms: number) => Promise<void>;
}

export const FETCHER_DEFAULTS = {
    residentialBudgetRatio: 0.25,
    /** Optional detail surfaces commonly need one fallback for each blocked DC request. */
    reliableResidentialBudgetRatio: 0.5,
    requestTimeoutSecs: 45,
    /** 9.5: halve concurrency above this trailing block rate. */
    blockRateWarn: 0.35,
    /** 9.5: above this, stop scheduling new work and wind the run down. */
    blockRateAbort: 0.6,
    trailingWindow: 50,
} as const;

interface SessionState {
    locationKey: string | null;
    primed: boolean;
    primeAttempts: number;
}

const sessionState = new WeakMap<Session, SessionState>();

export class HttpFetcher implements Fetcher {
    private pool: SessionPool | null = null;
    private requests = 0;
    private productRequests = 0;
    private searchRequests = 0;
    private blockedProduct = 0;
    private blockedSearch = 0;
    private residentialUsed = 0;
    private priming = 0;
    private readonly trailing: boolean[] = [];

    constructor(private readonly options: HttpFetcherOptions) {}

    async init(): Promise<void> {
        this.pool = await SessionPool.open({
            maxPoolSize: 100,
            sessionOptions: {
                // Sticky long enough to benefit from cookies and location
                // state, short enough that a degraded IP does not poison a run.
                maxUsageCount: 30,
                maxErrorScore: 3,
            },
            persistStateKeyValueStoreId: undefined,
        });
    }

    async teardown(): Promise<void> {
        await this.pool?.teardown();
    }

    /** 9.5: trailing block rate over the last N requests. */
    blockRate(): number {
        if (this.trailing.length === 0) return 0;
        const blocked = this.trailing.filter(Boolean).length;
        return blocked / this.trailing.length;
    }

    /** The run loop polls this to trip the circuit breaker. */
    healthState(): 'HEALTHY' | 'DEGRADED' | 'ABORT' {
        if (this.trailing.length < 10) return 'HEALTHY';
        const rate = this.blockRate();
        if (rate >= FETCHER_DEFAULTS.blockRateAbort) return 'ABORT';
        if (rate >= FETCHER_DEFAULTS.blockRateWarn) return 'DEGRADED';
        return 'HEALTHY';
    }

    private recordOutcome(blocked: boolean, label: FetchRequest['label']): void {
        this.trailing.push(blocked);
        if (this.trailing.length > FETCHER_DEFAULTS.trailingWindow) this.trailing.shift();
        if (label === 'SEARCH') {
            this.searchRequests += 1;
            if (blocked) this.blockedSearch += 1;
        } else {
            this.productRequests += 1;
            if (blocked) this.blockedProduct += 1;
        }
    }

    private residentialAllowed(): boolean {
        if (!this.options.allowResidentialFallback) return false;
        if (this.options.residentialProxyConfiguration === null) return false;
        const budget = Math.max(1, Math.ceil(this.requests * this.options.residentialBudgetRatio));
        return this.residentialUsed < budget;
    }

    private async proxyUrlFor(tier: ProxyTier, session: Session | undefined): Promise<string | undefined> {
        if (this.options.externalProxyUrls.length > 0) {
            const token = session?.id ?? String(this.requests);
            const idx = stableIndex(token, this.options.externalProxyUrls.length);
            return this.options.externalProxyUrls[idx];
        }
        const config = tier === 'RESIDENTIAL'
            ? (this.options.residentialProxyConfiguration ?? this.options.proxyConfiguration)
            : this.options.proxyConfiguration;
        if (config === null) return undefined;
        const sessionId = session?.id ?? `t-${tier}-${this.requests}`;
        return config.newUrl(sessionId);
    }

    private async backoff(attempt: number): Promise<void> {
        const delay = Math.min(5_000, 250 * (2 ** Math.max(0, attempt - 1)));
        const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        await sleep(delay);
    }

    private headersFor(request: FetchRequest): Record<string, string> {
        const cfg = getMarketplace(request.marketplace);
        const headers: Record<string, string> = {
            // C11: mandatory compression. got-scraping decompresses for us.
            'accept-encoding': 'gzip, deflate, br',
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': `${cfg.locale},${cfg.locale.split('-')[0]};q=0.9`,
            'upgrade-insecure-requests': '1',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
        };
        if (request.label === 'OFFERS') headers['x-requested-with'] = 'XMLHttpRequest';
        return headers;
    }

    async fetch(request: FetchRequest): Promise<FetchResult> {
        const cfg = getMarketplace(request.marketplace);
        let tier: ProxyTier = this.options.primaryProxyTier;
        let lastProxyTier: ProxyTier = tier;
        let attempts = 0;
        let lastReason: FailureReason = FAILURE_REASON.TIMEOUT;
        let lastStatus: number | null = null;
        let lastBlocked = false;
        let lastMessage: string | undefined;

        const maxAttempts = Math.max(1, this.options.maxRetries + 1);

        while (attempts < maxAttempts) {
            attempts += 1;
            this.requests += 1;
            lastProxyTier = tier;

            const session = await this.pool?.getSession();
            const proxyUrl = await this.proxyUrlFor(tier, session);
            if (tier === 'RESIDENTIAL') this.residentialUsed += 1;

            // C12: prime the delivery location once per session and reuse it.
            let locationApplied = false;
            let resolvedPostalCode: string | null = null;
            if (request.postalCode !== null && session !== undefined) {
                const requestedLocationKey = `${cfg.host}|${request.postalCode}`;
                let state = sessionState.get(session) ?? { locationKey: null, primed: false, primeAttempts: 0 };
                if (state.locationKey !== requestedLocationKey) {
                    state = { locationKey: requestedLocationKey, primed: false, primeAttempts: 0 };
                }
                if (!state.primed && state.primeAttempts < 2) {
                    state.primeAttempts += 1;
                    this.priming += 1;
                    const primed = await applyLocation({
                        cfg,
                        postalCode: request.postalCode,
                        country: request.deliveryCountry ?? null,
                        session,
                        proxyUrl,
                        timeoutSecs: this.options.requestTimeoutSecs,
                        headers: this.headersFor(request),
                    });
                    state.primed = primed;
                    sessionState.set(session, state);
                    if (!primed) {
                        this.options.log('location priming failed for session', { session: session.id });
                    }
                }
                locationApplied = sessionState.get(session)?.primed === true;
                resolvedPostalCode = locationApplied ? request.postalCode : null;
            }

            let response: Response<string>;
            try {
                response = await gotScraping({
                    url: request.url,
                    method: 'GET',
                    proxyUrl,
                    headers: this.headersFor(request),
                    headerGeneratorOptions: {
                        browsers: [{ name: 'chrome', minVersion: 120 }],
                        devices: ['desktop'],
                        operatingSystems: ['windows', 'macos'],
                        locales: [cfg.locale],
                    },
                    sessionToken: session,
                    cookieJar: session?.cookieJar as never,
                    timeout: { request: this.options.requestTimeoutSecs * 1000 },
                    followRedirect: true,
                    maxRedirects: 5,
                    throwHttpErrors: false,
                    retry: { limit: 0 },
                    responseType: 'text',
                    decompress: true,
                });
            } catch (err) {
                const message = (err as Error).message;
                lastReason = /timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(message)
                    ? FAILURE_REASON.TIMEOUT
                    : /redirect/i.test(message)
                        ? FAILURE_REASON.REDIRECT_LOOP
                        : FAILURE_REASON.HTTP_STATUS;
                lastMessage = message.slice(0, 200);
                session?.retire();
                if (attempts < maxAttempts) await this.backoff(attempts);
                continue;
            }

            const html = typeof response.body === 'string' ? response.body : String(response.body ?? '');
            lastStatus = response.statusCode;

            const classification = classifyPage({
                html,
                statusCode: response.statusCode,
                cfg,
                expected: request.label === 'SEARCH'
                    ? 'SEARCH'
                    : request.label === 'OFFERS' || request.label === 'SELLER'
                        ? 'AUXILIARY'
                        : 'PRODUCT',
            });

            // A not-found page is a real answer about the product. Never retry
            // it, never escalate, never count it as a block (10.2).
            if (classification.notFound) {
                session?.markGood();
                this.recordOutcome(false, request.label);
                return {
                    ok: false,
                    reason: classification.reason ?? FAILURE_REASON.DOG_PAGE,
                    attempts,
                    proxyTier: tier,
                    statusCode: response.statusCode,
                    blocked: false,
                    notFound: true,
                    receivedAt: nowIso(),
                };
            }

            // A non-2xx that is not a block and not a not-found (e.g. 400 from
            // an intermediary) must not be handed to the parsers as content.
            if (!classification.blocked && response.statusCode >= 400) {
                session?.markBad();
                this.recordOutcome(false, request.label);
                if (response.statusCode >= 500 && attempts < maxAttempts) {
                    lastReason = FAILURE_REASON.HTTP_STATUS;
                    lastMessage = `HTTP ${response.statusCode}`;
                    await this.backoff(attempts);
                    continue;
                }
                return {
                    ok: false,
                    reason: FAILURE_REASON.HTTP_STATUS,
                    attempts,
                    proxyTier: tier,
                    statusCode: response.statusCode,
                    blocked: false,
                    notFound: false,
                    receivedAt: nowIso(),
                    message: `HTTP ${response.statusCode}`,
                };
            }

            if (classification.blocked) {
                session?.retire();
                lastBlocked = true;
                this.recordOutcome(true, request.label);

                if (tier === 'DATACENTER') {
                    if (!this.options.allowResidentialFallback) {
                        lastReason = FAILURE_REASON.RESIDENTIAL_FALLBACK_DISABLED;
                    } else if (this.options.residentialProxyConfiguration === null) {
                        lastReason = FAILURE_REASON.BLOCKED_AFTER_FALLBACK;
                    } else if (!this.residentialAllowed()) {
                        lastReason = FAILURE_REASON.ESCALATION_BUDGET_EXHAUSTED;
                    } else {
                        tier = 'RESIDENTIAL';
                        lastReason = classification.reason ?? FAILURE_REASON.CHALLENGE_PAGE;
                    }
                } else {
                    lastReason = FAILURE_REASON.BLOCKED_AFTER_FALLBACK;
                }

                if (attempts < maxAttempts) await this.backoff(attempts);
                continue;
            }

            session?.markGood();
            this.recordOutcome(false, request.label);

            // Verify the applied location from the page itself rather than
            // trusting the priming call (C12).
            if (request.postalCode !== null && (request.label === 'PRODUCT' || request.label === 'SEARCH' || request.label === 'VARIANT')) {
                const verified = verifyLocation(html, request.postalCode);
                locationApplied = verified === true;
                resolvedPostalCode = locationApplied ? request.postalCode : null;
                if (!locationApplied && session !== undefined) {
                    const state = sessionState.get(session);
                    if (state !== undefined) {
                        state.primed = false;
                        sessionState.set(session, state);
                    }
                }
            }

            return {
                ok: true,
                html,
                finalUrl: response.url ?? request.url,
                statusCode: response.statusCode,
                receivedAt: nowIso(),
                attempts,
                proxyTier: tier,
                pageType: classification.pageType,
                locationApplied,
                resolvedPostalCode,
            };
        }

        return {
            ok: false,
            reason: lastReason,
            attempts,
            proxyTier: lastProxyTier,
            statusCode: lastStatus,
            blocked: lastBlocked,
            notFound: false,
            receivedAt: nowIso(),
            ...(lastMessage === undefined ? {} : { message: lastMessage }),
        };
    }

    stats(): ReturnType<Fetcher['stats']> {
        return {
            requests: this.requests,
            blockedProductPages: this.blockedProduct,
            productPageRequests: this.productRequests,
            blockedSearchPages: this.blockedSearch,
            searchPageRequests: this.searchRequests,
            residentialEscalations: this.residentialUsed,
            primingRequests: this.priming,
        };
    }
}

function stableIndex(value: string, length: number): number {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = ((hash * 31) + value.charCodeAt(i)) >>> 0;
    return hash % length;
}

function nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
