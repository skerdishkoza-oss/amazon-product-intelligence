import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractDatasetInputs } from '../../input/dataset-ingest.js';
import { validateInput } from '../../input/validate.js';

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

test('raw JSON items support strings, object rows and per-row marketplaces', () => {
    const validated = validateInput({
        marketplace: 'US',
        items: [
            'B0CX23V2ZK',
            { url: 'https://www.amazon.de/dp/B0DE12345K' },
            { keyword: 'cafetière', marketplace: 'FR' },
            { asin: 'B0ES12345K', marketplace: 'ES' },
            { asin: 'bad' },
            { asin: 'B0GOOD0001', keyword: 'ambiguous row' },
        ],
    });

    assert.deepEqual(validated.input.asins, ['B0CX23V2ZK']);
    assert.ok(validated.input.urls.includes('https://www.amazon.de/dp/B0DE12345K'));
    assert.ok(validated.input.urls.some((url) => url.startsWith('https://www.amazon.fr/s?')));
    assert.ok(validated.input.urls.includes('https://www.amazon.es/dp/B0ES12345K'));
    assert.deepEqual(validated.rejected.map((item) => item.reason), ['ASIN_MALFORMED', 'URL_UNSUPPORTED']);
});

test('intelligence and monitoring inputs are validated explicitly', () => {
    assert.throws(() => validateInput({ asins: ['B0CX23V2ZK'], mode: 'monitor' }), /requires compareWithDatasetId/);
    const intelligence = validateInput({
        asins: ['B0CX23V2ZK'],
        mode: 'intelligence',
        includeOffers: true,
        includeSellerDetails: true,
    });
    assert.equal(intelligence.input.includeOffers, true);
    assert.equal(intelligence.input.includeSellerDetails, true);

    const monitor = validateInput({ asins: ['B0CX23V2ZK'], mode: 'monitor', compareWithDatasetId: 'prior' });
    assert.equal(monitor.input.compareWithDatasetId, 'prior');
    assert.equal(monitor.input.requestedSchemaVersion, '1.4');
    assert.throws(
        () => validateInput({ asins: ['B0CX23V2ZK'], mode: 'fast', includeOffers: true }),
        /fast mode cannot include offers/,
    );
});
