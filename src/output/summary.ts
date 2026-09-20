/**
 * Spec v1.1 Appendix B. The run summary.
 *
 * assertInvariant() is called before this object is built, so a summary can
 * never claim an accounting rate the run did not achieve (C9).
 */

import type { MarketplaceCode, RunSummary } from '../types/output.js';
import { SCHEMA_VERSION } from '../types/output.js';
import { PARSER_VERSION } from './record-builder.js';
import type { RunAccounting } from './accounting.js';

export interface SummaryInputs {
    accounting: RunAccounting;
    runStartedAt: string;
    marketplaces: MarketplaceCode[];
    mode: string;
    filteredOut: number;
    discoveredProducts: number;
    searchPagesFetched: number;
    discoveryTruncated: boolean;
    peakConcurrency: number;
    fetchStats: {
        blockedProductPages: number;
        productPageRequests: number;
        blockedSearchPages: number;
        searchPageRequests: number;
        residentialEscalations: number;
        primingRequests: number;
    };
    billing: { successfulPaidEvents: number; failedPaidEvents: number };
    chargeCapReached: boolean;
    warnings: string[];
}

function rate(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function buildRunSummary(args: SummaryInputs): RunSummary {
    args.accounting.assertInvariant();
    const counts = args.accounting.snapshot();

    return {
        schemaVersion: SCHEMA_VERSION,
        runStartedAt: args.runStartedAt,
        runFinishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        marketplaces: args.marketplaces,
        mode: args.mode,
        requested: args.accounting.requested,
        uniqueInputs: args.accounting.uniqueInputs,
        success: counts.success,
        productNotFound: counts.productNotFound,
        blocked: counts.blocked,
        fetchFailed: counts.fetchFailed,
        parserError: counts.parserError,
        geoRestricted: counts.geoRestricted,
        invalidInput: counts.invalidInput,
        requiresLocation: counts.requiresLocation,
        runAborted: counts.runAborted,
        accountedFor: args.accounting.accountedFor,
        accountingInvariantHolds: args.accounting.holds(),
        duplicatesMerged: args.accounting.merged,
        filteredOut: args.filteredOut,
        discoveredProducts: args.discoveredProducts,
        searchPagesFetched: args.searchPagesFetched,
        discoveryTruncated: args.discoveryTruncated,
        peakConcurrency: args.peakConcurrency,
        primingRequests: args.fetchStats.primingRequests,
        blockRateProductPages: rate(args.fetchStats.blockedProductPages, args.fetchStats.productPageRequests),
        blockRateSearchPages: rate(args.fetchStats.blockedSearchPages, args.fetchStats.searchPageRequests),
        residentialEscalations: args.fetchStats.residentialEscalations,
        successfulPaidEvents: args.billing.successfulPaidEvents,
        failedPaidEvents: args.billing.failedPaidEvents,
        chargeCapReached: args.chargeCapReached,
        warnings: args.warnings,
        parserVersion: PARSER_VERSION,
    };
}
