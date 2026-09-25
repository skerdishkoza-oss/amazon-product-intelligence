/**
 * Delivery-location priming. Spec v1.1 section 9.4 (C12).
 *
 * Applying a postal code needs an exchange with Amazon before the product
 * fetch, and the resulting state lives in the session's cookies. The rules that
 * matter for cost and honesty:
 *
 *   - Prime once per session, then reuse it for every product on that session.
 *     Priming per product would double the request count for US price accuracy.
 *   - Bounded attempts: two failures mark the session unlocated rather than
 *     retrying forever.
 *   - Verify from the page's own delivery indicator instead of assuming the
 *     call worked, and report the outcome in location.applied.
 */

import type { Session } from 'crawlee';
import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';
import type { MarketplaceConfig } from '../amazon/marketplace-config/types.js';

export interface ApplyLocationArgs {
    cfg: MarketplaceConfig;
    postalCode: string;
    country: string | null;
    session: Session | undefined;
    proxyUrl: string | undefined;
    timeoutSecs: number;
    headers: Record<string, string>;
}

export function buildLocationPayload(postalCode: string, country: string | null): Record<string, string> {
    const payload: Record<string, string> = {
        locationType: 'LOCATION_INPUT',
        zipCode: postalCode,
        storeContext: 'generic',
        deviceType: 'web',
        pageType: 'Detail',
        actionSource: 'glow',
    };
    if (country !== null && country.trim() !== '') payload.countryCode = country.trim().toUpperCase();
    return payload;
}

/**
 * Amazon currently serves two delivery-location flows. The newer navigation
 * widget posts to /gp/delivery/ajax/address-change.html, while some sessions
 * still receive the portal-migration flow protected by an anti-CSRF token.
 * Prime the session cookies once, prefer the token flow when it is available,
 * and fall back to the navigation endpoint. The product page remains the
 * source of truth: HttpFetcher verifies its rendered location indicator before
 * it reports location.applied=true.
 */
export async function applyLocation(args: ApplyLocationArgs): Promise<boolean> {
    const { cfg, postalCode, country, session, proxyUrl, timeoutSecs, headers } = args;
    const base = `https://${cfg.host}`;

    try {
        const modal = await gotScraping({
            url: `${base}/portal-migration/hz/glow/get-rendered-toaster?pageType=Detail&aisTransitionState=in&rancorLocationSource=REALM_DEFAULT`,
            proxyUrl,
            headers: {
                ...headers,
                accept: 'text/html,*/*',
                referer: `${base}/`,
            },
            sessionToken: session,
            cookieJar: session?.cookieJar as never,
            timeout: { request: timeoutSecs * 1000 },
            throwHttpErrors: false,
            retry: { limit: 0 },
            responseType: 'text',
        });

        const locationPayload = buildLocationPayload(postalCode, country);
        let token = extractCsrfToken(typeof modal.body === 'string' ? modal.body : '');

        // A few locales still expose the token only in the full address modal.
        if (token === null) {
            const selections = await gotScraping({
                url: `${base}/portal-migration/hz/glow/get-rendered-address-selections?deviceType=desktop&pageType=Detail&storeContext=generic&actionSource=desktop-modal`,
                proxyUrl,
                headers: {
                    ...headers,
                    accept: 'text/html,*/*',
                    referer: `${base}/`,
                },
                sessionToken: session,
                cookieJar: session?.cookieJar as never,
                timeout: { request: timeoutSecs * 1000 },
                throwHttpErrors: false,
                retry: { limit: 0 },
                responseType: 'text',
            });
            token = extractCsrfToken(typeof selections.body === 'string' ? selections.body : '');
        }

        if (token !== null) {
            const portalResponse = await gotScraping({
                url: `${base}${cfg.location.applyPath}?actionSource=glow`,
                method: 'POST',
                proxyUrl,
                headers: {
                    ...headers,
                    'content-type': 'application/json',
                    'anti-csrftoken-a2z': token,
                    accept: 'application/json,text/html,*/*',
                    'x-requested-with': 'XMLHttpRequest',
                    origin: base,
                    referer: `${base}/`,
                },
                body: JSON.stringify(locationPayload),
                sessionToken: session,
                cookieJar: session?.cookieJar as never,
                timeout: { request: timeoutSecs * 1000 },
                throwHttpErrors: false,
                retry: { limit: 0 },
                responseType: 'text',
            });
            if (isLocationUpdateAccepted(portalResponse.statusCode, String(portalResponse.body ?? ''))) return true;
        }

        const navigationResponse = await gotScraping({
            url: `${base}/gp/delivery/ajax/address-change.html`,
            method: 'POST',
            proxyUrl,
            headers: {
                ...headers,
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                ...(token === null ? {} : { 'anti-csrftoken-a2z': token }),
                accept: 'application/json,text/html,*/*',
                'x-requested-with': 'XMLHttpRequest',
                origin: base,
                referer: `${base}/`,
            },
            body: new URLSearchParams({ ...locationPayload, actionSource: 'glow-toaster' }).toString(),
            sessionToken: session,
            cookieJar: session?.cookieJar as never,
            timeout: { request: timeoutSecs * 1000 },
            throwHttpErrors: false,
            retry: { limit: 0 },
            responseType: 'text',
        });

        return isLocationUpdateAccepted(navigationResponse.statusCode, String(navigationResponse.body ?? ''));
    } catch {
        return false;
    }
}

