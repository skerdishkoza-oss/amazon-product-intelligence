import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyCountryForMarketplace } from '../../fetch/proxy-country.js';

test('proxy country follows each supported marketplace', () => {
    assert.equal(proxyCountryForMarketplace('US'), 'US');
    assert.equal(proxyCountryForMarketplace('UK'), 'GB');
    assert.equal(proxyCountryForMarketplace('DE'), 'DE');
    assert.equal(proxyCountryForMarketplace('FR'), 'FR');
    assert.equal(proxyCountryForMarketplace('IT'), 'IT');
    assert.equal(proxyCountryForMarketplace('ES'), 'ES');
    assert.equal(proxyCountryForMarketplace('CA'), 'CA');
});

test('explicit proxy country remains authoritative and is normalized', () => {
    assert.equal(proxyCountryForMarketplace('US', ' de '), 'DE');
});
