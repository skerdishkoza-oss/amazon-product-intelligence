/**
 * Spec v1.1 section 8.2 and Appendix C (C7, C8).
 * "No paid-result event for a failed product extraction" is enforced, not trusted.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BillingEvents, NoopChargingBackend } from '../../billing/events.js';
import { RECORD_STATUS, isBillable } from '../../types/status.js';

test('SUCCESS is the only billable record status', () => {
    for (const status of Object.values(RECORD_STATUS)) {
        assert.equal(isBillable(status), status === 'SUCCESS', `${status} billability is wrong`);
    }
});

test('no charge fires for any failure status', async () => {
    const backend = new NoopChargingBackend();
    const billing = new BillingEvents(backend);

    for (const status of Object.values(RECORD_STATUS)) {
        if (status === 'SUCCESS') continue;
        const outcome = await billing.chargeProductDetail(status);
        assert.equal(outcome.charged, false, `${status} must never charge`);
        assert.equal(outcome.reason, 'NOT_BILLABLE_STATUS');
    }
    assert.equal(backend.calls.length, 0, 'the backend must not even be called for failures');
    assert.equal(billing.stats().successfulPaidEvents, 0);
});

test('a successful record charges exactly once', async () => {
    const backend = new NoopChargingBackend();
    const billing = new BillingEvents(backend);
    const outcome = await billing.chargeProductDetail(RECORD_STATUS.SUCCESS);

    assert.equal(outcome.charged, true);
    assert.deepEqual(backend.calls, [{ eventName: 'product-detail', count: 1 }]);
    assert.equal(billing.stats().successfulPaidEvents, 1);
});

test('charge cap stops further charging and signals wind-down (C8)', async () => {
    const backend = new NoopChargingBackend(2);
    const billing = new BillingEvents(backend);

    await billing.chargeProductDetail(RECORD_STATUS.SUCCESS);
    assert.equal(billing.isCapReached(), false);

    await billing.chargeProductDetail(RECORD_STATUS.SUCCESS);
    assert.equal(billing.isCapReached(), true, 'run loop polls this to stop scheduling work');

    const third = await billing.chargeProductDetail(RECORD_STATUS.SUCCESS);
    assert.equal(third.charged, false);
    assert.equal(third.reason, 'CAP_REACHED');
    assert.equal(backend.calls.length, 2, 'no work is charged past the cap');
});

test('a backend error is counted, never thrown into the scraping loop', async () => {
    const failing = {
        async charge(): Promise<{ capReached: boolean; chargedCount: number }> {
            throw new Error('platform 503');
        },
    };
    const billing = new BillingEvents(failing);
    const outcome = await billing.chargeProductDetail(RECORD_STATUS.SUCCESS);
    assert.equal(outcome.charged, false);
    assert.equal(outcome.reason, 'BACKEND_ERROR');
    assert.equal(billing.stats().failedPaidEvents, 1);
});

test('a partially fulfilled platform charge counts only charged events', async () => {
    const partial = {
        async charge(): Promise<{ capReached: boolean; chargedCount: number }> {
            return { capReached: true, chargedCount: 1 };
        },
    };
    const billing = new BillingEvents(partial);
    const outcome = await billing.chargeOffers(RECORD_STATUS.SUCCESS, 3);
    assert.equal(outcome.charged, false);
    assert.equal(outcome.chargedCount, 1);
    assert.equal(outcome.reason, 'CAP_REACHED');
    assert.equal(billing.stats().successfulPaidEvents, 1);
});

test('monitoring charges a completed check even with no change (7.3)', async () => {
    const backend = new NoopChargingBackend();
    const billing = new BillingEvents(backend);
    await billing.chargeProductCheck(RECORD_STATUS.SUCCESS);
    assert.deepEqual(backend.calls, [{ eventName: 'product-check', count: 1 }]);
});
