/** Delivery-location priming. Spec v1.1 section 9.4 (C12). */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildLocationPayload,
    extractCsrfToken,
    isLocationUpdateAccepted,
    verifyLocation,
} from '../../fetch/location-primer.js';
import * as F from '../fixtures/pages.js';

test('the anti-CSRF token is read from the location modal', () => {
    assert.equal(extractCsrfToken(F.LOCATION_MODAL), 'gKp9Example+Token/AbC=');
    assert.equal(extractCsrfToken('<div csrfToken="toaster-token+/="></div>'), 'toaster-token+/=');
    assert.equal(extractCsrfToken('<div>no token here</div>'), null);
});

test('location-update responses reject explicit failures', () => {
    assert.equal(isLocationUpdateAccepted(200, '{"sembuUpdated":true}'), true);
    assert.equal(isLocationUpdateAccepted(200, '{"sembuUpdated":false}'), false);
    assert.equal(isLocationUpdateAccepted(200, '<div>accepted</div>'), true);
    assert.equal(isLocationUpdateAccepted(403, '{"sembuUpdated":true}'), false);
});

test('an applied location is verified from the page, not assumed', () => {
    assert.equal(verifyLocation(F.NAV_LOCATION_APPLIED, '10001'), true);
    assert.equal(verifyLocation(F.NAV_LOCATION_APPLIED, '90210'), false, 'a different ZIP means it did not apply');
});

test('an unset location indicator reports false', () => {
    assert.equal(verifyLocation(F.NAV_LOCATION_UNSET, '10001'), false);
});

test('no indicator at all returns null so the caller cannot claim the location was verified', () => {
    assert.equal(verifyLocation('<html><body>no nav</body></html>', '10001'), null);
});

test('the delivery country is sent with the postal code when supplied', () => {
    assert.deepEqual(buildLocationPayload('10001', 'us'), {
        locationType: 'LOCATION_INPUT',
        zipCode: '10001',
        storeContext: 'generic',
        deviceType: 'web',
        pageType: 'Detail',
        actionSource: 'glow',
        countryCode: 'US',
    });
    assert.equal('countryCode' in buildLocationPayload('10001', null), false);
});
