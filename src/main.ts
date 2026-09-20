/**
 * Actor entrypoint. Spec v1.1 sections 3, 8.2, 9.3, 10.3.
 *
 * Responsibilities, in order: read and validate input, wire the fetch, billing
 * and output seams, run the pipeline, assert the accounting invariant, write
 * the summary. No scraping logic lives here.
 */

import { Actor, log } from 'apify';
import { ApifyChargingBackend } from './billing/apify-backend.js';
import { BillingEvents, NoopChargingBackend } from './billing/events.js';
import { FETCHER_DEFAULTS, HttpFetcher } from './fetch/http-fetcher.js';
import { extractDatasetInputs } from './input/dataset-ingest.js';
import { InputError, validateInput } from './input/validate.js';
import { RunAccounting } from './output/accounting.js';
import { DatasetWriter, type DatasetSink } from './output/dataset-writer.js';
import { buildRunSummary } from './output/summary.js';
import { runPipeline } from './pipeline/run.js';
import type { RawActorInput } from './types/input.js';
import type { DatasetRecord } from './types/output.js';

await Actor.init();

const runStartedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const raw = (await Actor.getInput<RawActorInput>()) ?? {};

let validated;
try {
    validated = validateInput(raw);

    if (validated.input.datasetId !== null) {
        const datasetId = validated.input.datasetId;
        const dataset = await Actor.openDataset<Record<string, unknown>>({ id: datasetId });
        const rows: Record<string, unknown>[] = [];
        await dataset.forEach(
            (item) => {
                rows.push(item);
            },
            { limit: validated.input.maxProducts },
        );

        const extracted = extractDatasetInputs(rows, validated.input.datasetField, datasetId);
        const originalRejected = validated.rejected;
        const originalWarnings = validated.warnings;
        const info = await dataset.getInfo();

        validated = validateInput({
            ...raw,
            asins: [...validated.input.asins, ...extracted.asins],
            urls: [...validated.input.urls, ...extracted.urls],
            keywords: validated.input.keywords,
        });
        validated.rejected.unshift(...originalRejected, ...extracted.rejected);
        validated.warnings = [...new Set([...originalWarnings, ...validated.warnings])];

        if ((info?.itemCount ?? rows.length) > rows.length) {
            validated.warnings.push(
                `dataset ${datasetId} has ${info?.itemCount} rows; only the first ${rows.length} were accepted because maxProducts is ${validated.input.maxProducts}`,
            );
        }
    }
} catch (err) {
    if (err instanceof InputError) {
        // A structurally unusable input object is the one case with nothing to
        // account for, so fail loudly rather than emitting an empty dataset.
        log.error(`invalid input: ${err.message}`);
        await Actor.fail(`Invalid input: ${err.message}`);
        process.exit(1);
    }
    throw err;
}

for (const warning of validated.warnings) log.warning(warning);

const { input } = validated;
log.info('run configuration', {
    mode: input.mode,
    marketplace: input.marketplace,
    asins: input.asins.length,
    urls: input.urls.length,
    keywords: input.keywords.length,
    variantMode: input.variantMode,
    postalCode: input.postalCode,
    requireLocation: input.requireLocation,
    maxProducts: input.maxProducts,
    allowResidentialFallback: input.allowResidentialFallback,
});

// Pay-per-event runs set this; local and unmonetized runs do not.
const isPaid = Actor.getChargingManager().getPricingInfo().isPayPerEvent;
const billing = new BillingEvents(
    isPaid ? new ApifyChargingBackend() : new NoopChargingBackend(),
    (msg, data) => log.info(`[billing] ${msg}`, data as Record<string, unknown>),
);
if (!isPaid) log.info('no charging configured for this run; billing events are recorded but not charged');

/**
 * External proxy URLs are billed to the customer's own provider, which is how a
 * high-volume run stays off the developer's platform bill (spec 8.3).
 */
