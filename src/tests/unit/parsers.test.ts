/**
 * Parser suite over the offline fixtures. Spec v1.1 sections 6, 9.6, 12.1.
 *
 * The assertions that matter most are not "did it find the price" but "did it
 * report the right STATUS when it did not" -- NOT_PRESENT vs PARSER_MISS is the
 * product's core promise (5.3), and it is the thing competitors get wrong.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DE, UK, US } from '../../amazon/marketplace-config/index.js';
import { parseAvailability } from '../../amazon/parsers/availability.js';
import { parseRankings } from '../../amazon/parsers/bsr.js';
import { parseBuyBox } from '../../amazon/parsers/buybox.js';
import { parseContent } from '../../amazon/parsers/content.js';
import { parseIdentity } from '../../amazon/parsers/identity.js';
import { maxResolution, parseMedia } from '../../amazon/parsers/media.js';
import { parsePricing } from '../../amazon/parsers/price.js';
import { parseProductPage } from '../../amazon/parsers/product.js';
import { parseRatings } from '../../amazon/parsers/ratings.js';
import { parseVariants } from '../../amazon/parsers/variants.js';
import * as F from '../fixtures/pages.js';

/* ----------------------------------------------------------------- identity */

test('identity: title, ASIN and brand from a US product page', () => {
    const id = parseIdentity(F.US_STANDARD);
    assert.equal(id.asin, 'B0CX23V2ZK');
    assert.equal(id.title, 'Example Brand Electric Kettle, 1.7L Stainless Steel', 'whitespace collapsed');
    assert.equal(id.brand, 'Example Brand', '"Visit the X Store" reduces to X');
    assert.equal(id.parentAsin, null);
});

test('identity: DE byline prefix and parent ASIN from the twister payload', () => {
    assert.equal(parseIdentity(F.DE_STANDARD).brand, 'Beispielmarke', '"Marke: X" reduces to X');
    const parent = parseIdentity(F.US_VARIATION_PARENT);
    assert.equal(parent.parentAsin, 'B0PARENT01');
});

/* ------------------------------------------------------------------ pricing */

test('pricing: US current price, list price and derived discount', () => {
    const p = parsePricing(F.US_STANDARD, US);
    assert.equal(p.status, 'EXTRACTED');
    assert.equal(p.currentPrice?.amount, 24.99);
    assert.equal(p.currentPrice?.currency, 'USD');
    assert.equal(p.listPrice?.amount, 29.99);
    assert.equal(p.discountAmount?.amount, 5);
    assert.equal(p.discountPercent, 16.67, 'computed in minor units, rounded once');
    assert.equal(p.priceSource, 'CORE_PRICE_DISPLAY');
    assert.equal(p.unitPrice, '($14.70 / liter)');
});

test('pricing: DE comma decimals are not read as US thousands (C5)', () => {
    const p = parsePricing(F.DE_STANDARD, DE);
    assert.equal(p.currentPrice?.amount, 1234.56, 'the 1.23 bug would show up right here');
    assert.equal(p.currentPrice?.currency, 'EUR');
    assert.equal(p.listPrice?.amount, 1499);
});

test('pricing: UK pound prices with comma thousands', () => {
    const p = parsePricing(F.UK_STANDARD, UK);
    assert.equal(p.currentPrice?.amount, 1234.56);
    assert.equal(p.currentPrice?.currency, 'GBP');
});

test('pricing: out of stock reports OUT_OF_STOCK, never PARSER_MISS', () => {
    const p = parsePricing(F.US_OUT_OF_STOCK, US);
    assert.equal(p.currentPrice, null);
    assert.equal(p.status, 'OUT_OF_STOCK', 'Amazon showed no price; that is an answer, not a failure');
});

test('pricing: coupon, deal badge and Subscribe & Save', () => {
    const p = parsePricing(F.US_COUPON_DEAL, US);
    assert.equal(p.currentPrice?.amount, 17.49);
    assert.equal(p.coupon?.type, 'PERCENT');
    assert.equal(p.coupon?.percent, 10);
    assert.equal(p.dealType, 'Limited time deal');
    assert.equal(p.subscribeAndSave?.amount, 15.74);
});

