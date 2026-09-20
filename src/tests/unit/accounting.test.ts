/**
 * Spec v1.1 sections 10.3, 12.2 (C9). The accounting invariant is the product's
 * core promise: no input is ever silently lost, on any exit path.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountingViolationError, RunAccounting } from '../../output/accounting.js';
import { RECORD_STATUS } from '../../types/status.js';

test('invariant holds when every input is settled', () => {
    const acc = new RunAccounting();
    acc.registerRequested(3);
    for (const k of ['a', 'b', 'c']) acc.register(k);
    acc.settle('a', RECORD_STATUS.SUCCESS);
    acc.settle('b', RECORD_STATUS.BLOCKED);
    acc.settle('c', RECORD_STATUS.INVALID_INPUT);

    assert.equal(acc.uniqueInputs, 3);
    assert.equal(acc.accountedFor, 3);
    assert.equal(acc.holds(), true);
    acc.assertInvariant();
});

test('invariant fails loudly when an input is left pending', () => {
    const acc = new RunAccounting();
    for (const k of ['a', 'b']) acc.register(k);
    acc.settle('a', RECORD_STATUS.SUCCESS);

    assert.equal(acc.holds(), false);
    assert.throws(() => acc.assertInvariant(), AccountingViolationError);
    assert.deepEqual(acc.pending(), ['b']);
});

test('flushing pending inputs as RUN_ABORTED restores the invariant', () => {
    const acc = new RunAccounting();
    for (const k of ['a', 'b', 'c']) acc.register(k);
    acc.settle('a', RECORD_STATUS.SUCCESS);

    for (const key of acc.pending()) acc.settle(key, RECORD_STATUS.RUN_ABORTED);

    acc.assertInvariant();
    assert.equal(acc.snapshot().runAborted, 2);
    assert.equal(acc.accountedFor, 3);
});

test('double settle is a violation, not a silently-ignored no-op', () => {
    const acc = new RunAccounting();
    acc.register('a');
    acc.settle('a', RECORD_STATUS.SUCCESS);
    assert.throws(() => acc.settle('a', RECORD_STATUS.BLOCKED), AccountingViolationError);
});

test('settling an unregistered input is a violation', () => {
    const acc = new RunAccounting();
    assert.throws(() => acc.settle('ghost', RECORD_STATUS.SUCCESS), AccountingViolationError);
});

test('every record status maps to a distinct counter', () => {
    const acc = new RunAccounting();
    const statuses = Object.values(RECORD_STATUS);
    statuses.forEach((s, i) => {
        acc.register(`k${i}`);
        acc.settle(`k${i}`, s);
    });
    acc.assertInvariant();
    assert.equal(acc.accountedFor, statuses.length, 'a status with no counter would silently vanish here');
});
