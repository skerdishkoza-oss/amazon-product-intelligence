/**
 * Shared parser utilities. Spec v1.1 section 9.6.
 *
 * Rule from the spec: prefer embedded structured data and stable JSON payloads
 * over brittle visual selectors. Amazon ships a lot of its state as JS object
 * literals inside <script> tags, and those survive layout A/B tests that break
 * CSS selectors. `extractJsObjectField` is how we read them without eval.
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export type Dom = CheerioAPI;

export function load(html: string): Dom {
    return cheerio.load(html);
}

/** Collapse whitespace, decode nbsp, trim. Returns null for an empty result. */
export function clean(text: string | undefined | null): string | null {
    if (text === undefined || text === null) return null;
    const out = text
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return out === '' ? null : out;
}

/** First non-empty text among a list of selectors, in priority order. */
export function firstText($: Dom, selectors: string[]): { text: string; selector: string } | null {
    for (const selector of selectors) {
        const nodes = $(selector);
        for (let i = 0; i < nodes.length; i += 1) {
            const text = clean(nodes.eq(i).text());
            if (text !== null) return { text, selector };
        }
    }
    return null;
}

/** First non-empty attribute value among a list of selectors. */
export function firstAttr($: Dom, selectors: string[], attr: string): { value: string; selector: string } | null {
    for (const selector of selectors) {
        const nodes = $(selector);
        for (let i = 0; i < nodes.length; i += 1) {
            const value = clean(nodes.eq(i).attr(attr));
            if (value !== null) return { value, selector };
        }
    }
    return null;
}

/**
 * Read a field out of an inline JS object literal, e.g. `"currentAsin":"B0..."`.
 * Deliberately not eval: the page is untrusted input.
 */
export function extractJsString(html: string, key: string): string | null {
    const re = new RegExp(`["']${key}["']\\s*:\\s*["']([^"'\\\\]{1,300})["']`);
    const m = re.exec(html);
    return m?.[1] ?? null;
}

/**
 * Read a balanced JSON object or array that follows `"key":`. Walks brackets so
 * nested structures survive, and bails out rather than returning a truncated
 * fragment.
 */
export function extractJsonBlob(html: string, key: string): unknown | null {
    const keyRe = new RegExp(`["']${key}["']\\s*:\\s*([{[])`);
    const m = keyRe.exec(html);
    if (!m || m.index === undefined || m[1] === undefined) return null;

    const start = m.index + m[0].length - 1;
    const open = m[1];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < html.length && i < start + 500_000; i += 1) {
        const ch = html[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === open) depth += 1;
        else if (ch === close) {
            depth -= 1;
            if (depth === 0) {
                const slice = html.slice(start, i + 1);
                try {
                    return JSON.parse(slice) as unknown;
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/** JSON-LD blocks, when present, are the most stable price source on the page. */
export function extractJsonLd($: Dom): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text();
        if (raw.trim() === '') return;
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                for (const item of parsed) if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
            } else if (parsed && typeof parsed === 'object') {
                out.push(parsed as Record<string, unknown>);
            }
        } catch {
            /* malformed JSON-LD is common; ignore it rather than failing the parse */
        }
    });
    return out;
}

/** Does any of these localized labels appear in the text? Case-insensitive. */
export function matchesLabel(text: string, labels: string[]): string | null {
    const haystack = text.toLowerCase();
    for (const label of labels) {
        if (haystack.includes(label.toLowerCase())) return label;
    }
    return null;
}

/** Table-shaped detail sections: th/td and dt/dd pairs, plus "Label: value" list items. */
export function extractKeyValueTable($: Dom, selectors: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const selector of selectors) {
        $(selector)
            .find('tr')
            .each((_, row) => {
                const key = clean($(row).find('th').first().text());
                const value = clean($(row).find('td').first().text());
                if (key !== null && value !== null && !(key in out)) out[key] = value;
            });
        $(selector)
            .find('li')
            .each((_, li) => {
                const bold = clean($(li).find('.a-text-bold').first().text());
                if (bold === null) return;
                const whole = clean($(li).text());
                if (whole === null) return;
                const key = bold.replace(/[:\uFF1A]\s*$/, '').trim();
                const value = clean(whole.slice(bold.length).replace(/^[:\uFF1A]\s*/, ''));
                if (key !== '' && value !== null && !(key in out)) out[key] = value;
            });
    }
    return out;
}

/** Look up a key in a detail table using localized label candidates. */
export function lookupLabel(table: Record<string, string>, labels: string[]): string | null {
    for (const label of labels) {
        for (const [key, value] of Object.entries(table)) {
            if (key.toLowerCase().includes(label.toLowerCase())) return value;
        }
    }
    return null;
}
