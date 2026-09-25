/**
 * Spec v1.1 sections 5.1, 5.4.
 *
 * Successes and failure rows go to the same default dataset so a single export
 * accounts for every input. That is only safe because the synthetic
 * per-dataset-item billing event is disabled (C7) -- see billing/events.ts.
 *
 * Dedupe happens here on marketplace + ASIN + resolved location (C3). A
 * product is appended as soon as it passes validation and dedupe so callers
 * can safely charge only after `write()` resolves. Keeping successful rows in
 * memory until the end of a run risks charging for results that are lost if
 * the process exits before the final flush.
 */

import { dedupeKey } from '../input/normalizer.js';
import type { DatasetRecord } from '../types/output.js';
import { isProductRecord } from '../types/output.js';
import { validateRecord } from '../quality/validation.js';

export interface DatasetSink {
    pushData(record: DatasetRecord): Promise<void>;
}

export class DatasetSchemaError extends Error {
    constructor(readonly errors: string[]) {
        super(`record failed golden schema validation: ${errors.slice(0, 5).join('; ')}`);
        this.name = 'DatasetSchemaError';
    }
}

/** In-memory sink for tests and dry runs. */
export class MemorySink implements DatasetSink {
    readonly records: DatasetRecord[] = [];

    async pushData(record: DatasetRecord): Promise<void> {
        this.records.push(record);
    }
}

export class DatasetWriter {
    private readonly seen = new Set<string>();
    private duplicates = 0;
    private schemaViolations = 0;

    constructor(
        private readonly sink: DatasetSink,
        private readonly deduplicate: boolean,
        private readonly log: (msg: string, data?: unknown) => void = () => {},
    ) {}

    /**
     * Resolves only after the sink has acknowledged the append. Returns false
     * for a duplicate product, so callers can avoid charging twice.
     */
    async write(record: DatasetRecord): Promise<boolean> {
        const check = validateRecord(record);
        if (!check.valid) {
            this.schemaViolations += 1;
            this.log('record failed golden schema validation', { errors: check.errors.slice(0, 5) });
            // The spec calls this a release gate. Never publish a malformed
            // value row: the pipeline converts this exception into a
            // structured, non-billable PARSER_ERROR result.
            throw new DatasetSchemaError(check.errors);
        }

        if (isProductRecord(record)) {
            if (this.deduplicate) {
                const key = dedupeKey(record.marketplace, record.asin, record.location.resolvedPostalCode);
                if (this.seen.has(key)) {
                    this.duplicates += 1;
                    return false;
                }
                // Reserve the key before awaiting the sink so concurrent
                // writes cannot both append the same product.
                this.seen.add(key);
                try {
                    await this.sink.pushData(record);
                } catch (error) {
                    // The append did not complete, so a retry must remain
                    // possible and must not be treated as a duplicate.
                    this.seen.delete(key);
                    throw error;
                }
                return true;
            }

            await this.sink.pushData(record);
            return true;
        }

        await this.sink.pushData(record);
        return true;
    }

    stats(): { duplicatesMerged: number; schemaViolations: number } {
        return { duplicatesMerged: this.duplicates, schemaViolations: this.schemaViolations };
    }
}
