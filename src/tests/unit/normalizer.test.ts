/** Spec v1.1 sections 3.1, 5.1 (C3). */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalProductUrl, classifyUrl, dedupeKey, normalizeAsin, searchUrl } from '../../input/normalizer.js';

test('normalizeAsin accepts valid ASINs including ISBN-10 style', () => {
    assert.equal(normalizeAsin('B0CX23V2ZK'), 'B0CX23V2ZK');
    assert.equal(normalizeAsin('b0cx23v2zk'), 'B0CX23V2ZK', 'must uppercase');
    assert.equal(normalizeAsin(' B0CX23V2ZK '), 'B0CX23V2ZK', 'must trim');
    assert.equal(normalizeAsin('0439708184'), '0439708184', 'all-digit ISBN-10 ASINs are valid');
});

test('normalizeAsin rejects malformed ASINs instead of coercing them', () => {
    assert.equal(normalizeAsin('B0CX23V2Z'), null, 'too short');
    assert.equal(normalizeAsin('B0CX23V2ZKX'), null, 'too long');
    assert.equal(normalizeAsin('B0CX23-2ZK'), null, 'non-alphanumeric');
    assert.equal(normalizeAsin(''), null);
});

test('classifyUrl extracts ASINs from every common product URL shape', () => {
    const shapes = [
        'https://www.amazon.com/dp/B0CX23V2ZK',
        'https://www.amazon.com/Some-Product-Name/dp/B0CX23V2ZK/ref=sr_1_3?keywords=x',
        'https://www.amazon.com/gp/product/B0CX23V2ZK',
        'https://www.amazon.com/gp/aw/d/B0CX23V2ZK',
        'https://www.amazon.com/product/B0CX23V2ZK',
        'https://www.amazon.com/gp/offer-listing/x?asin=B0CX23V2ZK',
    ];
    for (const url of shapes) {
        const result = classifyUrl(url);
        assert.ok(result.ok, `failed on ${url}`);
        assert.equal(result.value.asin, 'B0CX23V2ZK', `wrong ASIN for ${url}`);
        assert.equal(result.value.canonical, 'https://www.amazon.com/dp/B0CX23V2ZK');
    }
});

test('classifyUrl detects the marketplace from the host', () => {
    const uk = classifyUrl('https://www.amazon.co.uk/dp/B0CX23V2ZK');
    assert.ok(uk.ok);
    assert.equal(uk.value.marketplace, 'UK');

    const de = classifyUrl('https://www.amazon.de/dp/B0CX23V2ZK');
    assert.ok(de.ok);
    assert.equal(de.value.marketplace, 'DE');
});

test('classifyUrl reports unsupported marketplaces rather than guessing', () => {
    const fr = classifyUrl('https://www.amazon.fr/dp/B0CX23V2ZK');
    assert.equal(fr.ok, false);
    if (!fr.ok) assert.equal(fr.reason, 'MARKETPLACE_UNSUPPORTED');

    const junk = classifyUrl('not a url');
    assert.equal(junk.ok, false);
    if (!junk.ok) assert.equal(junk.reason, 'URL_UNSUPPORTED');
});

test('classifyUrl distinguishes search, bestsellers and category URLs', () => {
    const search = classifyUrl('https://www.amazon.com/s?k=kettle');
    assert.ok(search.ok);
    assert.equal(search.value.type, 'keyword');
    assert.equal(search.value.keyword, 'kettle');

    const best = classifyUrl('https://www.amazon.com/gp/bestsellers/kitchen');
    assert.ok(best.ok);
    assert.equal(best.value.type, 'bestsellers');

    const cat = classifyUrl('https://www.amazon.com/b/?node=284507');
    assert.ok(cat.ok);
    assert.equal(cat.value.type, 'category');
});

test('classifyUrl does not mistake storefront paths for /s search pages', () => {
    const store = classifyUrl('https://www.amazon.com/stores/ExampleBrand/page/ABC123');
    assert.ok(store.ok);
    assert.equal(store.value.type, 'seller');

    const sellerSearch = classifyUrl('https://www.amazon.com/s?me=A1SELLER123&marketplaceID=ATVPDKIKX0DER');
    assert.ok(sellerSearch.ok);
    assert.equal(sellerSearch.value.type, 'seller');
    assert.equal(sellerSearch.value.sellerId, 'A1SELLER123');
});

test('dedupe key includes the resolved location (C3)', () => {
    const a = dedupeKey('US', 'B0CX23V2ZK', '10001');
    const b = dedupeKey('US', 'B0CX23V2ZK', '90210');
    const c = dedupeKey('US', 'B0CX23V2ZK', null);
    assert.notEqual(a, b, 'two postal codes must not collapse into one record');
    assert.equal(c, 'US|B0CX23V2ZK|default');
});

test('URL builders use the right host per marketplace', () => {
    assert.equal(canonicalProductUrl('DE', 'B0CX23V2ZK'), 'https://www.amazon.de/dp/B0CX23V2ZK');
    assert.ok(searchUrl('UK', 'kettle', 2).startsWith('https://www.amazon.co.uk/s?'));
    assert.ok(searchUrl('UK', 'kettle', 2).includes('page=2'));
});
