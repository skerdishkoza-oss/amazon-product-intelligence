/**
 * End-to-end pipeline tests. Spec v1.1 sections 4, 8.2, 9.5, 10.3, 12.2.
 *
 * The accounting invariant is asserted in every one of these, because it is the
 * promise that has to survive blocks, ceilings, caps and breakers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BillingEvents, NoopChargingBackend } from '../../billing/events.js';
import { validateInput } from '../../input/validate.js';
import { RunAccounting } from '../../output/accounting.js';
import { DatasetWriter, MemorySink } from '../../output/dataset-writer.js';
import { buildRunSummary } from '../../output/summary.js';
import { runPipeline } from '../../pipeline/run.js';
import { validateRecord } from '../../quality/validation.js';
import { isProductRecord, type ProductRecord } from '../../types/output.js';
import * as F from '../fixtures/pages.js';
import { BLOCKED, NOT_FOUND, ScriptedFetcher, ok } from '../helpers.js';

interface Harness {
    sink: MemorySink;
    accounting: RunAccounting;
    billing: BillingEvents;
    backend: NoopChargingBackend;
}

function harness(capAfter?: number): Harness {
    const backend = new NoopChargingBackend(capAfter);
    return { sink: new MemorySink(), accounting: new RunAccounting(), billing: new BillingEvents(backend), backend };
}

async function run(
    h: Harness,
    rawInput: Parameters<typeof validateInput>[0],
    fetcher: ScriptedFetcher,
    maxConcurrency = 4,
    previousRecords?: Map<string, Record<string, unknown>>,
) {
    const validated = validateInput(rawInput);
    return runPipeline({
        validated,
        fetcher,
        writer: new DatasetWriter(h.sink, validated.input.deduplicate),
        billing: h.billing,
        accounting: h.accounting,
        log: () => {},
        maxConcurrency,
        sleep: async () => {},
        previousRecords,
    });
}

function products(h: Harness): ProductRecord[] {
    return h.sink.records.filter(isProductRecord);
}

test('every input is accounted for and only successes are charged', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher({ script: { B0BLOCK001: BLOCKED, B0MISSING1: NOT_FOUND } });

    await run(
        h,
        {
            marketplace: 'US',
            asins: ['B0GOOD0001', 'B0GOOD0002', 'B0BLOCK001', 'B0MISSING1', 'TOO-SHORT'],
            urls: ['https://www.amazon.com.au/dp/B0AUSSIE01', 'https://www.amazon.com/dp/B0GOOD0003'],
            postalCode: '10001',
        },
        fetcher,
    );

    h.accounting.assertInvariant();
    const counts = h.accounting.snapshot();
    assert.equal(counts.success, 3, 'three fetchable products');
    assert.equal(counts.blocked, 1);
    assert.equal(counts.productNotFound, 1);
    assert.equal(counts.invalidInput, 2, 'malformed ASIN plus unsupported marketplace');
    assert.equal(h.accounting.accountedFor, h.accounting.uniqueInputs);

    assert.equal(h.billing.stats().successfulPaidEvents, 3);
    assert.ok(h.backend.calls.every((c) => c.eventName === 'product-detail'));

    for (const record of h.sink.records) {
        const result = validateRecord(record);
        assert.equal(result.valid, true, `invalid row: ${result.errors.join(', ')}`);
    }
});

test('a real product page produces a fully populated record', async () => {
    const h = harness();
    await run(h, { marketplace: 'US', asins: ['B0CX23V2ZK'], postalCode: '10001' }, new ScriptedFetcher());

    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.title, 'Example Brand Electric Kettle, 1.7L Stainless Steel');
    assert.equal(record.brand, 'Example Brand');
    assert.equal(record.pricing.currentPrice?.amount, 24.99);
    assert.equal(record.pricing.discountPercent, 16.67);
    assert.equal(record.availability.state, 'IN_STOCK');
    assert.equal(record.rankings.mainBSR, 14);
    assert.equal(record.ratings.rating, 4.6);
    assert.equal(record.buyBox.sellerId, 'A1EXAMPLE99');
    assert.equal(record.location.applied, true);
    assert.equal(record.location.resolvedPostalCode, '10001');
    // 5.5: a field Amazon genuinely does not show (this product is not a
    // variation parent) must not count against the score. Only extraction
    // failures do.
    assert.equal(record.quality.completenessScore, 100);
    assert.deepEqual(record.quality.criticalFieldsMissing, []);
    assert.equal(validateRecord(record).valid, true);
});

test('DE marketplace end to end keeps comma decimals intact (C5)', async () => {
    const h = harness();
    await run(
        h,
        { marketplace: 'DE', asins: ['B0DE12345K'] },
        new ScriptedFetcher({ productFixture: F.DE_STANDARD }),
    );
    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.pricing.currentPrice?.amount, 1234.56);
    assert.equal(record.pricing.currentPrice?.currency, 'EUR');
    assert.equal(record.rankings.mainBSR, 14);
    assert.equal(record.rankings.boughtInPastMonthMin, 2000, 'Tsd. is a thousand');
});

test('keyword discovery expands into product records with provenance', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    const outcome = await run(h, { marketplace: 'US', keywords: ['electric kettle'], maxSearchPages: 1 }, fetcher);

    h.accounting.assertInvariant();
    assert.equal(outcome.discovered, 3, 'three cards on the fixture search page');
    assert.equal(outcome.searchPagesFetched, 1);
    assert.equal(products(h).length, 3);

    const discovered = products(h)[0];
    assert.ok(discovered);
    assert.equal(discovered.discoveredFrom[0]?.type, 'keyword');
    assert.equal(discovered.discoveredFrom[0]?.value, 'electric kettle');
    assert.equal(typeof discovered.discoveredFrom[0]?.position, 'number');

    // The keyword itself is settled without emitting a row of its own.
    assert.equal(h.accounting.snapshot().success, 4, '3 products + the keyword');
    assert.equal(h.billing.stats().successfulPaidEvents, 3, 'only products are billable');
});

test('fast mode bills product-basic from listing data with no product fetch', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    await run(h, { mode: 'fast', marketplace: 'US', keywords: ['electric kettle'], maxSearchPages: 1 }, fetcher);

    assert.equal(fetcher.requests.filter((r) => r.label === 'PRODUCT').length, 0, 'fast mode never opens a product page');
    assert.equal(h.backend.calls.every((c) => c.eventName === 'product-basic'), true);

    const record = products(h).find((r) => r.asin === 'B0CX23V2ZK');
    assert.ok(record);
    assert.equal(record.pricing.currentPrice?.amount, 24.99);
    assert.equal(record.pricing.priceSource, 'SEARCH_CARD');
    assert.equal(record.ratings.reviewCount, 1820);
    assert.equal(record.rankings.status, 'NOT_APPLICABLE', 'a search card has no BSR to miss');
    assert.equal(record.buyBox.status, 'NOT_APPLICABLE');
    assert.ok(record.quality.warnings.includes('FROM_SEARCH_CARD'));
    assert.equal(record.retrieval.profile, 'essential');
    assert.equal(record.retrieval.billingEvent, 'product-basic');
    assert.deepEqual(record.discoveredFrom[0], {
        type: 'keyword',
        value: 'electric kettle',
        page: 1,
        position: 2,
        pagePosition: 2,
        sponsored: false,
        organicPosition: 1,
        sponsoredPosition: null,
    });
    assert.equal(validateRecord(record).valid, true);
});

test('concurrent discovery inputs merge provenance before durable product writes', async () => {
    const h = harness();
    await run(
        h,
        { marketplace: 'US', keywords: ['electric kettle', 'travel kettle'], maxSearchPages: 1 },
        new ScriptedFetcher(),
        8,
    );

    assert.equal(products(h).length, 3);
    assert.ok(products(h).every((record) => record.discoveredFrom.length === 2));
    assert.deepEqual(
        products(h)[0]?.discoveredFrom.map((source) => source.value).sort(),
        ['electric kettle', 'travel kettle'],
    );
});

test('essential profile emits only purchased blocks and bills product-essential', async () => {
    const h = harness();
    await run(h, { marketplace: 'US', asins: ['B0CX23V2ZK'], dataProfile: 'essential' }, new ScriptedFetcher());

    const record = products(h)[0];
    assert.ok(record);
    assert.deepEqual(record.retrieval.requestedBlocks, ['pricing', 'availability', 'ratings']);
    assert.equal(record.retrieval.billingEvent, 'product-essential');
    assert.equal(record.pricing.status, 'EXTRACTED');
    assert.equal(record.rankings.status, 'NOT_APPLICABLE');
    assert.equal(record.buyBox.status, 'NOT_APPLICABLE');
    assert.equal(record.product.status, 'NOT_APPLICABLE');
    assert.deepEqual(h.billing.stats().byEvent, { 'product-essential': 1 });
    assert.equal(validateRecord(record).valid, true);
});

test('fast mode direct ASIN uses the Essential event because it needs a detail fetch', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    await run(h, { mode: 'fast', marketplace: 'US', asins: ['B0CX23V2ZK'] }, fetcher);

    assert.equal(fetcher.requests.filter((request) => request.label === 'PRODUCT').length, 1);
    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.retrieval.billingEvent, 'product-essential');
    assert.deepEqual(h.billing.stats().byEvent, { 'product-essential': 1 });
});

test('discovery filters prevent unwanted detail fetches and report the count', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    const outcome = await run(h, {
        marketplace: 'US',
        keywords: ['electric kettle'],
        maxSearchPages: 1,
        discoveryFilters: { sponsoredPolicy: 'exclude' },
    }, fetcher);

    assert.equal(outcome.filteredOut, 1);
    assert.equal(outcome.discovered, 2);
    assert.equal(fetcher.requests.filter((request) => request.label === 'PRODUCT').length, 2);
});

test('keyword discovery reserves maxProducts before queueing detail work', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    const outcome = await run(
        h,
        { marketplace: 'US', keywords: ['electric kettle'], maxSearchPages: 1, maxProducts: 1 },
        fetcher,
        8,
    );

    assert.equal(outcome.discovered, 1);
    assert.equal(outcome.discoveryTruncated, true);
    assert.equal(fetcher.requests.filter((request) => request.label === 'PRODUCT').length, 1);
    assert.equal(products(h).length, 1);
});

test('fast mode enforces requireLocation before emitting listing prices', async () => {
    const h = harness();
    await run(
        h,
        { mode: 'fast', marketplace: 'US', keywords: ['electric kettle'], requireLocation: true },
        new ScriptedFetcher(),
    );
    assert.equal(products(h).length, 0);
    assert.equal(h.accounting.snapshot().requiresLocation, 1);
    assert.equal(h.billing.stats().successfulPaidEvents, 0);
});

test('a blocked search page yields one BLOCKED row for the keyword', async () => {
    const h = harness();
    await run(
        h,
        { marketplace: 'US', keywords: ['electric kettle'] },
        new ScriptedFetcher({ script: { 'electric kettle': BLOCKED } }),
    );
    h.accounting.assertInvariant();
    assert.equal(h.accounting.snapshot().blocked, 1);
    assert.equal(h.billing.stats().successfulPaidEvents, 0);
});

test('storefront URLs discover products through the listing parser', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    await run(h, { urls: ['https://www.amazon.com/stores/ExampleBrand/page/ABC123'], maxSearchPages: 1 }, fetcher);

    h.accounting.assertInvariant();
    assert.equal(fetcher.requests.filter((request) => request.label === 'SEARCH').length, 1);
    assert.equal(h.accounting.snapshot().invalidInput, 0);
    assert.equal(products(h).length, 3);
    assert.ok(products(h).every((record) => record.discoveredFrom[0]?.type === 'seller'));
});

test('seller profile URLs are converted to seller catalog discovery URLs', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    await run(h, { urls: ['https://www.amazon.com/sp?seller=A1EXAMPLE01'], maxSearchPages: 1 }, fetcher);

    const search = fetcher.requests.find((request) => request.label === 'SEARCH');
    assert.ok(search);
    const url = new URL(search.url);
    assert.equal(url.pathname, '/s');
    assert.equal(url.searchParams.get('me'), 'A1EXAMPLE01');
    assert.equal(products(h).length, 3);
});

test('intelligence mode emits bounded offers and public seller profiles with exact billing', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    await run(h, {
        marketplace: 'US',
        asins: ['B0CX23V2ZK'],
        mode: 'intelligence',
        includeOffers: true,
        includeSellerDetails: true,
        maxOffersPerProduct: 2,
    }, fetcher);

    h.accounting.assertInvariant();
    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.offers.items.length, 2);
    assert.equal(record.sellerProfiles.items.length, 2);
    assert.deepEqual(fetcher.requests.map((request) => request.label), ['PRODUCT', 'OFFERS', 'SELLER', 'SELLER']);
    assert.deepEqual(h.billing.stats().byEvent, {
        'product-detail': 1,
        offer: 2,
        'seller-detail': 2,
    });
    assert.equal(validateRecord(record).valid, true);
});

test('durable offer data is not lost when the cap stops ancillary billing', async () => {
    const h = harness(2);
    await run(h, {
        marketplace: 'US',
        asins: ['B0CX23V2ZK'],
        mode: 'intelligence',
        includeOffers: true,
        maxOffersPerProduct: 2,
    }, new ScriptedFetcher());

    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.offers.items.length, 2, 'the acknowledged dataset row remains complete');
    assert.equal(record.offers.truncated, false, 'billing state does not rewrite an already acknowledged value row');
    assert.deepEqual(h.billing.stats().byEvent, { 'product-detail': 1, offer: 1 });
    assert.equal(validateRecord(record).valid, true);
});

test('monitor mode compares prior state and bills every completed check', async () => {
    const initial = harness();
    await run(initial, { marketplace: 'US', asins: ['B0CX23V2ZK'] }, new ScriptedFetcher());
    const current = products(initial)[0];
    assert.ok(current);
    const previous = structuredClone(current) as unknown as Record<string, unknown>;
    const pricing = previous.pricing as Record<string, unknown>;
    pricing.currentPrice = { amount: 29.99, currency: 'USD', raw: '$29.99' };

    const h = harness();
    await run(
        h,
        { marketplace: 'US', asins: ['B0CX23V2ZK'], mode: 'monitor', compareWithDatasetId: 'prior-dataset' },
        new ScriptedFetcher(),
        4,
        new Map([['US|B0CX23V2ZK|default', previous]]),
    );

    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.monitoring.compared, true);
    assert.equal(record.monitoring.changed, true);
    const priceChange = record.monitoring.changes.find((change) => change.type === 'PRICE_CHANGED');
    assert.equal(priceChange?.percentChange, -16.67);
    assert.deepEqual(h.billing.stats().byEvent, { 'product-check': 1 });
    const outcome = await run(
        harness(),
        { marketplace: 'US', asins: ['B0CX23V2ZK'], mode: 'monitor', compareWithDatasetId: 'missing-prior' },
        new ScriptedFetcher(),
        4,
        new Map(),
    );
    assert.equal(outcome.monitoringChecked, 1);
    assert.equal(outcome.monitoringCompared, 0);
    assert.equal(outcome.monitoringChanged, 0);
});

test('variant discover mode costs zero extra requests (C13)', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher({ productFixture: F.US_VARIATION_PARENT });
    await run(h, { marketplace: 'US', asins: ['B0PARENT01'], variantMode: 'discover' }, fetcher);

    assert.equal(fetcher.requests.length, 1, 'one request for the parent, none for children');
    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.variants.items.length, 5);
    assert.deepEqual(record.variants.dimensions, ['Color', 'Size']);
    assert.equal(record.parentAsin, 'B0PARENT01');
    assert.equal(h.billing.stats().successfulPaidEvents, 1, 'discovery is included in the detail price');
});

test('variant price mode fetches each child and bills variant-detail', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher({
        script: { B0PARENT01: ok(F.US_VARIATION_PARENT, { finalUrl: 'https://www.amazon.com/dp/B0PARENT01' }) },
        productFixture: F.US_STANDARD,
    });
    await run(h, { marketplace: 'US', asins: ['B0PARENT01'], variantMode: 'price', maxVariants: 3 }, fetcher);

    assert.equal(fetcher.requests.filter((r) => r.label === 'VARIANT').length, 3, 'bounded by maxVariants');
    const record = products(h)[0];
    assert.ok(record);
    assert.equal(record.variants.items.length, 3);
    assert.equal(record.variants.items[0]?.price?.amount, 24.99);
    assert.equal(record.variants.items[0]?.availability, 'IN_STOCK');
    assert.equal(record.variants.truncated, true);

    const byEvent = h.billing.stats().byEvent;
    assert.equal(byEvent['product-detail'], 1);
    assert.equal(byEvent['variant-detail'], 3, 'children are charged separately, on success only');
});

test('variant full mode promotes children to their own records', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher({
        script: { B0PARENT01: ok(F.US_VARIATION_PARENT, { finalUrl: 'https://www.amazon.com/dp/B0PARENT01' }) },
    });
    await run(h, { marketplace: 'US', asins: ['B0PARENT01'], variantMode: 'full', maxVariants: 2 }, fetcher);

    h.accounting.assertInvariant();
    assert.equal(fetcher.requests.length, 2, 'the already-loaded canonical child is reused instead of fetched twice');

    // Amazon serves a variation parent as its default child, so this page's
    // canonical ASIN is B0CHILD001 -- the same product as the first promoted
    // child. Dedupe on marketplace+ASIN+location (C3) correctly merges them
    // into one record, which also stops the customer being billed twice for
    // the same product.
    assert.equal(products(h).length, 2);
    assert.equal(h.billing.stats().byEvent['product-detail'], 2, 'the merged duplicate is not charged');
    assert.equal(h.accounting.merged, 1);
    assert.equal(h.accounting.snapshot().success, 2, 'the already-loaded canonical child is merged before queueing');

    const merged = products(h).find((r) => r.asin === 'B0CHILD001');
    assert.equal(merged?.discoveredFrom.length, 2, 'both provenances are preserved on the surviving record');
});

test('maxProducts stops the run and flushes the remainder as RUN_ABORTED', async () => {
    const h = harness();
    const outcome = await run(
        h,
        { marketplace: 'US', asins: ['B0GOOD0001', 'B0GOOD0002', 'B0GOOD0003', 'B0GOOD0004'], maxProducts: 2 },
        new ScriptedFetcher(),
        1,
    );

    h.accounting.assertInvariant();
    assert.equal(outcome.abortReason, 'MAX_PRODUCTS_REACHED');
    const counts = h.accounting.snapshot();
    assert.equal(counts.success, 2);
    assert.equal(counts.runAborted, 2, 'the remainder appears, it does not vanish');
    assert.equal(h.accounting.accountedFor, 4);
});

test('maxProducts is a hard ceiling even when concurrency is higher', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    const outcome = await run(
        h,
        {
            marketplace: 'US',
            asins: ['B0A0000001', 'B0A0000002', 'B0A0000003', 'B0A0000004'],
            maxProducts: 1,
        },
        fetcher,
        8,
    );

    h.accounting.assertInvariant();
    assert.equal(outcome.processed, 1);
    assert.equal(fetcher.requests.filter((request) => request.label === 'PRODUCT').length, 1);
    assert.equal(h.accounting.snapshot().success, 1);
    assert.equal(h.accounting.snapshot().runAborted, 3);
});

test('the charge cap winds the run down and the summary still balances (C8)', async () => {
    const h = harness(2);
    const fetcher = new ScriptedFetcher();
    const outcome = await run(h, { marketplace: 'US', asins: ['B0GOOD0001', 'B0GOOD0002', 'B0GOOD0003', 'B0GOOD0004'] }, fetcher, 1);

    assert.equal(h.billing.isCapReached(), true);
    assert.equal(outcome.abortReason, 'CHARGE_CAP_REACHED');

    const summary = buildRunSummary({
        accounting: h.accounting,
        runStartedAt: '2026-09-04T11:20:00Z',
        marketplaces: ['US'],
        mode: 'detail',
        filteredOut: 0,
        discoveredProducts: outcome.discovered,
        searchPagesFetched: outcome.searchPagesFetched,
        discoveryTruncated: outcome.discoveryTruncated,
        monitoringChecked: outcome.monitoringChecked,
        monitoringCompared: outcome.monitoringCompared,
        monitoringChanged: outcome.monitoringChanged,
        peakConcurrency: outcome.peakConcurrency,
        fetchStats: fetcher.stats(),
        billing: h.billing.stats(),
        chargeCapReached: true,
        warnings: [],
    });

    assert.equal(summary.accountingInvariantHolds, true);
    assert.equal(summary.accountedFor, summary.uniqueInputs);
    assert.equal(summary.success + summary.runAborted, 4);
    assert.equal(summary.successfulPaidEvents, 2, 'nothing is charged past the cap');
    assert.equal(validateRecord(h.sink.records.at(-1)).valid, true);
});

test('concurrent workers cannot emit products that lost the charge-cap race', async () => {
    const h = harness(1);
    const outcome = await run(
        h,
        { marketplace: 'US', asins: ['B0GOOD0001', 'B0GOOD0002', 'B0GOOD0003', 'B0GOOD0004'] },
        new ScriptedFetcher(),
        4,
    );

    h.accounting.assertInvariant();
    assert.equal(outcome.abortReason, 'CHARGE_CAP_REACHED');
    assert.equal(products(h).length, 1, 'only the charged product may be emitted as value');
    assert.equal(h.accounting.snapshot().success, 1);
    assert.equal(h.accounting.snapshot().runAborted, 3);
    assert.equal(h.billing.stats().successfulPaidEvents, 1);
    assert.equal(
        h.sink.records.filter((record) => record.status === 'RUN_ABORTED').length,
        3,
        'every uncharged in-flight product becomes an explicit failure row',
    );
});

test('variant price data stays durable when the cap stops ancillary billing', async () => {
    const h = harness(2);
    const fetcher = new ScriptedFetcher({
        script: { B0PARENT01: ok(F.US_VARIATION_PARENT, { finalUrl: 'https://www.amazon.com/dp/B0PARENT01' }) },
        productFixture: F.US_STANDARD,
    });
    await run(h, { marketplace: 'US', asins: ['B0PARENT01'], variantMode: 'price', maxVariants: 3 }, fetcher);

    const record = products(h)[0];
    assert.ok(record);
    assert.equal(h.billing.stats().byEvent['product-detail'], 1);
    assert.equal(h.billing.stats().byEvent['variant-detail'], 1);
    assert.equal(record.variants.items[0]?.price?.amount, 24.99);
    assert.equal(record.variants.items[1]?.price?.amount, 24.99);
    assert.equal(record.variants.items[1]?.status, 'EXTRACTED');
    assert.equal(record.variants.items[2]?.price?.amount, 24.99);
});

test('the circuit breaker trips on a block storm and still accounts for everything (9.5)', async () => {
    const h = harness();
    let calls = 0;
    const fetcher = new ScriptedFetcher({
        health: () => (calls++ > 1 ? 'ABORT' : 'HEALTHY'),
    });
    const outcome = await run(h, { marketplace: 'US', asins: ['B0A0000001', 'B0A0000002', 'B0A0000003', 'B0A0000004'] }, fetcher, 1);

    h.accounting.assertInvariant();
    assert.equal(outcome.abortReason, 'CIRCUIT_BREAKER_TRIPPED');
    assert.ok(h.accounting.snapshot().runAborted > 0);
    assert.equal(h.accounting.accountedFor, 4);
});

test('degraded health halves concurrency instead of stopping', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher({ health: 'DEGRADED' });
    const outcome = await run(
        h,
        { marketplace: 'US', asins: ['B0A0000001', 'B0A0000002', 'B0A0000003', 'B0A0000004'] },
        fetcher,
        8,
    );
    h.accounting.assertInvariant();
    assert.equal(h.accounting.snapshot().success, 4, 'degraded still completes the work');
    assert.ok(outcome.peakConcurrency <= 4, `expected <= 4 concurrent, saw ${outcome.peakConcurrency}`);
});

test('requireLocation refuses to pass an unlocated price off as a success', async () => {
    const h = harness();
    await run(h, { marketplace: 'US', asins: ['B0GOOD0001'], requireLocation: true }, new ScriptedFetcher());
    assert.equal(h.accounting.snapshot().requiresLocation, 1);
    assert.equal(h.billing.stats().successfulPaidEvents, 0, 'an unlocated price is not a billable success');
});

test('duplicate inputs are merged, not emitted twice', async () => {
    const h = harness();
    await run(
        h,
        { marketplace: 'US', asins: ['B0GOOD0001'], urls: ['https://www.amazon.com/dp/B0GOOD0001'] },
        new ScriptedFetcher(),
    );
    h.accounting.assertInvariant();
    assert.equal(h.sink.records.length, 1, 'the same ASIN at the same location is one record');
    assert.equal(h.accounting.uniqueInputs, 1);
});

test('deduplicate false preserves repeated requested products', async () => {
    const h = harness();
    const fetcher = new ScriptedFetcher();
    await run(
        h,
        { marketplace: 'US', asins: ['B0GOOD0001', 'B0GOOD0001'], deduplicate: false },
        fetcher,
    );

    assert.equal(fetcher.requests.length, 2);
    assert.equal(products(h).length, 2);
    assert.equal(h.accounting.merged, 0);
});

test('dedupe preserves direct ASIN and URL provenance on one row', async () => {
    const h = harness();
    await run(
        h,
        {
            marketplace: 'US',
            asins: ['B0GOOD0001'],
            urls: ['https://www.amazon.com/dp/B0GOOD0001'],
        },
        new ScriptedFetcher(),
    );

    const record = products(h)[0];
    assert.ok(record);
    assert.equal(products(h).length, 1);
    assert.deepEqual(record.discoveredFrom.map((source) => source.type).sort(), ['asin', 'url']);
    assert.equal(h.accounting.merged, 1);
});

test('a challenge page served as HTTP 200 becomes PARSER_ERROR, never a null-filled success', async () => {
    const h = harness();
    await run(
        h,
        { marketplace: 'US', asins: ['B0GOOD0001'] },
        new ScriptedFetcher({ script: { B0GOOD0001: ok(F.CHALLENGE_PAGE) } }),
    );
    h.accounting.assertInvariant();
    assert.equal(h.accounting.snapshot().parserError, 1);
    assert.equal(h.billing.stats().successfulPaidEvents, 0);
});

test('a worker throwing still settles its input', async () => {
    const h = harness();
    const exploding = new ScriptedFetcher();
    exploding.fetch = async () => {
        throw new Error('socket exploded');
    };
    await run(h, { marketplace: 'US', asins: ['B0GOOD0001', 'B0GOOD0002'] }, exploding, 2);

    h.accounting.assertInvariant();
    assert.equal(h.accounting.snapshot().fetchFailed, 2, 'an unexpected throw cannot lose an input');
});

test('a search page that parses but yields no cards is not a successful keyword', async () => {
    // Regression: a stub listing page settled the keyword as SUCCESS, silently
    // reporting "no products" for what was actually a blocked response.
    const h = harness();
    await run(
        h,
        { marketplace: 'US', keywords: ['electric kettle'] },
        new ScriptedFetcher({ searchFixture: F.US_SEARCH_NO_RESULTS }),
    );
    h.accounting.assertInvariant();
    assert.equal(h.accounting.snapshot().success, 0);
    assert.equal(h.accounting.snapshot().fetchFailed, 1);
    const row = h.sink.records[0];
    assert.equal(row?.status, 'FETCH_FAILED');
    assert.equal((row as { reason?: string }).reason, 'EMPTY_TEMPLATE');
});
