import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatasetSchemaError, DatasetWriter, type DatasetSink } from '../../output/dataset-writer.js';
import { buildProductRecord, locationBlock } from '../../output/record-builder.js';
import type { DatasetRecord } from '../../types/output.js';

class SerializingSink implements DatasetSink {
    readonly records: DatasetRecord[] = [];

    async pushData(record: DatasetRecord): Promise<void> {
        this.records.push(JSON.parse(JSON.stringify(record)) as DatasetRecord);
    }
}

function product(source: 'asin' | 'url') {
    return buildProductRecord({
        input: { type: source, value: source === 'asin' ? 'B0CX23V2ZK' : 'https://www.amazon.com/dp/B0CX23V2ZK' },
        marketplace: 'US',
        asin: 'B0CX23V2ZK',
        location: locationBlock({
            requestedCountry: null,
            requestedPostalCode: null,
            resolvedPostalCode: null,
            applied: false,
            method: 'NONE',
        }),
        discoveredFrom: [{
            type: source,
            value: source === 'asin' ? 'B0CX23V2ZK' : 'https://www.amazon.com/dp/B0CX23V2ZK',
        }],
    });
}

test('a product is durable when write resolves and a duplicate is not emitted', async () => {
    const sink = new SerializingSink();
    const writer = new DatasetWriter(sink, true);

    assert.equal(await writer.write(product('asin')), true);
    assert.equal(sink.records.length, 1, 'the product is appended immediately');
    assert.equal(await writer.write(product('url')), false);
    assert.equal(sink.records.length, 1);
    const record = sink.records[0];
    assert.equal(record?.status, 'SUCCESS');
    if (record?.status === 'SUCCESS') assert.deepEqual(record.discoveredFrom, [{ type: 'asin', value: 'B0CX23V2ZK' }]);
});

test('a failed append releases the dedupe key so the product can be retried', async () => {
    let attempts = 0;
    const sink: DatasetSink = {
        async pushData(): Promise<void> {
            attempts += 1;
            if (attempts === 1) throw new Error('temporary dataset failure');
        },
    };
    const writer = new DatasetWriter(sink, true);

    await assert.rejects(writer.write(product('asin')), /temporary dataset failure/);
    assert.equal(await writer.write(product('asin')), true);
    assert.equal(attempts, 2);
});

test('the production writer rejects a schema-invalid value row', async () => {
    const sink = new SerializingSink();
    const writer = new DatasetWriter(sink, true);
    const invalid = product('asin') as unknown as Record<string, unknown>;
    delete invalid.scrapedAt;

    await assert.rejects(
        writer.write(invalid as unknown as DatasetRecord),
        (error: unknown) => error instanceof DatasetSchemaError,
    );
    assert.equal(sink.records.length, 0);
    assert.equal(writer.stats().schemaViolations, 1);
});
