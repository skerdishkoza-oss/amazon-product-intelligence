import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Actor, input and dataset schemas are valid JSON with a dataset view', async () => {
    const [actorRaw, inputRaw, datasetRaw] = await Promise.all([
        readFile('.actor/actor.json', 'utf8'),
        readFile('.actor/input_schema.json', 'utf8'),
        readFile('.actor/dataset_schema.json', 'utf8'),
    ]);
    const actor = JSON.parse(actorRaw) as { storages?: { dataset?: unknown } };
    const input = JSON.parse(inputRaw) as { properties?: Record<string, unknown> };
    const dataset = JSON.parse(datasetRaw) as { views?: Record<string, unknown>; fields?: unknown };

    assert.equal(actor.storages?.dataset, './dataset_schema.json');
    assert.ok(input.properties?.datasetId);
    assert.ok(dataset.fields);
    assert.ok(dataset.views?.results);
});
