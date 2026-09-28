import assert from 'node:assert/strict';
import test from 'node:test';
import {
    proxyCountryForMarketplace,
    proxyCountryForPrimary,
    proxyGroupsForRun,
} from '../../fetch/proxy-country.js';

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

test('primary proxy infers a country only for residential groups', () => {
    assert.equal(proxyCountryForPrimary('UK', []), undefined);
    assert.equal(proxyCountryForPrimary('DE', ['SHADER']), undefined);
    assert.equal(proxyCountryForPrimary('UK', ['residential']), 'GB');
    assert.equal(proxyCountryForPrimary('US', [], ' ca '), 'CA');
});

test('full product modes default to residential while fast mode stays economical', () => {
    assert.deepEqual(proxyGroupsForRun([], 'detail', true), ['RESIDENTIAL']);
    assert.deepEqual(proxyGroupsForRun([], 'intelligence', true), ['RESIDENTIAL']);
    assert.deepEqual(proxyGroupsForRun([], 'monitor', true), ['RESIDENTIAL']);
    assert.deepEqual(proxyGroupsForRun([], 'fast', true), []);
    assert.deepEqual(proxyGroupsForRun([], 'detail', false), []);
    assert.deepEqual(proxyGroupsForRun(['SHADER'], 'detail', true), ['SHADER']);
});
