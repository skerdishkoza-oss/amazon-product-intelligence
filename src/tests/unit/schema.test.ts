/**
 * Spec v1.1 section 12.2 (C15). The golden schema gate.
 * Also asserts C1 (timestamp) and C4 (location block) can never be omitted.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertValidRecord, validateRecord } from '../../quality/validation.js';
import {
    buildFailureRecord,
    buildProductRecord,
    emptyVariants,
    locationBlock,
    qualityBlock,
} from '../../output/record-builder.js';
import { FAILURE_REASON, RECORD_STATUS } from '../../types/status.js';
import { toMoney, moneyFromMajor } from '../../types/money.js';

function sampleLocation() {
    return locationBlock({
        requestedCountry: 'US',
        requestedPostalCode: '10001',
        resolvedPostalCode: '10001',
        applied: true,
        method: 'SESSION_COOKIE',
    });
}

test('a minimal product record validates against the golden schema', () => {
    const record = buildProductRecord({
        input: { type: 'asin', value: 'B0CX23V2ZK' },
        marketplace: 'US',
        asin: 'B0CX23V2ZK',
        location: sampleLocation(),
    });
    assertValidRecord(record);
    assert.equal(record.schemaVersion, '1.1');
    assert.match(record.scrapedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'C1: scrapedAt is mandatory');
    assert.equal(record.canonicalUrl, 'https://www.amazon.com/dp/B0CX23V2ZK');
});

test('a fully populated product record validates', () => {
    const record = buildProductRecord({
        input: { type: 'keyword', value: 'stainless steel kettle' },
        marketplace: 'US',
        asin: 'B0CX23V2ZK',
        parentAsin: 'B0PARENTXX',
        title: 'Example Product',
        brand: 'Example Brand',
        pricing: {
            currentPrice: toMoney(moneyFromMajor(24.99, 'USD', '$24.99')),
            listPrice: toMoney(moneyFromMajor(29.99, 'USD', '$29.99')),
            discountAmount: toMoney(moneyFromMajor(5, 'USD', '')),
            discountPercent: 16.67,
            dealPrice: null,
            dealType: null,
            coupon: null,
            subscribeAndSave: null,
            unitPrice: '$1.04/oz',
            priceSource: 'BUY_BOX',
            status: 'EXTRACTED',
        },
        rankings: {
            mainBSR: 14,
            mainBSRCategory: 'Kitchen & Dining',
            all: [{ rank: 14, category: 'Kitchen & Dining' }],
            boughtInPastMonthRaw: '2K+ bought in past month',
            boughtInPastMonthMin: 2000,
            source: 'PRODUCT_DETAILS_TABLE',
            status: 'EXTRACTED',
        },
        variants: {
            mode: 'discover',
            dimensions: ['Color', 'Size'],
            items: [{ asin: 'B0CHILD001', options: { Color: 'Black', Size: 'M' } }],
            truncated: false,
            status: 'EXTRACTED',
        },
        location: sampleLocation(),
        quality: qualityBlock({ completenessScore: 96, fetchAttempts: 1, proxyTier: 'DATACENTER', pageType: 'STANDARD_PRODUCT' }),
        discoveredFrom: [{ type: 'keyword', value: 'stainless steel kettle', page: 1, position: 7 }],
    });
    assertValidRecord(record);
});

test('every failure status produces a valid failure row', () => {
    for (const status of Object.values(RECORD_STATUS)) {
        if (status === 'SUCCESS') continue;
        const record = buildFailureRecord({
            status,
            input: { type: 'asin', value: 'B0CX23V2ZK' },
            marketplace: 'US',
            asin: 'B0CX23V2ZK',
            attempts: 3,
            reason: FAILURE_REASON.BLOCKED_AFTER_FALLBACK,
            lastProxyTier: 'RESIDENTIAL',
        });
        assertValidRecord(record);
        assert.equal(record.chargedProductEvent, false, 'a failure row can never report a charge');
    }
});

test('the schema rejects a record with no scrapedAt (C1)', () => {
    const record = buildProductRecord({
        input: { type: 'asin', value: 'B0CX23V2ZK' },
        marketplace: 'US',
        asin: 'B0CX23V2ZK',
        location: sampleLocation(),
    }) as unknown as Record<string, unknown>;
    delete record.scrapedAt;
    assert.equal(validateRecord(record).valid, false);
});

test('the schema rejects a record with no location block (C4)', () => {
    const record = buildProductRecord({
        input: { type: 'asin', value: 'B0CX23V2ZK' },
        marketplace: 'US',
        asin: 'B0CX23V2ZK',
        location: sampleLocation(),
    }) as unknown as Record<string, unknown>;
    delete record.location;
    assert.equal(validateRecord(record).valid, false);
});

test('the schema rejects a failure row claiming SUCCESS', () => {
    const bogus = {
        ...buildFailureRecord({
            status: RECORD_STATUS.BLOCKED,
            input: { type: 'asin', value: 'B0CX23V2ZK' },
            marketplace: 'US',
            reason: FAILURE_REASON.CHALLENGE_PAGE,
        }),
        status: 'SUCCESS',
    };
    assert.equal(validateRecord(bogus).valid, false);
});

test('the schema rejects an unknown field-level status', () => {
    const record = buildProductRecord({
        input: { type: 'asin', value: 'B0CX23V2ZK' },
        marketplace: 'US',
        asin: 'B0CX23V2ZK',
        location: sampleLocation(),
    });
    record.pricing.status = 'MAYBE' as never;
    assert.equal(validateRecord(record).valid, false);
});

test('discover-mode variants omit price rather than nulling it (C13)', () => {
    const variants = emptyVariants('discover', 'EXTRACTED');
    variants.items.push({ asin: 'B0CHILD001', options: { Color: 'Black' } });
    assert.equal('price' in variants.items[0]!, false, 'absent means "not requested"');
});
