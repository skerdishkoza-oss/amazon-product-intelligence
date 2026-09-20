/**
 * Spec v1.1 section 5.3 (C2).
 *
 * Two separate closed enums. Do not merge them. A record-level status is the
 * outcome of one *input*; a field-level status is the outcome of one *field*
 * inside a successful record.
 */

export const RECORD_STATUS = {
    SUCCESS: 'SUCCESS',
    PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
    INVALID_INPUT: 'INVALID_INPUT',
    BLOCKED: 'BLOCKED',
    FETCH_FAILED: 'FETCH_FAILED',
    PARSER_ERROR: 'PARSER_ERROR',
    GEO_RESTRICTED: 'GEO_RESTRICTED',
    REQUIRES_LOCATION: 'REQUIRES_LOCATION',
    RUN_ABORTED: 'RUN_ABORTED',
} as const;

export type RecordStatus = (typeof RECORD_STATUS)[keyof typeof RECORD_STATUS];

export const FIELD_STATUS = {
    EXTRACTED: 'EXTRACTED',
    NOT_PRESENT: 'NOT_PRESENT',
    NOT_APPLICABLE: 'NOT_APPLICABLE',
    OUT_OF_STOCK: 'OUT_OF_STOCK',
    GEO_RESTRICTED: 'GEO_RESTRICTED',
    REQUIRES_LOCATION: 'REQUIRES_LOCATION',
    PARSER_MISS: 'PARSER_MISS',
} as const;

export type FieldStatus = (typeof FIELD_STATUS)[keyof typeof FIELD_STATUS];

export const ALL_RECORD_STATUSES = Object.values(RECORD_STATUS);
export const ALL_FIELD_STATUSES = Object.values(FIELD_STATUS);

/**
 * Appendix C: SUCCESS is the only billable record status. This set is the single
 * source of truth; the billing module derives from it and a unit test asserts
 * that no other status can ever produce a charge.
 */
const BILLABLE: ReadonlySet<RecordStatus> = new Set<RecordStatus>([RECORD_STATUS.SUCCESS]);

export function isBillable(status: RecordStatus): boolean {
    return BILLABLE.has(status);
}

export function isFailure(status: RecordStatus): boolean {
    return status !== RECORD_STATUS.SUCCESS;
}

/** Machine-readable detail carried on failure rows (spec 5.4, 10.1). */
export const FAILURE_REASON = {
    ASIN_MALFORMED: 'ASIN_MALFORMED',
    DATASET_FIELD_MISSING: 'DATASET_FIELD_MISSING',
    DATASET_EMPTY: 'DATASET_EMPTY',
    URL_UNSUPPORTED: 'URL_UNSUPPORTED',
    URL_NO_ASIN: 'URL_NO_ASIN',
    MARKETPLACE_UNSUPPORTED: 'MARKETPLACE_UNSUPPORTED',
    DOG_PAGE: 'DOG_PAGE',
    CHALLENGE_PAGE: 'CHALLENGE_PAGE',
    EMPTY_TEMPLATE: 'EMPTY_TEMPLATE',
    REDIRECT_LOOP: 'REDIRECT_LOOP',
    HTTP_STATUS: 'HTTP_STATUS',
    TIMEOUT: 'TIMEOUT',
    BLOCKED_AFTER_FALLBACK: 'BLOCKED_AFTER_FALLBACK',
    RESIDENTIAL_FALLBACK_DISABLED: 'RESIDENTIAL_FALLBACK_DISABLED',
    ESCALATION_BUDGET_EXHAUSTED: 'ESCALATION_BUDGET_EXHAUSTED',
    NO_CRITICAL_FIELDS: 'NO_CRITICAL_FIELDS',
    OUTPUT_SCHEMA_VIOLATION: 'OUTPUT_SCHEMA_VIOLATION',
    LOCATION_NOT_APPLIED: 'LOCATION_NOT_APPLIED',
    MAX_PRODUCTS_REACHED: 'MAX_PRODUCTS_REACHED',
    CHARGE_CAP_REACHED: 'CHARGE_CAP_REACHED',
    BILLING_FAILED: 'BILLING_FAILED',
    SELLER_INPUT_NOT_AVAILABLE: 'SELLER_INPUT_NOT_AVAILABLE',
    CIRCUIT_BREAKER_TRIPPED: 'CIRCUIT_BREAKER_TRIPPED',
    RUN_TIMED_OUT: 'RUN_TIMED_OUT',
} as const;

export type FailureReason = (typeof FAILURE_REASON)[keyof typeof FAILURE_REASON];