export function isLocationUpdateAccepted(statusCode: number, body: string): boolean {
    if (statusCode < 200 || statusCode >= 400) return false;
    const trimmed = body.trim();
    if (trimmed === '') return true;
    try {
        const value = JSON.parse(trimmed) as Record<string, unknown>;
        for (const key of ['sembuUpdated', 'success', 'isValidAddress']) {
            if (value[key] === false || value[key] === 0) return false;
            if (value[key] === true || value[key] === 1) return true;
        }
    } catch {
        // Some marketplaces return an HTML fragment after accepting the ZIP.
    }
    return true;
}

export function extractCsrfToken(html: string): string | null {
    const patterns = [
        /csrfToken\s*=\s*["']([^"']+)["']/i,
        /CSRF_TOKEN\s*:\s*["']([^"']+)["']/,
        /name=["']anti-csrftoken-a2z["'][^>]*value=["']([^"']+)["']/,
        /"anti-csrftoken-a2z"\s*:\s*"([^"]+)"/,
    ];
    for (const re of patterns) {
        const m = re.exec(html);
        if (m?.[1]) return m[1];
    }
    return null;
}

/**
 * Read the delivery indicator Amazon renders in the nav bar. Returns null when
 * the page has no indicator at all. The caller must treat that as unverified;
 * a successful priming HTTP response is not enough evidence for a buyer price.
 */
export function verifyLocation(html: string, expectedPostalCode: string): boolean | null {
    const $ = cheerio.load(html);
    const texts: string[] = [];
    for (const selector of ['#glow-ingress-line2', '#nav-global-location-slot', '#contextualIngressPtLabel_deliveryShortLine']) {
        const text = $(selector).text().replace(/\s+/g, ' ').trim();
        if (text !== '') texts.push(text);
    }
    if (texts.length === 0) return null;

    const joined = texts.join(' ').toLowerCase();
    const needle = expectedPostalCode.toLowerCase();
    if (joined.includes(needle)) return true;

    // Amazon often shows "New York 10001" or just the city for a known ZIP, so
    // a partial numeric match still counts as applied.
    const digits = needle.replace(/\D/g, '');
    if (digits.length >= 4 && joined.includes(digits.slice(0, 5))) return true;

    // An indicator that offers to set a location means none is applied.
    const unset = ['select your address', 'update location', 'deine adresse', 'lieferadresse wählen', 'choose your location'];
    if (unset.some((u) => joined.includes(u))) return false;

    return false;
}
