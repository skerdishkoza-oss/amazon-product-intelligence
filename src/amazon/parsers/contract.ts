/**
 * Spec v1.1 section 9.6 (C15). The parser contract.
 *
 * Every strategy has the signature (ctx) => { value, source, status }, is pure
 * with respect to the input document, and NEVER throws. A strategy that cannot
 * extract returns PARSER_MISS and the next strategy runs. A thrown exception in
 * a parser is a test failure, not a runtime condition -- runStrategies converts
 * one into a PARSER_MISS plus a warning so a single bad selector cannot take
 * down a run, and the warning surfaces it in QA.
 */

import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { FIELD_STATUS, type FieldStatus } from '../../types/status.js';

export interface ParseContext {
    html: string;
    url: string;
    config: MarketplaceConfig;
}

export interface ParseOutcome<T, S extends string = string> {
    value: T | null;
    source: S | null;
    status: FieldStatus;
    /** Optional note for quality.warnings, e.g. "price found only in JSON-LD". */
    warning?: string;
}

export interface ParserStrategy<T, S extends string = string> {
    readonly name: string;
    readonly source: S;
    parse(ctx: ParseContext): ParseOutcome<T, S>;
}

export function miss<T, S extends string>(warning?: string): ParseOutcome<T, S> {
    const outcome: ParseOutcome<T, S> = { value: null, source: null, status: FIELD_STATUS.PARSER_MISS };
    if (warning !== undefined) outcome.warning = warning;
    return outcome;
}

export function notPresent<T, S extends string>(): ParseOutcome<T, S> {
    return { value: null, source: null, status: FIELD_STATUS.NOT_PRESENT };
}

export function extracted<T, S extends string>(value: T, source: S, warning?: string): ParseOutcome<T, S> {
    const outcome: ParseOutcome<T, S> = { value, source, status: FIELD_STATUS.EXTRACTED };
    if (warning !== undefined) outcome.warning = warning;
    return outcome;
}

/**
 * Run strategies in order and take the first EXTRACTED result.
 *
 * If every strategy returns NOT_PRESENT, the field genuinely is not on the page
 * and the result is NOT_PRESENT. If any strategy claimed a miss, the result is
 * PARSER_MISS -- the distinction the whole product promise rests on (spec 5.3).
 */
export function runStrategies<T, S extends string>(
    strategies: ReadonlyArray<ParserStrategy<T, S>>,
    ctx: ParseContext,
): ParseOutcome<T, S> & { warnings: string[] } {
    const warnings: string[] = [];
    let sawMiss = false;

    for (const strategy of strategies) {
        let outcome: ParseOutcome<T, S>;
        try {
            outcome = strategy.parse(ctx);
        } catch (err) {
            warnings.push(`parser ${strategy.name} threw: ${(err as Error).message}`);
            sawMiss = true;
            continue;
        }
        if (outcome.warning) warnings.push(`${strategy.name}: ${outcome.warning}`);
        if (outcome.status === FIELD_STATUS.EXTRACTED && outcome.value !== null) {
            return { ...outcome, warnings };
        }
        if (outcome.status === FIELD_STATUS.PARSER_MISS) sawMiss = true;
        if (
            outcome.status === FIELD_STATUS.OUT_OF_STOCK ||
            outcome.status === FIELD_STATUS.GEO_RESTRICTED ||
            outcome.status === FIELD_STATUS.REQUIRES_LOCATION
        ) {
            return { ...outcome, warnings };
        }
    }

    return {
        value: null,
        source: null,
        status: sawMiss ? FIELD_STATUS.PARSER_MISS : FIELD_STATUS.NOT_PRESENT,
        warnings,
    };
}
