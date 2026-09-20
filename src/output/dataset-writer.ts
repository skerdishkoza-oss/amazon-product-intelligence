/**
 * Spec v1.1 sections 5.1, 5.4.
 *
 * Successes and failure rows go to the same default dataset so a single export
 * accounts for every input. That is only safe because the synthetic
 * per-dataset-item billing event is disabled (C7) -- see billing/events.ts.
 *
 * Dedupe happens here on marketplace + ASIN + resolved location (C3), and a
 * duplicate merges its discovery source into the record already held rather
 * than being emitted twice.
 */

import { dedupeKey } from '../input/normalizer.js';
import type { DatasetRecord, DiscoverySource, ProductRecord } from '../types/output.js';
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
    private readonly seen = new Map<string, ProductRecord>();
    private readonly bufferedProducts: ProductRecord[] = [];
    private flushedProducts = 0;
    private duplicates = 0;
    private schemaViolations = 0;

    constructor(
        private readonly sink: DatasetSink,
        private readonly deduplicate: boolean,
        private readonly log: (msg: string, data?: unknown) => void = () => {},
    ) {}

    /**
     * Returns false when the record was merged into an existing one as a
     * duplicate, so the caller can count it correctly.
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
                const existing = this.seen.get(key);
                if (existing) {
                    this.mergeDiscovery(existing, record.discoveredFrom);
                    this.duplicates += 1;
                    return false;
                }
                this.seen.set(key, record);
            }
            // Datasets are append-only. Buffer every product until the
            // pipeline finishes. Besides preserving merged provenance, this
            // lets the pipeline discard a value row when a concurrent PPE
            // charge loses the race to the user's spending cap.
            this.bufferedProducts.push(record);
            return true;
        }

        await this.sink.pushData(record);
        return true;
    }

    /** Remove a staged product that was not successfully charged. */
    discard(record: ProductRecord): boolean {
        const index = this.bufferedProducts.indexOf(record, this.flushedProducts);
        if (index < 0) return false;
        this.bufferedProducts.splice(index, 1);
        if (this.deduplicate) {
            const key = dedupeKey(record.marketplace, record.asin, record.location.resolvedPostalCode);
            if (this.seen.get(key) === record) this.seen.delete(key);
        }
        return true;
    }

    async flush(): Promise<void> {
        while (this.flushedProducts < this.bufferedProducts.length) {
            const record = this.bufferedProducts[this.flushedProducts];
            if (record === undefined) break;
            await this.sink.pushData(record);
            this.flushedProducts += 1;
        }
    }

    private mergeDiscovery(target: ProductRecord, sources: DiscoverySource[]): void {
        for (const source of sources) {
            const already = target.discoveredFrom.some(
                (s) => s.type === source.type && s.value === source.value && s.page === source.page,
            );
            if (!already) target.discoveredFrom.push(source);
        }
    }

    stats(): { duplicatesMerged: number; schemaViolations: number } {
        return { duplicatesMerged: this.duplicates, schemaViolations: this.schemaViolations };
    }
}