test('pricing: legacy priceblock layout still resolves', () => {
    const p = parsePricing(F.US_LEGACY_LAYOUT, US);
    assert.equal(p.currentPrice?.amount, 21.95);
    assert.equal(p.priceSource, 'BUY_BOX');
});

test('pricing: JSON-LD is used only as a last resort and is flagged', () => {
    const p = parsePricing(F.US_JSON_LD_ONLY, US);
    assert.equal(p.currentPrice?.amount, 27.5);
    assert.equal(p.priceSource, 'JSON_LD');
});

/* ------------------------------------------------------------- availability */

test('availability: localized states across all three marketplaces (C6)', () => {
    assert.equal(parseAvailability(F.US_STANDARD, US).state, 'IN_STOCK');
    assert.equal(parseAvailability(F.UK_STANDARD, UK).state, 'IN_STOCK');
    const de = parseAvailability(F.DE_STANDARD, DE);
    assert.equal(de.state, 'IN_STOCK', '"Auf Lager" is in stock');
    assert.equal(de.status, 'EXTRACTED');
});

test('availability: ordinary German Auf Lager with punctuation is not limited stock', () => {
    const html = '<div id="availability"><span class="a-color-success">Auf Lager.</span></div>';
    const availability = parseAvailability(html, DE);
    assert.equal(availability.state, 'IN_STOCK');
    assert.equal(availability.status, 'EXTRACTED');
});

test('availability: out of stock and limited stock', () => {
    assert.equal(parseAvailability(F.US_OUT_OF_STOCK, US).state, 'OUT_OF_STOCK');
    const limited = parseAvailability(F.US_COUPON_DEAL, US);
    assert.equal(limited.state, 'LIMITED_STOCK');
    assert.ok(limited.stockLeftText?.includes('Only 3 left'));
});

test('availability: unrecognized localized phrasing is a reported miss', () => {
    const a = parseAvailability(F.DE_UNKNOWN_AVAILABILITY, DE);
    assert.equal(a.status, 'PARSER_MISS', 'unknown phrasing must not be silently UNKNOWN');
    assert.equal(a.state, 'UNKNOWN');
    assert.ok(a.availabilityText?.includes('Wird demn'), 'raw text preserved so QA can extend the config');
});

test('availability: delivery, shipping and seller fields', () => {
    const a = parseAvailability(F.US_STANDARD, US);
    assert.ok(a.deliveryText?.includes('FREE delivery'));
    assert.equal(a.deliveryDate, 'Tuesday, March 26');
    assert.equal(a.primeEligible, true);
    assert.equal(a.soldBy, 'Example Brand Direct');
    assert.equal(a.shipsFrom, 'Amazon.com');
});

/* --------------------------------------------------------------------- BSR  */

test('bsr: US product details table with two ranks', () => {
    const r = parseRankings(F.US_STANDARD, US);
    assert.equal(r.status, 'EXTRACTED');
    assert.equal(r.mainBSR, 14);
    assert.equal(r.mainBSRCategory, 'Kitchen & Dining');
    assert.equal(r.all.length, 2);
    assert.deepEqual(r.all[1], { rank: 3, category: 'Electric Kettles' });
    assert.equal(r.source, 'PRODUCT_DETAILS_TABLE');
});

test('bsr: DE localized label and comma-free rank numbers', () => {
    const r = parseRankings(F.DE_STANDARD, DE);
    assert.equal(r.mainBSR, 14);
    assert.ok(r.mainBSRCategory?.startsWith('Küche'));
    assert.equal(r.boughtInPastMonthMin, 2000, '2Tsd.+ is a documented lower bound');
});

test('bsr: legacy detail-bullets layout and thousands separator', () => {
    const r = parseRankings(F.US_LEGACY_LAYOUT, US);
    assert.equal(r.mainBSR, 1204, '#1,204 must not become 1');
    assert.equal(r.source, 'DETAIL_BULLETS');
});

test('bsr: no rank at all is NOT_PRESENT, not a parser miss (C20)', () => {
    const r = parseRankings(F.US_NO_BSR_NO_REVIEWS, US);
    assert.equal(r.status, 'NOT_PRESENT');
    assert.equal(r.mainBSR, null);
});

