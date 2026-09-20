/** Search-result parsing. Spec v1.1 sections 4.1, 6.7. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DE, US } from '../../amazon/marketplace-config/index.js';
import { parseSearchPage } from '../../amazon/parsers/search.js';
import * as F from '../fixtures/pages.js';

test('search: cards are extracted with three separate position measures', () => {
    const r = parseSearchPage({ html: F.US_SEARCH_PAGE, marketplace: 'US', cfg: US, page: 1 });
    assert.equal(r.cards.length, 3, 'the "Related searches" row is not a product');

    const sponsored = r.cards[0];
    assert.ok(sponsored);
    assert.equal(sponsored.asin, 'B0SPONSOR1');
    assert.equal(sponsored.sponsored, true);
    assert.equal(sponsored.sponsoredPosition, 1);
    assert.equal(sponsored.organicPosition, null, 'an ad has no organic rank');

    const organic = r.cards[1];
    assert.ok(organic);
    assert.equal(organic.asin, 'B0CX23V2ZK');
    assert.equal(organic.sponsored, false);
    assert.equal(organic.organicPosition, 1, 'first organic result despite being second on the page');
    assert.equal(organic.position, 2, 'what the shopper actually sees');
});

test('search: prices, ratings, badges and demand signals', () => {
    const r = parseSearchPage({ html: F.US_SEARCH_PAGE, marketplace: 'US', cfg: US, page: 1 });
    const card = r.cards.find((c) => c.asin === 'B0CX23V2ZK');
    assert.ok(card);
    assert.equal(card.price?.amount, 24.99);
    assert.equal(card.listPrice?.amount, 29.99);
    assert.equal(card.rating, 4.6);
    assert.equal(card.reviewCount, 1820);
    assert.equal(card.primeEligible, true);
    assert.equal(card.badge, 'Best Seller');
    assert.equal(card.boughtInPastMonthRaw, '2K+ bought in past month');
    assert.ok(card.deliveryText?.includes('FREE delivery'));
    // Canonical form, not the tracking-laden relative href Amazon renders, so
    // the value is stable across runs and joins with the detail record.
    assert.equal(card.url, 'https://www.amazon.com/dp/B0CX23V2ZK');
});

test('search: a card with no list price does not invent one', () => {
    const r = parseSearchPage({ html: F.US_SEARCH_PAGE, marketplace: 'US', cfg: US, page: 1 });
    const card = r.cards.find((c) => c.asin === 'B0SECOND01');
    assert.ok(card);
    assert.equal(card.price?.amount, 15.49);
    assert.equal(card.listPrice, null);
});

test('search: DE locale prices and demand signal on a listing page (C5, C6)', () => {
    const r = parseSearchPage({ html: F.DE_SEARCH_PAGE, marketplace: 'DE', cfg: DE, page: 1 });
    const card = r.cards[0];
    assert.ok(card);
    assert.equal(card.price?.amount, 1234.56, 'not 1.23');
    assert.equal(card.price?.currency, 'EUR');
    assert.equal(card.rating, 4.6);
    assert.equal(card.reviewCount, 1820);
    assert.equal(r.hasNextPage, false, 'a disabled Next control is not a next page');
});

test('search: pagination detection and page offsets', () => {
    const p1 = parseSearchPage({ html: F.US_SEARCH_PAGE, marketplace: 'US', cfg: US, page: 1 });
    assert.equal(p1.hasNextPage, true);
    const p2 = parseSearchPage({ html: F.US_SEARCH_PAGE, marketplace: 'US', cfg: US, page: 2 });
    assert.equal(p2.cards[0]?.position, 17, 'page 2 positions continue from page 1');
});

test('search: a no-results page yields no cards rather than throwing', () => {
    const r = parseSearchPage({ html: F.US_SEARCH_NO_RESULTS, marketplace: 'US', cfg: US, page: 1 });
    assert.equal(r.cards.length, 0);
    assert.equal(r.hasNextPage, false);
});
