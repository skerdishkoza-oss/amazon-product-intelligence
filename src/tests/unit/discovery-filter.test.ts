import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchCard } from '../../amazon/parsers/search.js';
import { cardDiscountPercent, matchDiscoveryCard } from '../../pipeline/discovery-filter.js';
import type { DiscoveryFilters } from '../../types/input.js';

const card: SearchCard = {
    asin: 'B0CX23V2ZK',
    title: 'Kettle',
    url: 'https://www.amazon.com/dp/B0CX23V2ZK',
    thumbnail: null,
    price: { amount: 24, currency: 'USD', raw: '$24.00' },
    listPrice: { amount: 30, currency: 'USD', raw: '$30.00' },
    rating: 4.6,
    reviewCount: 1820,
    primeEligible: true,
    sponsored: false,
    badge: null,
    boughtInPastMonthRaw: '2K+ bought in past month',
    boughtInPastMonthMin: 2000,
    deliveryText: null,
    position: 1,
    organicPosition: 1,
    sponsoredPosition: null,
};

const openFilters: DiscoveryFilters = {
    minPrice: null,
    maxPrice: null,
    minRating: null,
    minReviewCount: null,
    primeOnly: false,
    sponsoredPolicy: 'include',
    minBoughtInPastMonth: null,
    minDiscountPercent: null,
};

test('discovery filters compose and use inclusive thresholds', () => {
    const result = matchDiscoveryCard(card, {
        ...openFilters,
        minPrice: 24,
        maxPrice: 24,
        minRating: 4.6,
        minReviewCount: 1820,
        primeOnly: true,
        sponsoredPolicy: 'exclude',
        minBoughtInPastMonth: 2000,
        minDiscountPercent: 20,
    });
    assert.deepEqual(result, { matches: true, reasons: [] });
    assert.equal(cardDiscountPercent(card), 20);
});

test('a requested filter excludes cards with missing evidence', () => {
    const result = matchDiscoveryCard({ ...card, price: null }, { ...openFilters, maxPrice: 100 });
    assert.equal(result.matches, false);
    assert.deepEqual(result.reasons, ['PRICE_MISSING']);
});

test('sponsored-only and organic-only policies are explicit', () => {
    assert.deepEqual(
        matchDiscoveryCard(card, { ...openFilters, sponsoredPolicy: 'only' }).reasons,
        ['ORGANIC_EXCLUDED'],
    );
    assert.deepEqual(
        matchDiscoveryCard({ ...card, sponsored: true }, { ...openFilters, sponsoredPolicy: 'exclude' }).reasons,
        ['SPONSORED_EXCLUDED'],
    );
});
