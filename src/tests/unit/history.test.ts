import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareProduct, historyKey } from '../../history/compare.js';
import { buildProductRecord, locationBlock } from '../../output/record-builder.js';
import { toMoney, moneyFromMajor } from '../../types/money.js';

function currentRecord(postalCode: string | null = null) {
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
            requestedCountry: postalCode === null ? null : 'US',
            requestedPostalCode: postalCode,
            resolvedPostalCode: postalCode,
            applied: postalCode !== null,
            method: postalCode === null ? 'NONE' : 'SESSION_COOKIE',
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
    assert.deepEqual(result.warnings, ['COMPARISON_NOT_AVAILABLE:NO_MATCHING_PREVIOUS_OBSERVATION']);
});

test('history keys isolate the same ASIN observed in different postal codes', () => {
    const previous = structuredClone(currentRecord('90210')) as unknown as Record<string, unknown>;
    const index = new Map([[historyKey('US', 'B0CX23V2ZK', '90210'), previous]]);
    const current = currentRecord('10001');

    const result = compareProduct(
        current,
        index.get(historyKey(current.marketplace, current.asin, current.location.resolvedPostalCode)),
        'prior',
    );

    assert.equal(result.compared, false);
    assert.equal(result.changed, false);
    assert.deepEqual(result.changes, []);
});

test('parser misses suppress false changes in either observation', () => {
    const extracted = currentRecord();
    const parserMiss = structuredClone(extracted);
    parserMiss.pricing.currentPrice = null;
    parserMiss.pricing.status = 'PARSER_MISS';

    const currentMiss = compareProduct(
        parserMiss,
        structuredClone(extracted) as unknown as Record<string, unknown>,
        'prior',
    );
    assert.equal(currentMiss.changed, false);
    assert.equal(currentMiss.changes.some((change) => change.type === 'PRICE_CHANGED'), false);
    assert.ok(currentMiss.warnings.includes('COMPARISON_SUPPRESSED:pricing:CURRENT_PARSER_MISS'));

    const previousMiss = compareProduct(
        extracted,
        structuredClone(parserMiss) as unknown as Record<string, unknown>,
        'prior',
    );
    assert.equal(previousMiss.changed, false);
    assert.equal(previousMiss.changes.some((change) => change.type === 'PRICE_CHANGED'), false);
    assert.ok(previousMiss.warnings.includes('COMPARISON_SUPPRESSED:pricing:PREVIOUS_PARSER_MISS'));
});
