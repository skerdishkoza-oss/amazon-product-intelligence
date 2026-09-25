import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Actor, input, output and dataset schemas are valid JSON with discoverable outputs', async () => {
    const [actorRaw, inputRaw, outputRaw, datasetRaw] = await Promise.all([
        readFile('.actor/actor.json', 'utf8'),
        readFile('.actor/input_schema.json', 'utf8'),
        readFile('.actor/output_schema.json', 'utf8'),
        readFile('.actor/dataset_schema.json', 'utf8'),
    ]);
    const actor = JSON.parse(actorRaw) as { output?: unknown; storages?: { dataset?: unknown } };
    const input = JSON.parse(inputRaw) as { properties?: Record<string, unknown> };
    const output = JSON.parse(outputRaw) as { properties?: Record<string, unknown> };
    const dataset = JSON.parse(datasetRaw) as {
        views?: { results?: { transformation?: { fields?: string[] } } };
        fields?: { properties?: Record<string, unknown> };
    };

    assert.equal(actor.storages?.dataset, './dataset_schema.json');
    assert.equal(actor.output, './output_schema.json');
    assert.ok(input.properties?.datasetId);
    assert.ok(output.properties?.results);
    assert.ok(output.properties?.runSummary);
    assert.ok(dataset.fields);
    assert.ok(dataset.views?.results);
    const stableBlocks = ['retrieval', 'pricing', 'availability', 'rankings', 'ratings', 'buyBox', 'variants', 'product', 'media', 'offers', 'sellerProfiles', 'monitoring', 'location', 'quality', 'discoveredFrom'];
    for (const block of stableBlocks) {
        assert.ok(dataset.fields?.properties?.[block], `${block} must be declared in the dataset schema`);
        assert.ok(dataset.views?.results?.transformation?.fields?.includes(block), `${block} must be visible in the Results view`);
    }
});
