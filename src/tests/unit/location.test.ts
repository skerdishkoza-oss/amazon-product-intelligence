/** Delivery-location priming. Spec v1.1 section 9.4 (C12). */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCsrfToken, verifyLocation } from '../../fetch/location-primer.js';
import * as F from '../fixtures/pages.js';

test('the anti-CSRF token is read from the location modal', () => {
    assert.equal(extractCsrfToken(F.LOCATION_MODAL), 'gKp9Example+Token/AbC=');
    assert.equal(extractCsrfToken('<div>no token here</div>'), null);
});

test('an applied location is verified from the page, not assumed', () => {
    assert.equal(verifyLocation(F.NAV_LOCATION_APPLIED, '10001'), true);
    assert.equal(verifyLocation(F.NAV_LOCATION_APPLIED, '90210'), false, 'a different ZIP means it did not apply');
});

test('an unset location indicator reports false', () => {
    assert.equal(verifyLocation(F.NAV_LOCATION_UNSET, '10001'), false);
});

test('no indicator at all returns null so the caller keeps its prior belief', () => {
    assert.equal(verifyLocation('<html><body>no nav</body></html>', '10001'), null);
});
