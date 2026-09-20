#!/usr/bin/env node
/**
 * Capture a sanitized real Amazon page as a test fixture. Spec v1.1 C16.
 *
 * The synthetic fixtures in src/tests/fixtures/pages.ts reproduce the
 * structures the parsers target, but real pages drift. This script captures a
 * live page, strips everything that must never reach a repo -- cookies, session
 * and CSRF tokens, customer identifiers, your delivery address -- and writes it
 * to fixtures/real/, where the parser suite picks it up automatically.
 *
 *   node scripts/capture-fixture.mjs B0CX23V2ZK US [--proxy http://user:pass@host:port]
 *
 * Review the output before committing. The sanitizer is deliberately blunt, but
 * it cannot know what is sensitive in a page it has never seen.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const HOSTS = { US: 'www.amazon.com', UK: 'www.amazon.co.uk', DE: 'www.amazon.de' };

const [asin, marketplace = 'US'] = argv.slice(2).filter((a) => !a.startsWith('--'));
const proxyIndex = argv.indexOf('--proxy');
const proxyUrl = proxyIndex > -1 ? argv[proxyIndex + 1] : undefined;

if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
    console.error('usage: node scripts/capture-fixture.mjs <ASIN> [US|UK|DE] [--proxy URL]');
    exit(1);
}
const host = HOSTS[marketplace.toUpperCase()];
if (!host) {
    console.error(`unsupported marketplace: ${marketplace}. Supported: ${Object.keys(HOSTS).join(', ')}`);
    exit(1);
}

/** Redact anything session- or identity-bearing. Order matters: broad last. */
function sanitize(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?ue_id[\s\S]*?<\/script>/gi, '<script>/* ue telemetry removed */</script>')
        .replace(/("(?:anti-csrftoken-a2z|csrfToken|CSRF_TOKEN|rid|requestId|marketplaceID|sessionId|ubid|session-token)"\s*:\s*)"[^"]*"/gi, '$1"REDACTED"')
        .replace(/(name="(?:anti-csrftoken-a2z|session-id|ubid-main|csrfToken)"[^>]*value=")[^"]*(")/gi, '$1REDACTED$2')
        .replace(/(data-csa-c-(?:item-id|content-id|slot-id)=")[^"]*(")/gi, '$1REDACTED$2')
        .replace(/\b\d{3}-\d{7}-\d{7}\b/g, 'REDACTED-SESSION-ID')
        .replace(/(glow-ingress-line2[^>]*>)[^<]*(<)/gi, '$1REDACTED LOCATION$2')
        .replace(/([?&](?:pd_rd_[a-z]+|pf_rd_[a-z]+|qid|sr|linkCode|tag|ascsubtag)=)[^&"'\s]*/gi, '$1REDACTED');
}

const url = `https://${host}/dp/${asin.toUpperCase()}`;
console.log(`fetching ${url}${proxyUrl ? ' via proxy' : ' with no proxy (expect a challenge page)'}`);

const { gotScraping } = await import('got-scraping');
const response = await gotScraping({
    url,
    proxyUrl,
    headers: { 'accept-encoding': 'gzip, deflate, br' },
    throwHttpErrors: false,
    responseType: 'text',
    timeout: { request: 45_000 },
});

const html = sanitize(String(response.body ?? ''));
const dir = new URL('../fixtures/real/', import.meta.url);
await mkdir(dir, { recursive: true });
const file = new URL(`${marketplace.toUpperCase()}_${asin.toUpperCase()}.html`, dir);
await writeFile(file, html, 'utf8');

console.log(`status ${response.statusCode}, ${html.length} bytes -> ${file.pathname}`);
if (html.length < 100_000) {
    console.warn('WARNING: a real product page is usually >200 KB. This is probably a challenge or stub page.');
}
console.log('review the file for anything personal before committing.');
