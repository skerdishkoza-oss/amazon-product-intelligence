/**
 * Page classification and block detection. Spec v1.1 section 10.1.
 *
 * The distinction that matters commercially: a not-found page is a real answer
 * about the product and must never be retried, escalated to residential proxy,
 * or counted as a block.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DE, US } from '../../amazon/marketplace-config/index.js';
import { classifyPage } from '../../amazon/parsers/page-type.js';
import * as F from '../fixtures/pages.js';

test('a CAPTCHA page served as HTTP 200 is detected as blocked', () => {
    const c = classifyPage({ html: F.CHALLENGE_PAGE, statusCode: 200, cfg: US, expected: 'PRODUCT' });
    assert.equal(c.pageType, 'CHALLENGE');
    assert.equal(c.blocked, true);
    assert.equal(c.notFound, false);
    assert.equal(c.reason, 'CHALLENGE_PAGE');
});

test('the not-found dog page is a real answer, never a block', () => {
    const c = classifyPage({ html: F.DOG_PAGE, statusCode: 200, cfg: US, expected: 'PRODUCT' });
    assert.equal(c.pageType, 'NOT_FOUND');
    assert.equal(c.notFound, true);
    assert.equal(c.blocked, false, 'retrying or escalating this would waste money for no reason');
    assert.equal(c.reason, 'DOG_PAGE');
});

test('a template-only stub is treated as a block, not an empty product', () => {
    const c = classifyPage({ html: F.EMPTY_TEMPLATE, statusCode: 200, cfg: US, expected: 'PRODUCT' });
    assert.equal(c.blocked, true);
    assert.equal(c.reason, 'EMPTY_TEMPLATE');
});

test('429 and 503 are blocks; 404 is a not-found', () => {
    assert.equal(classifyPage({ html: F.US_STANDARD, statusCode: 503, cfg: US }).blocked, true);
    assert.equal(classifyPage({ html: F.US_STANDARD, statusCode: 429, cfg: US }).blocked, true);
    const notFound = classifyPage({ html: F.US_STANDARD, statusCode: 404, cfg: US });
    assert.equal(notFound.notFound, true);
    assert.equal(notFound.blocked, false);
});

test('healthy product pages classify by shape', () => {
    assert.equal(classifyPage({ html: F.US_STANDARD, statusCode: 200, cfg: US, expected: 'PRODUCT' }).pageType, 'STANDARD_PRODUCT');
    assert.equal(classifyPage({ html: F.US_VARIATION_PARENT, statusCode: 200, cfg: US, expected: 'PRODUCT' }).pageType, 'VARIATION_PARENT');
    assert.equal(classifyPage({ html: F.US_NO_BUYBOX, statusCode: 200, cfg: US, expected: 'PRODUCT' }).pageType, 'UNAVAILABLE');
});

test('DE localized challenge and not-found wording is detected (C6)', () => {
    const challenge = `<html><body><h4>Geben Sie die Zeichen unten ein</h4><p>Wir möchten nur sicherstellen, dass Sie kein Roboter sind.</p></body></html>`;
    assert.equal(classifyPage({ html: challenge, statusCode: 200, cfg: DE, expected: 'PRODUCT' }).blocked, true);

    const missing = `<html><body><h4>Seite nicht gefunden</h4></body></html>`;
    assert.equal(classifyPage({ html: missing, statusCode: 200, cfg: DE, expected: 'PRODUCT' }).notFound, true);
});

test('search pages classify separately from product pages', () => {
    const good = classifyPage({ html: F.US_SEARCH_PAGE, statusCode: 200, cfg: US, expected: 'SEARCH' });
    assert.equal(good.pageType, 'SEARCH');
    assert.equal(good.blocked, false);

    const empty = classifyPage({ html: F.US_SEARCH_NO_RESULTS, statusCode: 200, cfg: US, expected: 'SEARCH' });
    assert.equal(empty.notFound, true);
    assert.equal(empty.blocked, false, 'a genuinely empty search is not a block');
});

test('a non-404 refusal status is a block, not a usable page', () => {
    // Regression: a live smoke run with no proxy returned 403 and the page was
    // handed to the parsers, producing NO_CRITICAL_FIELDS and hiding the cause.
    for (const status of [401, 403, 407, 429, 451, 500, 503]) {
        const c = classifyPage({ html: F.US_STANDARD, statusCode: status, cfg: US, expected: 'PRODUCT' });
        assert.equal(c.blocked, true, `HTTP ${status} must be treated as a block`);
        assert.equal(c.notFound, false);
    }
});

test('other error statuses fail without triggering a paid escalation', () => {
    const c = classifyPage({ html: F.US_STANDARD, statusCode: 400, cfg: US, expected: 'PRODUCT' });
    assert.equal(c.blocked, false, 'no residential escalation for a malformed request');
    assert.equal(c.reason, 'HTTP_STATUS');
});
