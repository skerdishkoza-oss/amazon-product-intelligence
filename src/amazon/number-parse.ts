/**
 * Spec v1.1 section 9.2 (C5).
 *
 * Locale-aware price parsing. The design rule is: when the string does not
 * match the marketplace's expected format in a way that could change the value
 * by a factor of 100, refuse to parse and let the caller record PARSER_MISS.
 * A wrong price is far worse than a missing one -- a missing price is visible
 * in the status field, a wrong one is not.
 */

import { money, type MoneyInternal } from '../types/money.js';
import type { MarketplaceConfig } from './marketplace-config/types.js';

/** Non-breaking space, narrow no-break space, thin space, and friends. */
const SPACE_CLASS = /[\s\u00a0\u2007\u2009\u202f\u2060]/g;

export interface ParsedNumber {
    value: number;
    /** Digits after the decimal separator, used to detect minor-unit precision. */
    decimals: number;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip currency symbols, spaces and direction marks. Keeps digits and separators. */
export function stripCurrency(input: string, cfg: MarketplaceConfig): string {
    let s = input.replace(/[\u200e\u200f\u202a-\u202e]/g, '');
    // Remove longer aliases first: CA$ must not become a stray "CA" after
    // stripping the shorter "$" alias.
    for (const sym of [...cfg.numberFormat.currencySymbols].sort((a, b) => b.length - a.length)) {
        s = s.split(sym).join('');
    }
    return s.replace(SPACE_CLASS, '').trim();
}

/**
 * Parse a localized number. Returns null on anything ambiguous or malformed.
 *
 * Accepted for a `.`-decimal locale: 1234, 1234.56, 1,234.56, 1,234,567.89
 * Accepted for a `,`-decimal locale: 1234, 1234,56, 1.234,56, 1.234.567,89
 * Refused everywhere: mixed or repeated decimal separators, a thousands group
 * that is not exactly three digits, and a string whose separators indicate the
 * opposite locale (e.g. "1.234,56" on a US page).
 */
export function parseLocalizedNumber(input: string, cfg: MarketplaceConfig): ParsedNumber | null {
    const { decimalSeparator: dec, thousandsSeparator: tho } = cfg.numberFormat;
    const cleaned = stripCurrency(input, cfg);
    if (cleaned === '') return null;

    const negative = /^[-\u2212]/.test(cleaned);
    const body = cleaned.replace(/^[-\u2212+]/, '');
    if (!new RegExp(`^[0-9${escapeRe(dec)}${escapeRe(tho)}]+$`).test(body)) return null;

    const decCount = body.split(dec).length - 1;
    if (decCount > 1) return null;

    const [intPartRaw, fracPart = ''] = body.split(dec) as [string, string?];
    const intPart = intPartRaw ?? '';

    // The fractional side must never contain a thousands separator.
    if (fracPart.includes(tho)) return null;
    if (fracPart !== '' && !/^[0-9]+$/.test(fracPart)) return null;

    // Reject the opposite-locale shape: a "thousands" group of any length other
    // than 3 means we are looking at a decimal separator we do not recognize.
    if (intPart.includes(tho)) {
        const groups = intPart.split(tho);
        const head = groups[0] ?? '';
        if (head === '' || head.length > 3) return null;
        for (const g of groups.slice(1)) {
            if (!/^[0-9]{3}$/.test(g)) return null;
        }
    }

    const digitsInt = intPart.split(tho).join('');
    if (digitsInt === '' || !/^[0-9]+$/.test(digitsInt)) return null;

    // A 3-digit tail with no thousands separator anywhere is ambiguous in a
    // locale whose decimal separator is the other character (e.g. "1,234" on a
    // DE page could be 1.234 or 1234). Refuse it.
    if (fracPart.length === 3 && !intPart.includes(tho)) return null;

    const value = Number(`${digitsInt}.${fracPart === '' ? '0' : fracPart}`);
    if (!Number.isFinite(value)) return null;

    return { value: negative ? -value : value, decimals: fracPart.length };
}

/** Parse a price string into integer minor units. Returns null rather than guessing. */
export function parseMoney(input: string, cfg: MarketplaceConfig): MoneyInternal | null {
    const parsed = parseLocalizedNumber(input, cfg);
    if (parsed === null) return null;
    const scale = cfg.currencyScale;
    const minor = Math.round(parsed.value * scale);
    if (!Number.isSafeInteger(minor)) return null;
    return money(minor, cfg.currency, input.trim(), scale);
}

/**
 * Amazon frequently renders a price twice in one node (a visible span plus an
 * a-offscreen accessibility copy), producing strings like "$24.99$24.99" or
 * "24,99 €24,99 €". Extract the first complete price occurrence.
 */
export function extractFirstMoney(input: string, cfg: MarketplaceConfig): MoneyInternal | null {
    const { decimalSeparator: dec, thousandsSeparator: tho } = cfg.numberFormat;
    const pattern = new RegExp(`[0-9]+(?:${escapeRe(tho)}[0-9]{3})*(?:${escapeRe(dec)}[0-9]{1,2})?`, 'g');
    const normalized = stripCurrency(input, cfg);
    const matches = normalized.match(pattern);
    if (!matches || matches.length === 0) return null;
    for (const m of matches) {
        const parsed = parseMoney(m, cfg);
        if (parsed !== null) return money(parsed.minor, parsed.currency, input.trim(), parsed.scale);
    }
    return null;
}

/**
 * Integer counts such as review counts: "1,820 ratings" -> 1820,
 * "1.820" (DE) -> 1820, and compact search-card counts such as "45K" ->
 * 45000. Compact suffixes reuse the marketplace vocabulary so localized
 * forms such as "1,2 Tsd." are scaled without treating the decimal as a
 * thousands separator.
 */
export function parseCount(input: string, cfg: MarketplaceConfig): number | null {
    const magnitude = /([0-9][0-9.,\u00a0\u202f ]*)\s*([A-Za-z]{1,4})(?:\.|\b)/u.exec(input);
    if (magnitude?.[1] !== undefined && magnitude[2] !== undefined) {
        const multiplier = cfg.labels.demandMultipliers.find(
            (entry) => entry.suffix.toLowerCase() === magnitude[2]?.toLowerCase(),
        );
        if (multiplier !== undefined) {
            const compact = parseLocalizedNumber(magnitude[1].trim(), cfg);
            if (compact === null) return null;
            const scaled = compact.value * multiplier.factor;
            return Number.isSafeInteger(scaled) && scaled >= 0 ? scaled : null;
        }
    }

    const digitsOnly = input.replace(/[^0-9]/g, '');
    if (digitsOnly === '') return null;
    const parsed = parseLocalizedNumber(input.replace(/[^0-9.,\u00a0 ]/g, ''), cfg);
    if (parsed !== null && Number.isInteger(parsed.value)) return parsed.value;
    const n = Number(digitsOnly);
    return Number.isSafeInteger(n) ? n : null;
}

/** Ratings: "4.6 out of 5 stars" -> 4.6; DE "4,6 von 5 Sternen" -> 4.6. */
export function parseRating(input: string, cfg: MarketplaceConfig): number | null {
    const dec = cfg.numberFormat.decimalSeparator;
    const m = new RegExp(`([0-9](?:${escapeRe(dec)}[0-9])?)`).exec(input);
    if (!m || m[1] === undefined) return null;
    const value = Number(m[1].replace(dec, '.'));
    return Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
}

/**
 * "2K+ bought in past month" -> 2000 (a documented lower bound, never an
 * estimate presented as fact). Spec 6.8.
 */
export function parseBoughtInPastMonth(input: string, cfg: MarketplaceConfig): number | null {
    const m = /([0-9][0-9.,\u00a0\u202f ]*)\s*([A-Za-z]{1,4})?\.?\s*\+?/.exec(input);
    if (!m || m[1] === undefined) return null;
    const base = parseCount(m[1], cfg);
    if (base === null) return null;
    const suffix = (m[2] ?? '').toLowerCase();
    if (suffix === '') return base;
    for (const entry of cfg.numberFormat ? cfg.labels.demandMultipliers : []) {
        if (entry.suffix.toLowerCase() === suffix) return base * entry.factor;
    }
    // An unrecognized suffix means an unknown magnitude word; report the plain
    // number rather than inventing a multiplier.
    return base;
}
