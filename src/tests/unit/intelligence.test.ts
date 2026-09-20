import assert from 'node:assert/strict';
import { test } from 'node:test';
import { US } from '../../amazon/marketplace-config/index.js';
import { parseOffers } from '../../amazon/parsers/offers.js';
import { parseSellerProfile, sellerProfileUrl } from '../../amazon/parsers/seller.js';
import * as F from '../fixtures/pages.js';

test('offer parser extracts landed price, seller, condition and fulfillment', () => {
    const sourceUrl = 'https://www.amazon.com/gp/product/ajax?asin=B0CX23V2ZK';
    const offers = parseOffers({ html: F.US_OFFERS, cfg: US, sourceUrl, maxOffers: 10 });
    assert.equal(offers.status, 'EXTRACTED');
    assert.equal(offers.items.length, 2);
    assert.equal(offers.totalCount, 2);
    assert.equal(offers.items[0]?.sellerId, 'A1EXAMPLE01');
    assert.equal(offers.items[0]?.landedPrice?.amount, 22.99);
    assert.equal(offers.items[0]?.fulfillment, 'FBA');
    assert.equal(offers.items[0]?.sellerFeedbackCount, 1234);
    assert.equal(offers.items[1]?.condition, 'USED');
    assert.equal(offers.items[1]?.landedPrice?.amount, 22.99);
});

test('offer parser enforces maxOffers and reports truncation', () => {
    const offers = parseOffers({
        html: F.US_OFFERS,
        cfg: US,
        sourceUrl: 'https://www.amazon.com/offers',
        maxOffers: 1,
    });
    assert.equal(offers.items.length, 1);
    assert.equal(offers.truncated, true);
});

test('seller parser keeps only public business and feedback fields with source URL', () => {
    const sourceUrl = sellerProfileUrl(US, 'A1EXAMPLE01');
    const seller = parseSellerProfile({
        html: F.US_SELLER_PROFILE,
        cfg: US,
        sellerId: 'A1EXAMPLE01',
        sourceUrl,
    });
    assert.equal(seller.status, 'EXTRACTED');
    assert.equal(seller.sellerName, 'Seller One');
    assert.equal(seller.businessName, 'Example Commerce LLC');
    assert.equal(seller.feedbackCount, 1234);
    assert.equal(seller.feedback30Days?.positivePercent, 99);
    assert.equal(seller.legalIdentifiers['VAT ID'], 'US-EXAMPLE-123');
    assert.equal(seller.sourceUrl, sourceUrl);
});
