/**
 * Convert a bounded slice of an Apify Dataset into normal ASIN/URL inputs.
 * The platform adapter lives in main.ts; this module stays pure and testable.
 */

import { FAILURE_REASON } from '../types/status.js';
import { normalizeAsin } from './normalizer.js';
import type { RejectedItem } from './validate.js';

export interface DatasetExtraction {
    asins: string[];
    urls: string[];
    rejected: RejectedItem[];
}

function valuesAt(row: Record<string, unknown>, field: string): unknown[] {
    const value = row[field];
    return Array.isArray(value) ? value : [value];
}

export function extractDatasetInputs(
    rows: Record<string, unknown>[],
    field: string,
    datasetId: string,
): DatasetExtraction {
    const result: DatasetExtraction = { asins: [], urls: [], rejected: [] };

    rows.forEach((row, rowIndex) => {
        const values = valuesAt(row, field);
        let valuesSeen = 0;

        for (const raw of values) {
            if (typeof raw !== 'string' || raw.trim() === '') continue;
            valuesSeen += 1;
            const value = raw.trim();
            if (/^https?:\/\//i.test(value)) {
                result.urls.push(value);
                continue;
            }
            const asin = normalizeAsin(value);
            if (asin !== null) {
                result.asins.push(asin);
                continue;
            }
            result.rejected.push({
                type: 'dataset',
                value: `${datasetId}#${rowIndex}:${field}`,
                reason: FAILURE_REASON.ASIN_MALFORMED,
            });
        }

        if (valuesSeen === 0) {
            result.rejected.push({
                type: 'dataset',
                value: `${datasetId}#${rowIndex}:${field}`,
                reason: FAILURE_REASON.DATASET_FIELD_MISSING,
            });
        }
    });

    if (rows.length === 0) {
        result.rejected.push({
            type: 'dataset',
            value: datasetId,
            reason: FAILURE_REASON.DATASET_EMPTY,
        });
    }

    return result;
}
