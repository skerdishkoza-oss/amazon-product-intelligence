/**
 * Spec v1.1 section 10.3 (C9).
 *
 * The invariant: uniqueInputs === success + every failure category, including
 * RUN_ABORTED. It is asserted in code before the summary is written, and a
 * violation is a run-level error, not a warning.
 *
 * This holds on every exit path: ceilings reached, charge cap reached, block
 * storm circuit breaker, platform abort signal. Any input accepted but never
 * processed is emitted as RUN_ABORTED with a reason.
 */

import { RECORD_STATUS, type RecordStatus } from '../types/status.js';

export class AccountingViolationError extends Error {
    constructor(
        message: string,
        readonly detail: { uniqueInputs: number; accountedFor: number; unaccounted: string[] },
    ) {
        super(message);
        this.name = 'AccountingViolationError';
    }
}

export interface AccountingCounts {
    success: number;
    productNotFound: number;
    blocked: number;
    fetchFailed: number;
    parserError: number;
    geoRestricted: number;
    invalidInput: number;
    requiresLocation: number;
    runAborted: number;
}

const ZERO: AccountingCounts = {
    success: 0,
    productNotFound: 0,
    blocked: 0,
    fetchFailed: 0,
    parserError: 0,
    geoRestricted: 0,
    invalidInput: 0,
    requiresLocation: 0,
    runAborted: 0,
};

const COUNTER_BY_STATUS: Record<RecordStatus, keyof AccountingCounts> = {
    [RECORD_STATUS.SUCCESS]: 'success',
    [RECORD_STATUS.PRODUCT_NOT_FOUND]: 'productNotFound',
    [RECORD_STATUS.BLOCKED]: 'blocked',
    [RECORD_STATUS.FETCH_FAILED]: 'fetchFailed',
    [RECORD_STATUS.PARSER_ERROR]: 'parserError',
    [RECORD_STATUS.GEO_RESTRICTED]: 'geoRestricted',
    [RECORD_STATUS.INVALID_INPUT]: 'invalidInput',
    [RECORD_STATUS.REQUIRES_LOCATION]: 'requiresLocation',
    [RECORD_STATUS.RUN_ABORTED]: 'runAborted',
};

/**
 * Tracks every accepted input by key and refuses to let one disappear.
 *
 * `register` is called once per unique input at planning time. `settle` is
 * called exactly once per input with its final record status. `pending()` is
 * what the abort path flushes as RUN_ABORTED.
 */
export class RunAccounting {
    private readonly pendingKeys = new Set<string>();
    private readonly settledKeys = new Set<string>();
    private counts: AccountingCounts = { ...ZERO };
    private requestedCount = 0;
    private duplicatesMerged = 0;

    /** Total items the user supplied, before dedupe. */
    registerRequested(n: number): void {
        this.requestedCount += n;
    }

    /** Register a unique input that the run has committed to accounting for. */
    register(key: string): void {
        if (this.settledKeys.has(key)) {
            throw new AccountingViolationError(`input ${key} registered after it was already settled`, {
                uniqueInputs: this.uniqueInputs,
                accountedFor: this.accountedFor,
                unaccounted: [],
            });
        }
        this.pendingKeys.add(key);
    }

    /** A duplicate that was merged into an existing record rather than emitted. */
    registerDuplicate(): void {
        this.duplicatesMerged += 1;
    }

    settle(key: string, status: RecordStatus): void {
        if (this.settledKeys.has(key)) {
            throw new AccountingViolationError(`input ${key} settled twice (second status ${status})`, {
                uniqueInputs: this.uniqueInputs,
                accountedFor: this.accountedFor,
                unaccounted: [],
            });
        }
        if (!this.pendingKeys.has(key)) {
            // Settling something never registered is just as wrong as losing one.
            throw new AccountingViolationError(`input ${key} settled without being registered`, {
                uniqueInputs: this.uniqueInputs,
                accountedFor: this.accountedFor,
                unaccounted: [],
            });
        }
        this.pendingKeys.delete(key);
        this.settledKeys.add(key);
        this.counts[COUNTER_BY_STATUS[status]] += 1;
    }

    /** Has this key been registered (pending or settled) in this run? */
    isKnown(key: string): boolean {
        return this.pendingKeys.has(key) || this.settledKeys.has(key);
    }

    /** Inputs registered but not yet settled. The abort path flushes these. */
    pending(): string[] {
        return [...this.pendingKeys];
    }

    get uniqueInputs(): number {
        return this.pendingKeys.size + this.settledKeys.size;
    }

    get accountedFor(): number {
        return Object.values(this.counts).reduce((a, b) => a + b, 0);
    }

    get requested(): number {
        return this.requestedCount;
    }

    get merged(): number {
        return this.duplicatesMerged;
    }

    snapshot(): AccountingCounts {
        return { ...this.counts };
    }

    holds(): boolean {
        return this.pendingKeys.size === 0 && this.accountedFor === this.settledKeys.size;
    }

    /**
     * Call immediately before writing the run summary. Throws rather than
     * emitting a summary that overstates what the run accounted for.
     */
    assertInvariant(): void {
        if (this.holds()) return;
        throw new AccountingViolationError(
            `accounting invariant violated: ${this.uniqueInputs} unique inputs but ${this.accountedFor} accounted for`,
            {
                uniqueInputs: this.uniqueInputs,
                accountedFor: this.accountedFor,
                unaccounted: this.pending().slice(0, 50),
            },
        );
    }
}