const externalProxyUrls = input.proxyConfiguration?.proxyUrls ?? [];
const useApifyProxy = externalProxyUrls.length === 0 && input.proxyConfiguration?.useApifyProxy !== false;
const requestedProxyGroups = input.proxyConfiguration?.apifyProxyGroups ?? [];
const proxyConfiguration = useApifyProxy
    ? ((await Actor.createProxyConfiguration({
          groups: requestedProxyGroups,
          countryCode: input.proxyConfiguration?.apifyProxyCountry,
      })) ?? null)
    : null;
const primaryUsesResidential = requestedProxyGroups.some((group) => group.toUpperCase() === 'RESIDENTIAL');
let residentialProxyConfiguration = null;
if (useApifyProxy && input.allowResidentialFallback && !primaryUsesResidential) {
    try {
        residentialProxyConfiguration = (await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
            countryCode: input.proxyConfiguration?.apifyProxyCountry,
        })) ?? null;
    } catch (err) {
        log.warning('residential fallback is unavailable for this account; continuing with the primary proxy tier', {
            error: (err as Error).message,
        });
    }
}

if (externalProxyUrls.length > 0) {
    log.info(`using ${externalProxyUrls.length} user-supplied proxy URL(s); this traffic is billed by your provider`);
} else if (proxyConfiguration === null) {
    log.warning('no proxy configured: Amazon blocks datacenter-free traffic quickly and most inputs will return BLOCKED');
}

const fetcher = new HttpFetcher({
    maxRetries: input.maxRetries,
    allowResidentialFallback: input.allowResidentialFallback,
    residentialBudgetRatio: FETCHER_DEFAULTS.residentialBudgetRatio,
    proxyConfiguration,
    residentialProxyConfiguration,
    primaryProxyTier: externalProxyUrls.length > 0
        ? 'EXTERNAL'
        : proxyConfiguration === null
            ? 'NONE'
            : primaryUsesResidential
                ? 'RESIDENTIAL'
                : 'DATACENTER',
    externalProxyUrls,
    requestTimeoutSecs: FETCHER_DEFAULTS.requestTimeoutSecs,
    log: (msg, data) => log.info(`[fetch] ${msg}`, data),
});
await fetcher.init();

const sink: DatasetSink = {
    async pushData(record: DatasetRecord): Promise<void> {
        await Actor.pushData(record);
    },
};

const accounting = new RunAccounting();
const writer = new DatasetWriter(sink, input.deduplicate, (msg, data) =>
    log.warning(`[output] ${msg}`, data as Record<string, unknown>),
);

let outcome;
try {
    outcome = await runPipeline({
        validated,
        fetcher,
        writer,
        billing,
        accounting,
        log: (msg, data) => log.info(msg, data),
    });
} finally {
    await fetcher.teardown();
}

const summary = buildRunSummary({
    accounting,
    runStartedAt,
    marketplaces: [input.marketplace],
    mode: input.mode,
    filteredOut: 0,
    discoveredProducts: outcome.discovered,
    searchPagesFetched: outcome.searchPagesFetched,
    discoveryTruncated: outcome.discoveryTruncated,
    peakConcurrency: outcome.peakConcurrency,
    fetchStats: fetcher.stats(),
    billing: billing.stats(),
    chargeCapReached: billing.isCapReached(),
    warnings: validated.warnings,
});

await Actor.setValue('RUN_SUMMARY', summary);
log.info('run summary', {
    requested: summary.requested,
    uniqueInputs: summary.uniqueInputs,
    success: summary.success,
    discovered: summary.discoveredProducts,
    blocked: summary.blocked,
    accountedFor: summary.accountedFor,
    accountingInvariantHolds: summary.accountingInvariantHolds,
    blockRateProductPages: summary.blockRateProductPages,
    aborted: outcome.aborted,
    abortReason: outcome.abortReason,
    paidEvents: summary.successfulPaidEvents,
});

const dqStats = writer.stats();
if (dqStats.schemaViolations > 0) {
    log.warning(`${dqStats.schemaViolations} value record(s) failed golden schema validation and were replaced by structured failures`);
}

await Actor.exit();
