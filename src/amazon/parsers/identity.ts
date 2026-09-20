/** Product identity. Spec v1.1 section 6.1. */

import { clean, extractJsString, firstAttr, firstText, load, type Dom } from './dom.js';

export interface IdentityResult {
    asin: string | null;
    parentAsin: string | null;
    title: string | null;
    brand: string | null;
}

const TITLE_SELECTORS = ['#productTitle', '#title span', 'h1#title', 'h1 .a-size-large'];

const BRAND_SELECTORS = ['#bylineInfo', '#brand', '.po-brand .po-break-word', 'a#bylineInfo'];

/** "Visit the Acme Store" / "Brand: Acme" / "Marke: Acme" all mean Acme. */
const BRAND_PREFIXES = [
    /^visit the\s+/i,
    /^brand:\s*/i,
    /^marke:\s*/i,
    /^besuche den\s+/i,
    /^shop\s+/i,
];

const BRAND_SUFFIXES = [/\s+store$/i, /\s+shop$/i, /-store$/i];

export function parseIdentity(html: string, dom?: Dom): IdentityResult {
    const $ = dom ?? load(html);

    const titleHit = firstText($, TITLE_SELECTORS);

    const asinFromInput = firstAttr($, ['input#ASIN', 'input[name="ASIN"]', 'input[name="asin"]'], 'value');
    const asinFromData = firstAttr($, ['#averageCustomerReviews[data-asin]', '[data-asin][data-component-type="s-search-result"]'], 'data-asin');
    const asin =
        normalize(asinFromInput?.value) ??
        normalize(extractJsString(html, 'currentAsin')) ??
        normalize(asinFromData?.value) ??
        normalize(/\/dp\/([A-Z0-9]{10})/.exec(html)?.[1]);

    const parentRaw = normalize(extractJsString(html, 'parentAsin')) ?? normalize(firstAttr($, ['input#parentAsin', 'input[name="parentAsin"]'], 'value')?.value);
    const parentAsin = parentRaw !== null && parentRaw !== asin ? parentRaw : null;

    let brand = firstHit($, BRAND_SELECTORS);
    if (brand !== null) {
        for (const re of BRAND_PREFIXES) brand = brand.replace(re, '');
        for (const re of BRAND_SUFFIXES) brand = brand.replace(re, '');
        brand = clean(brand);
    }

    return { asin, parentAsin, title: titleHit?.text ?? null, brand };
}

function firstHit($: Dom, selectors: string[]): string | null {
    const hit = firstText($, selectors);
    return hit?.text ?? null;
}

function normalize(value: string | undefined | null): string | null {
    if (value === undefined || value === null) return null;
    const s = value.trim().toUpperCase();
    return /^[A-Z0-9]{10}$/.test(s) ? s : null;
}
