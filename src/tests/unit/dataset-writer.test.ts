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
        discoveredFrom: [{ type: source, value: source }],
    });
}

test('dedupe merges provenance before an append-only sink serializes the row', async () => {
    const sink = new SerializingSink();
    const writer = new DatasetWriter(sink, true);

    assert.equal(await writer.write(product('asin')), true);
    assert.equal(await writer.write(product('url')), false);
    assert.equal(sink.records.length, 0, 'deduplicated products remain mutable until flush');

    await writer.flush();
    assert.equal(sink.records.length, 1);
    const record = sink.records[0];
    assert.equal(record?.status, 'SUCCESS');
    if (record?.status === 'SUCCESS') assert.equal(record.discoveredFrom.length, 2);
});

test('all product rows are staged and an uncharged row can be discarded', async () => {
    const sink = new SerializingSink();
    const writer = new DatasetWriter(sink, false);
    const staged = product('asin');

    assert.equal(await writer.write(staged), true);
    assert.equal(sink.records.length, 0);
    assert.equal(writer.discard(staged), true);

    await writer.flush();
    assert.equal(sink.records.length, 0, 'discarded value must never reach the append-only dataset');
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
