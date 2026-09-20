/**
 * Spec v1.1 section 5.5.
 *
 * completenessScore is computed against a fixed, documented critical-field list
 * per mode, not against every field in the schema. If it were computed over the
 * whole schema, adding optional fields in a later release would silently lower
 * every score and make releases incomparable.
 */

import type { ProductRecord } from '../types/output.js';
import { FIELD_STATUS } from '../types/status.js';

export type CriticalField = 'title' | 'asin' | 'canonicalUrl' | 'price' | 'availability' | 'bsr' | 'ratings' | 'buyBox' | 'variants';

/** Weights sum to 100 per mode. Documented in the README so scores are auditable. */
export const CRITICAL_FIELDS: Record<'fast' | 'detail' | 'intelligence', Array<{ field: CriticalField; weight: number }>> = {
    fast: [
        { field: 'asin', weight: 25 },
        { field: 'title', weight: 25 },
        { field: 'canonicalUrl', weight: 10 },
        { field: 'price', weight: 25 },
        { field: 'ratings', weight: 15 },
    ],
    detail: [
        { field: 'asin', weight: 10 },
        { field: 'title', weight: 15 },
        { field: 'canonicalUrl', weight: 5 },
        { field: 'price', weight: 25 },
        { field: 'availability', weight: 15 },
        { field: 'bsr', weight: 10 },
        { field: 'ratings', weight: 10 },
        { field: 'buyBox', weight: 5 },
        { field: 'variants', weight: 5 },
    ],
    intelligence: [
        { field: 'asin', weight: 10 },
        { field: 'title', weight: 10 },
        { field: 'canonicalUrl', weight: 5 },
        { field: 'price', weight: 25 },
        { field: 'availability', weight: 15 },
        { field: 'bsr', weight: 10 },
        { field: 'ratings', weight: 10 },
        { field: 'buyBox', weight: 10 },
        { field: 'variants', weight: 5 },
    ],
};

/**
 * A field counts as present when it was EXTRACTED, or when Amazon genuinely did
 * not show it (NOT_PRESENT / NOT_APPLICABLE / OUT_OF_STOCK). Only PARSER_MISS
 * and location failures count against us -- the score measures our extraction,
 * not Amazon's page content.
 */
function present(record: ProductRecord, field: CriticalField): boolean {
    const ok = (s: string): boolean =>
        s === FIELD_STATUS.EXTRACTED ||
        s === FIELD_STATUS.NOT_PRESENT ||
        s === FIELD_STATUS.NOT_APPLICABLE ||
        s === FIELD_STATUS.OUT_OF_STOCK;

    switch (field) {
        case 'asin':
            return record.asin !== '';
        case 'title':
            return typeof record.title === 'string' && record.title.trim() !== '';
        case 'canonicalUrl':
            return record.canonicalUrl !== '';
        case 'price':
            return record.pricing.currentPrice !== null || ok(record.pricing.status);
        case 'availability':
            return ok(record.availability.status);
        case 'bsr':
            return ok(record.rankings.status);
        case 'ratings':
            return ok(record.ratings.status);
        case 'buyBox':
            return ok(record.buyBox.status);
        case 'variants':
            return ok(record.variants.status);
        default:
            return false;
    }
}

export interface CompletenessResult {
    score: number;
    missing: CriticalField[];
}

export function scoreCompleteness(record: ProductRecord, mode: 'fast' | 'detail' | 'intelligence'): CompletenessResult {
    const spec = CRITICAL_FIELDS[mode];
    let score = 0;
    const missing: CriticalField[] = [];
    for (const { field, weight } of spec) {
        if (present(record, field)) score += weight;
        else missing.push(field);
    }
    return { score: Math.round(score), missing };
}
