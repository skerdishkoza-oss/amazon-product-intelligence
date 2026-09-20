/**
 * Runs the parser suite over any sanitized real captures in fixtures/real/.
 * Spec v1.1 C16, 12.2.
 *
 * Skips cleanly when there are none, so CI stays green on a fresh clone while
 * still exercising real pages the moment someone captures one with
 * scripts/capture-fixture.mjs.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getMarketplace, isSupportedMarketplace } from '../../amazon/marketplace-config/index.js';
import { classifyPage } from '../../amazon/parsers/page-type.js';
import { parseProductPage } from '../../amazon/parsers/product.js';

const dir = fileURLToPath(new URL('../../../fixtures/real/', import.meta.url));

function captures(): string[] {
    try {
        return readdirSync(dir).filter((f) => f.endsWith('.html'));
    } catch {
        return [];
    }
}

test('sanitized real captures parse without a single strategy throwing', (t) => {
    const files = captures();
    if (files.length === 0) {
        t.skip('no real captures yet; run scripts/capture-fixture.mjs to add some');
        return;
    }

    for (const file of files) {
        const [code, rest] = file.split('_');
        assert.ok(code && isSupportedMarketplace(code), `filename must start with a marketplace code: ${file}`);
        const html = readFileSync(dir + file, 'utf8');

        // A capture that is itself a challenge page tells you the capture run
        // was blocked, not that the parsers are broken.
        const classification = classifyPage({ html, statusCode: 200, cfg: getMarketplace(code), expected: 'PRODUCT' });
        assert.equal(classification.blocked, false, `${file} is a blocked/stub page; recapture it`);

        const parsed = parseProductPage({
            html,
            url: `https://example.invalid/dp/${(rest ?? '').replace('.html', '')}`,
            marketplace: code,
            variantMode: 'discover',
        });

        assert.equal(
            parsed.warnings.filter((w) => w.startsWith('PARSER_THREW')).length,
            0,
            `a strategy threw on ${file}: ${parsed.warnings.join(' | ')}`,
        );
        assert.equal(parsed.hasAnyCriticalField, true, `no critical field extracted from ${file}`);
        assert.ok(parsed.title !== null, `no title in ${file}`);
        // Sanitization must not leave anything session-bearing behind.
        assert.equal(/\b\d{3}-\d{7}-\d{7}\b/.test(html), false, `${file} still contains a session id`);
    }
});