test('bsr: demand signal is parsed as a lower bound', () => {
    const r = parseRankings(F.US_STANDARD, US);
    assert.equal(r.boughtInPastMonthRaw, '2K+ bought in past month');
    assert.equal(r.boughtInPastMonthMin, 2000);
});

/* ------------------------------------------------------------------ ratings */

test('ratings: US and DE decimal separators', () => {
    const us = parseRatings(F.US_STANDARD, US);
    assert.equal(us.rating, 4.6);
    assert.equal(us.reviewCount, 1820);

    const de = parseRatings(F.DE_STANDARD, DE);
    assert.equal(de.rating, 4.6, '"4,6 von 5" is 4.6');
    assert.equal(de.reviewCount, 1820, '"1.820" is 1820, not 1.82');
});

test('ratings: absent review section is NOT_PRESENT', () => {
    assert.equal(parseRatings(F.US_NO_BSR_NO_REVIEWS, US).status, 'NOT_PRESENT');
});

/* ------------------------------------------------------------------- buybox */

test('buybox: Amazon as seller classifies as AMZ', () => {
    const b = parseBuyBox(F.US_STANDARD, US);
    assert.equal(b.present, true);
    assert.equal(b.price?.amount, 24.99);
    assert.equal(b.seller, 'Example Brand Direct');
    assert.equal(b.sellerId, 'A1EXAMPLE99', 'read from the seller profile link');
    assert.equal(b.shipsFrom, 'Amazon.com');
    assert.equal(b.fulfillment, 'FBA', 'third-party seller shipped by Amazon');
});

test('buybox: third-party seller shipped by Amazon is FBA', () => {
    const b = parseBuyBox(F.US_THIRD_PARTY_FBA, US);
    assert.equal(b.seller, 'Kitchen Deals Co');
    assert.equal(b.sellerId, 'A9THIRD001');
    assert.equal(b.fulfillment, 'FBA');
    assert.equal(b.amazonIsSeller, false);
});

test('buybox: no Buy Box is a real state, not a failure', () => {
    const b = parseBuyBox(F.US_NO_BUYBOX, US);
    assert.equal(b.present, false);
    assert.equal(b.status, 'NOT_PRESENT');
});

test('buybox: DE localized "Verkauft von" label is stripped', () => {
    const b = parseBuyBox(F.DE_STANDARD, DE);
    assert.equal(b.seller, 'Beispielmarke DE');
    assert.equal(b.sellerId, 'A2GERMAN77');
});

/* ----------------------------------------------------------------- variants */

test('variants: discover reads the full child matrix at zero request cost (C13)', () => {
    const v = parseVariants({ html: F.US_VARIATION_PARENT, mode: 'discover', maxVariants: 50 });
    assert.equal(v.status, 'EXTRACTED');
    assert.deepEqual(v.dimensions, ['Color', 'Size']);
    assert.equal(v.items.length, 5);
    assert.deepEqual(v.items[0], { asin: 'B0CHILD001', options: { Color: 'Black', Size: '1.0L' } });
    assert.equal('price' in v.items[0]!, false, 'discover mode omits price rather than nulling it');
    assert.equal(v.truncated, false);
});

test('variants: items are sorted so repeated runs are byte-identical', () => {
    const a = parseVariants({ html: F.US_VARIATION_PARENT, mode: 'discover', maxVariants: 50 });
    const b = parseVariants({ html: F.US_VARIATION_PARENT, mode: 'discover', maxVariants: 50 });
    assert.deepEqual(a.items.map((i) => i.asin), b.items.map((i) => i.asin));
    assert.deepEqual(a.items.map((i) => i.asin), [...a.items.map((i) => i.asin)].sort());
});

test('variants: maxVariants truncates and says so', () => {
    const v = parseVariants({ html: F.US_VARIATION_PARENT, mode: 'discover', maxVariants: 2 });
    assert.equal(v.items.length, 2);
    assert.equal(v.truncated, true);
    assert.equal(v.truncatedAt, 2);
});

test('variants: DOM-only twister fallback', () => {
    const v = parseVariants({ html: F.US_VARIATION_DOM_ONLY, mode: 'discover', maxVariants: 50 });
    assert.equal(v.status, 'EXTRACTED');
    assert.equal(v.items.length, 2);
    assert.deepEqual(v.dimensions, ['Colour']);
    assert.ok(v.items.some((i) => i.asin === 'B0DOMKID02'), 'ASIN recovered from data-dp-url');
});

