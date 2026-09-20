/**
 * Spec v1.1 sections 9.6, 12.2 (C15).
 *
 * The golden-schema gate. It runs over every record in tests and production.
 * DatasetWriter rejects violations so malformed value rows can never reach the
 * append-only dataset; the pipeline replaces them with a structured,
 * non-billable PARSER_ERROR row.
 */

import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import type { DatasetRecord } from '../types/output.js';

const require = createRequire(import.meta.url);
const schema = require('../schemas/record.schema.json') as object;
// ajv ships CJS; requiring it keeps this file working under NodeNext ESM.
const AjvCtor = require('ajv') as typeof import('ajv').default;

let validator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
    if (validator === undefined) {
        const ajv = new AjvCtor({ allErrors: true, strict: false });
        const compiled: ValidateFunction = ajv.compile(schema);
        validator = compiled;
        return compiled;
    }
    return validator;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export function validateRecord(record: unknown): ValidationResult {
    const validate = getValidator();
    const valid = validate(record) as boolean;
    if (valid) return { valid: true, errors: [] };
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
    return { valid: false, errors };
}

/** Throwing variant for tests and the CI gate. */
export function assertValidRecord(record: DatasetRecord): void {
    const { valid, errors } = validateRecord(record);
    if (!valid) {
        throw new Error(`record failed golden schema validation:\n  ${errors.join('\n  ')}`);
    }
}
