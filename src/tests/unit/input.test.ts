import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractDatasetInputs } from '../../input/dataset-ingest.js';
import { InputError, validateInput } from '../../input/validate.js';

test('a single multi-word keyword remains one search phrase', () => {
    const validated = validateInput({ keywords: 'coffee maker' });
    assert.deepEqual(validated.input.keywords, ['coffee maker']);
});

test('a run containing only malformed ASINs still produces rejected items', () => {
    const validated = validateInput({ asins: ['bad-asin'] });
    assert.equal(validated.input.asins.length, 0);
    assert.equal(validated.rejected.length, 1);
    assert.equal(validated.rejected[0]?.reason, 'ASIN_MALFORMED');
});

test('dataset ingestion accepts ASINs, URLs and arrays while accounting for bad rows', () => {
    const extracted = extractDatasetInputs(
        [
            { product: 'b0cx23v2zk' },
            { product: 'https://www.amazon.de/dp/B0DE12345K' },
            { product: ['B0GOOD0001', 'B0GOOD0002'] },
            { other: 'missing' },
            { product: 'not-an-asin' },
        ],
        'product',
        'dataset-1',
    );

    assert.deepEqual(extracted.asins, ['B0CX23V2ZK', 'B0GOOD0001', 'B0GOOD0002']);
    assert.deepEqual(extracted.urls, ['https://www.amazon.de/dp/B0DE12345K']);
    assert.deepEqual(extracted.rejected.map((item) => item.reason), ['DATASET_FIELD_MISSING', 'ASIN_MALFORMED']);
    assert.ok(extracted.rejected.every((item) => item.type === 'dataset'));
});

test('empty datasets produce an explicit rejected input', () => {
    const extracted = extractDatasetInputs([], 'asin', 'empty-dataset');
    assert.equal(extracted.rejected[0]?.reason, 'DATASET_EMPTY');
});

test('planned P1 inputs fail clearly instead of running as silent no-ops', () => {
    assert.throws(() => validateInput({ asins: ['B0CX23V2ZK'], mode: 'monitor' }), InputError);
    assert.throws(() => validateInput({ asins: ['B0CX23V2ZK'], includeOffers: true }), /not available/);
    assert.throws(() => validateInput({ asins: ['B0CX23V2ZK'], includeSellerDetails: true }), /not available/);
    assert.throws(() => validateInput({ asins: ['B0CX23V2ZK'], compareWithDatasetId: 'prior' }), /not available/);
});
