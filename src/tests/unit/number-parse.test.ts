/**
 * Spec v1.1 section 9.2 (C5) and 12.1: the seven mandatory parse vectors are
 * MANDATORY. If this file is ever weakened, DE prices silently become 1/100th
 * of their real value and the records still look plausible.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CA, DE, ES, FR, IT, UK, US } from '../../amazon/marketplace-config/index.js';
import {
    extractFirstMoney,
    parseBoughtInPastMonth,
    parseCount,
    parseLocalizedNumber,
    parseMoney,
    parseRating,
} from '../../amazon/number-parse.js';

const NBSP = '\u00a0';

test('the seven mandatory parse vectors (C5)', () => {
    const vectors: Array<[string, typeof US, number, string]> = [
        ['$1,234.56', US, 123456, 'USD'],
        ['£1,234.56', UK, 123456, 'GBP'],
        ['1.234,56 €', DE, 123456, 'EUR'],
        ['24,99 €', DE, 2499, 'EUR'],
        ['$24.99', US, 2499, 'USD'],
        ['€1.234,56', DE, 123456, 'EUR'],
        [`1.234,56${NBSP}€`, DE, 123456, 'EUR'],
    ];
    for (const [raw, cfg, expectedMinor, currency] of vectors) {
        const parsed = parseMoney(raw, cfg);
        assert.ok(parsed !== null, `failed to parse ${JSON.stringify(raw)} for ${cfg.code}`);
        assert.equal(parsed.minor, expectedMinor, `wrong minor units for ${JSON.stringify(raw)}`);
        assert.equal(parsed.currency, currency);
        assert.equal(parsed.raw, raw.trim(), 'raw display string must be preserved verbatim');
    }
});

test('FR, IT, ES and CA money formats preserve minor units and currency', () => {
    const vectors: Array<[string, typeof US, number, string]> = [
        [`1${NBSP}234,56 €`, FR, 123456, 'EUR'],
        ['1.234,56 €', IT, 123456, 'EUR'],
        ['1.234,56 €', ES, 123456, 'EUR'],
        ['CA$1,234.56', CA, 123456, 'CAD'],
    ];
    for (const [raw, cfg, expectedMinor, currency] of vectors) {
        const parsed = parseMoney(raw, cfg);
        assert.ok(parsed !== null, `failed to parse ${raw} for ${cfg.code}`);
        assert.equal(parsed.minor, expectedMinor);
        assert.equal(parsed.currency, currency);
    }
});

test('refuses opposite-locale strings rather than returning a wrong value', () => {
    // The bug this whole rule exists for: 1.234,56 read with US rules is 1.23.
    assert.equal(parseMoney('1.234,56', US), null);
    assert.equal(parseMoney('$1.234,56', US), null);
    // And the mirror image on DE.
    assert.equal(parseMoney('1,234.56', DE), null);
});

test('refuses malformed and ambiguous numbers', () => {
    assert.equal(parseLocalizedNumber('', US), null);
    assert.equal(parseLocalizedNumber('abc', US), null);
    assert.equal(parseLocalizedNumber('12.34.56', US), null, 'repeated decimal separator');
    assert.equal(parseLocalizedNumber('1,23.45', US), null, 'thousands group of 2 digits');
    assert.equal(parseLocalizedNumber('1,2345.67', US), null, 'thousands group of 4 digits');
    assert.equal(parseLocalizedNumber('1,234', DE), null, 'ambiguous 3-digit tail on a comma-decimal locale');
});

test('parses plain integers and multi-group thousands', () => {
    assert.equal(parseLocalizedNumber('1234', US)?.value, 1234);
    assert.equal(parseLocalizedNumber('1,234,567.89', US)?.value, 1234567.89);
    assert.equal(parseLocalizedNumber('1.234.567,89', DE)?.value, 1234567.89);
});

test('extractFirstMoney handles Amazon duplicate-render nodes', () => {
    // a-offscreen accessibility copy concatenated with the visible span.
    assert.equal(extractFirstMoney('$24.99$24.99', US)?.minor, 2499);
    assert.equal(extractFirstMoney(`24,99${NBSP}€24,99${NBSP}€`, DE)?.minor, 2499);
    assert.equal(extractFirstMoney('no price here', US), null);
});

test('parseCount handles localized separators', () => {
    assert.equal(parseCount('1,820 ratings', US), 1820);
    assert.equal(parseCount('1.820 Bewertungen', DE), 1820);
    assert.equal(parseCount('45K+ ratings', US), 45_000);
    assert.equal(parseCount('1.2K ratings', US), 1_200);
    assert.equal(parseCount('1,2 Tsd. Bewertungen', DE), 1_200);
    assert.equal(parseCount('no digits', US), null);
});

test('parseRating handles localized decimal separators', () => {
    assert.equal(parseRating('4.6 out of 5 stars', US), 4.6);
    assert.equal(parseRating('4,6 von 5 Sternen', DE), 4.6);
    assert.equal(parseRating('nonsense', US), null);
});

test('parseBoughtInPastMonth returns a documented lower bound', () => {
    assert.equal(parseBoughtInPastMonth('2K+ bought in past month', US), 2000);
    assert.equal(parseBoughtInPastMonth('50+ bought in past month', US), 50);
    assert.equal(parseBoughtInPastMonth('1M+ bought in past month', US), 1_000_000);
});
