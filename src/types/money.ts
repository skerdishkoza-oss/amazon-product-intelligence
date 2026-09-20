/**
 * Spec v1.1 section 5.1 (C17).
 *
 * Rule: all internal arithmetic happens in integer minor units. Floats appear
 * only at the moment of output. Never subtract two floats to produce a price
 * delta -- 29.99 - 24.99 is 5.000000000000004 in IEEE 754, and that value ends
 * up in a customer's monitoring alert.
 */

/** What consumers see. */
export interface Money {
    /** Rounded to the currency's minor-unit precision. */
    amount: number;
    /** ISO 4217. */
    currency: string;
    /** Untouched display string from the page. */
    raw: string;
}

/** What the Actor computes with. Never emitted. */
export interface MoneyInternal {
    /** Integer minor units, e.g. 2499 for $24.99. */
    minor: number;
    currency: string;
    raw: string;
    /** Minor units per major unit, e.g. 100. */
    scale: number;
}

export function money(minor: number, currency: string, raw: string, scale = 100): MoneyInternal {
    if (!Number.isInteger(minor)) throw new TypeError(`minor units must be an integer, got ${minor}`);
    return { minor, currency, raw, scale };
}

/** Build from a major-unit float. Only for test fixtures and dataset ingest. */
export function moneyFromMajor(major: number, currency: string, raw?: string, scale = 100): MoneyInternal {
    return money(Math.round(major * scale), currency, raw ?? String(major), scale);
}

export function toMoney(m: MoneyInternal): Money {
    return { amount: m.minor / m.scale, currency: m.currency, raw: m.raw };
}

export function toMoneyOrNull(m: MoneyInternal | null | undefined): Money | null {
    return m ? toMoney(m) : null;
}

export class CurrencyMismatchError extends Error {
    constructor(a: string, b: string) {
        super(`refusing to compare money in different currencies: ${a} vs ${b}`);
        this.name = 'CurrencyMismatchError';
    }
}

function assertComparable(a: MoneyInternal, b: MoneyInternal): void {
    if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
    if (a.scale !== b.scale) throw new Error(`scale mismatch for ${a.currency}: ${a.scale} vs ${b.scale}`);
}

/** Integer difference in minor units: b - a. */
export function diffMinor(a: MoneyInternal, b: MoneyInternal): number {
    assertComparable(a, b);
    return b.minor - a.minor;
}

/**
 * Percent change from a to b, rounded once at the end to `dp` decimal places.
 * Returns null when the base is zero rather than Infinity.
 */
export function percentChange(a: MoneyInternal, b: MoneyInternal, dp = 2): number | null {
    assertComparable(a, b);
    if (a.minor === 0) return null;
    const raw = ((b.minor - a.minor) / a.minor) * 100;
    return roundTo(raw, dp);
}

/** Discount percent off a list price, e.g. list 2999 / current 2499 -> 16.67. */
export function discountPercent(list: MoneyInternal, current: MoneyInternal, dp = 2): number | null {
    assertComparable(list, current);
    if (list.minor <= 0) return null;
    return roundTo(((list.minor - current.minor) / list.minor) * 100, dp);
}

export function discountAmount(list: MoneyInternal, current: MoneyInternal): MoneyInternal {
    assertComparable(list, current);
    return money(list.minor - current.minor, list.currency, '', list.scale);
}

export function equalMoney(a: MoneyInternal | null, b: MoneyInternal | null): boolean {
    if (a === null || b === null) return a === b;
    return a.currency === b.currency && a.minor === b.minor && a.scale === b.scale;
}

export function roundTo(value: number, dp: number): number {
    const f = 10 ** dp;
    // Nudge away from binary-representation boundaries before truncating.
    return Math.round((value + Number.EPSILON * Math.sign(value) * Math.abs(value)) * f) / f;
}
