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

/**
 * Amazon's address-change endpoint needs an anti-CSRF token that is embedded in
 * the location modal. Fetch the modal, read the token, then post the postal
 * code. Two requests per session, amortized over every product on it.
 */
export async function applyLocation(args: ApplyLocationArgs): Promise<boolean> {
    const { cfg, postalCode, session, proxyUrl, timeoutSecs, headers } = args;
    const base = `https://${cfg.host}`;

    try {
        const modal = await gotScraping({
            url: `${base}/portal-migration/hz/glow/get-rendered-address-selections?deviceType=desktop&pageType=Detail&storeContext=generic&actionSource=desktop-modal`,
            proxyUrl,
            headers: { ...headers, accept: 'text/html,*/*' },
            sessionToken: session,
            cookieJar: session?.cookieJar as never,
            timeout: { request: timeoutSecs * 1000 },
            throwHttpErrors: false,
            retry: { limit: 0 },
            responseType: 'text',
        });

        const token = extractCsrfToken(typeof modal.body === 'string' ? modal.body : '');
        if (token === null) return false;

        const response = await gotScraping({
            url: `${base}${cfg.location.applyPath}`,
            method: 'POST',
            proxyUrl,
            headers: {
                ...headers,
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'anti-csrftoken-a2z': token,
                accept: 'text/html,application/json,*/*',
                'x-requested-with': 'XMLHttpRequest',
            },
            body: new URLSearchParams({
                locationType: 'LOCATION_INPUT',
                zipCode: postalCode,
                storeContext: 'generic',
                deviceType: 'web',
                pageType: 'Detail',
                actionSource: 'glow',
            }).toString(),
            sessionToken: session,
            cookieJar: session?.cookieJar as never,
            timeout: { request: timeoutSecs * 1000 },
            throwHttpErrors: false,
            retry: { limit: 0 },
            responseType: 'text',
        });

        return response.statusCode >= 200 && response.statusCode < 400;
    } catch {
        return false;
    }
}

export function extractCsrfToken(html: string): string | null {
    const patterns = [
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
 * the page has no indicator at all, which is different from "the indicator says
 * somewhere else" -- the caller keeps its previous belief in that case.
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
