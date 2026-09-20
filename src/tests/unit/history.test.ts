import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareProduct } from '../../history/compare.js';
import { buildProductRecord, locationBlock } from '../../output/record-builder.js';
import { toMoney, moneyFromMajor } from '../../types/money.js';

function currentRecord() {
    return buildProductRecord({
        input: { type: 'asin', value: 'B0CX23V2ZK' },
        marketplace: 'US',
        asin: 'B0CX23V2ZK',
        title: 'Example',
        pricing: {
            currentPrice: toMoney(moneyFromMajor(24.99, 'USD', '$24.99')),
            listPrice: null,
            discountAmount: null,
            discountPercent: null,
            dealPrice: null,
            dealType: null,
            coupon: null,
            subscribeAndSave: null,
            unitPrice: null,
            priceSource: 'BUY_BOX',
            status: 'EXTRACTED',
        },
        location: locationBlock({
            requestedCountry: null,
            requestedPostalCode: null,
            resolvedPostalCode: null,
            applied: false,
            method: 'NONE',
        }),
    });
}

test('unchanged records do not invent a seller-count change when offers were not requested', () => {
    const current = currentRecord();
    const prior = structuredClone(current) as unknown as Record<string, unknown>;
    prior.schemaVersion = '1.1';
    delete prior.offers;
    delete prior.sellerProfiles;
    delete prior.monitoring;

    const result = compareProduct(current, prior, 'prior');
    assert.equal(result.compared, true);
    assert.equal(result.changed, false);
    assert.deepEqual(result.changes, []);
});

test('a missing prior product is explicit, not reported as unchanged comparison', () => {
    const result = compareProduct(currentRecord(), undefined, 'prior');
    assert.equal(result.compared, false);
    assert.equal(result.status, 'NOT_PRESENT');
    assert.equal(result.changed, false);
});