test('variants: a non-parent product is NOT_PRESENT, and mode none is NOT_APPLICABLE', () => {
    assert.equal(parseVariants({ html: F.US_STANDARD, mode: 'discover', maxVariants: 50 }).status, 'NOT_PRESENT');
    assert.equal(parseVariants({ html: F.US_VARIATION_PARENT, mode: 'none', maxVariants: 50 }).status, 'NOT_APPLICABLE');
});

/* -------------------------------------------------------------------- media */

test('media: gallery URLs are normalized to full resolution', () => {
    const m = parseMedia(F.US_STANDARD);
    assert.equal(m.status, 'EXTRACTED');
    assert.equal(m.mainImage, 'https://m.media-amazon.com/images/I/71example.jpg');
    assert.ok(m.images.length >= 2, 'both gallery entries kept');
    assert.equal(maxResolution('https://x/I/71a._AC_SX679_.jpg'), 'https://x/I/71a.jpg');
});

/* ------------------------------------------------------------------ content */

test('content: bullets, specs and breadcrumb, with hidden bullets excluded', () => {
    const c = parseContent(F.US_STANDARD, US);
    assert.equal(c.status, 'EXTRACTED');
    assert.equal(c.bullets.length, 3, 'aok-hidden marketing copy is not a product bullet');
    assert.equal(c.manufacturer, 'Example Brand LLC');
    assert.equal(c.model, 'EK-1700-SS');
    assert.equal(c.weight, '2.4 pounds');
    assert.equal(c.dateFirstAvailable, 'March 14, 2024');
    assert.deepEqual(c.breadcrumb, ['Home & Kitchen', 'Electric Kettles']);
    assert.equal(c.aPlusContent, true);
});

test('content: DE localized spec labels resolve', () => {
    const c = parseContent(F.DE_STANDARD, DE);
    assert.equal(c.manufacturer, 'Beispielmarke GmbH');
    assert.equal(c.weight, '1,1 kg');
});

/* ------------------------------------------------------------ full facade  */

test('facade: a complete US record has every block EXTRACTED', () => {
    const r = parseProductPage({ html: F.US_STANDARD, url: 'https://www.amazon.com/dp/B0CX23V2ZK', marketplace: 'US', variantMode: 'discover' });
    assert.equal(r.hasAnyCriticalField, true);
    assert.equal(r.pricing.status, 'EXTRACTED');
    assert.equal(r.availability.status, 'EXTRACTED');
    assert.equal(r.rankings.status, 'EXTRACTED');
    assert.equal(r.ratings.status, 'EXTRACTED');
    assert.equal(r.buyBox.status, 'EXTRACTED');
    assert.equal(r.media.status, 'EXTRACTED');
    assert.equal(r.product.status, 'EXTRACTED');
    assert.equal(r.warnings.filter((w) => w.startsWith('PARSER_THREW')).length, 0, 'no strategy may throw');
});

test('facade: a challenge page yields no critical field', () => {
    const r = parseProductPage({ html: F.CHALLENGE_PAGE, url: 'x', marketplace: 'US', variantMode: 'none' });
    assert.equal(r.hasAnyCriticalField, false, 'must become PARSER_ERROR upstream, never a null-filled success');
});

test('facade: out of stock is still a usable record', () => {
    const r = parseProductPage({ html: F.US_OUT_OF_STOCK, url: 'x', marketplace: 'US', variantMode: 'discover' });
    assert.equal(r.hasAnyCriticalField, true, 'an out-of-stock product is real data a seller wants');
    assert.equal(r.pricing.status, 'OUT_OF_STOCK');
    assert.equal(r.availability.state, 'OUT_OF_STOCK');
});

test('facade: unrecognized availability surfaces a warning with the raw text', () => {
    const r = parseProductPage({ html: F.DE_UNKNOWN_AVAILABILITY, url: 'x', marketplace: 'DE', variantMode: 'none' });
    assert.ok(r.warnings.some((w) => w.startsWith('AVAILABILITY_UNRECOGNIZED')));
});
