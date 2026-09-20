/** Spec v1.1 section 5.1 (C17): money arithmetic never touches floats. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    CurrencyMismatchError,
    diffMinor,
    discountPercent,
    money,
    moneyFromMajor,
    percentChange,
    toMoney,
} from '../../types/money.js';

test('float subtraction bug does not reach the output', () => {
    // 29.99 - 24.99 === 5.000000000000004 in IEEE 754.
    const before = moneyFromMajor(29.99, 'USD');
    const after = moneyFromMajor(24.99, 'USD');
    assert.equal(diffMinor(before, after), -500);
    assert.equal(toMoney(money(-500, 'USD', '')).amount, -5);
});

test('percentChange matches the spec example exactly', () => {
    // Appendix B / 7.2: 29.99 -> 24.99 is -16.67%.
    const pct = percentChange(moneyFromMajor(29.99, 'USD'), moneyFromMajor(24.99, 'USD'));
    assert.equal(pct, -16.67);
});

test('discountPercent matches the Appendix A example', () => {
    const pct = discountPercent(moneyFromMajor(29.99, 'USD'), moneyFromMajor(24.99, 'USD'));
    assert.equal(pct, 16.67);
});

test('zero base returns null rather than Infinity', () => {
    assert.equal(percentChange(moneyFromMajor(0, 'USD'), moneyFromMajor(5, 'USD')), null);
    assert.equal(discountPercent(moneyFromMajor(0, 'USD'), moneyFromMajor(5, 'USD')), null);
});

test('refuses to compare across currencies', () => {
    assert.throws(
        () => diffMinor(moneyFromMajor(10, 'USD'), moneyFromMajor(10, 'EUR')),
        CurrencyMismatchError,
    );
});

test('rejects non-integer minor units at construction', () => {
    assert.throws(() => money(24.995, 'USD', ''), TypeError);
});
