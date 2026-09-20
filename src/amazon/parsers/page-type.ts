/**
 * Page classification and block/challenge detection. Spec v1.1 sections 10.1.
 *
 * Detection returns a reason code that lands in the failure row, so the
 * difference between a CAPTCHA, an empty template and a redirect loop survives
 * into the dataset instead of collapsing into "blocked".
 */

import type { PageType } from '../../types/output.js';
import { FAILURE_REASON, type FailureReason } from '../../types/status.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { load, type Dom } from './dom.js';

export interface PageClassification {
    pageType: PageType;
    blocked: boolean;
    notFound: boolean;
    reason: FailureReason | null;
}

/** Amazon's minimum plausible product page. Anything shorter is a template. */
const MIN_PRODUCT_HTML = 8_000;

export function classifyPage(args: {
    html: string;
    statusCode: number;
    cfg: MarketplaceConfig;
    dom?: Dom;
    expected?: 'PRODUCT' | 'SEARCH' | 'AUXILIARY';
}): PageClassification {
    const { html, statusCode, cfg } = args;
    const lower = html.toLowerCase();

    // 1. Explicit challenge markers first: a CAPTCHA page can return HTTP 200.
    const challengeMarkers = ['/errors/validatecaptcha', 'id="captchacharacters"', 'name="amzn-captcha-submit"'];
    if (challengeMarkers.some((m) => lower.includes(m)) || cfg.labels.challenge.some((p) => lower.includes(p.toLowerCase()))) {
        return { pageType: 'CHALLENGE', blocked: true, notFound: false, reason: FAILURE_REASON.CHALLENGE_PAGE };
    }

    // 2. Not-found ("dog") pages are a real answer about the product, not a
    // transport failure, so they must never be retried or counted as blocks.
    if (cfg.labels.notFound.some((p) => lower.includes(p.toLowerCase())) || lower.includes('dogs of amazon')) {
        return { pageType: 'NOT_FOUND', blocked: false, notFound: true, reason: FAILURE_REASON.DOG_PAGE };
    }

    if (statusCode === 404) {
        return { pageType: 'NOT_FOUND', blocked: false, notFound: true, reason: FAILURE_REASON.HTTP_STATUS };
    }
    // Statuses that mean "someone refused to serve us the page". These are
    // worth a session rotation and, within budget, an escalation.
    if (statusCode === 401 || statusCode === 403 || statusCode === 407 || statusCode === 429 || statusCode === 451 || statusCode >= 500) {
        return { pageType: 'CHALLENGE', blocked: true, notFound: false, reason: FAILURE_REASON.HTTP_STATUS };
    }
    // Any other error status is still a failure, just not a block: never let it
    // through as a usable page, or the parser reports NO_CRITICAL_FIELDS and
    // the real cause is lost.
    if (statusCode >= 400) {
        return { pageType: 'UNKNOWN', blocked: false, notFound: false, reason: FAILURE_REASON.HTTP_STATUS };
    }

    // Offer AJAX fragments and seller profile pages do not contain the product
    // anchors used below. Once challenge/error checks pass, accept a plausible
    // HTML fragment and let the feature parser report NOT_PRESENT/PARSER_MISS.
    if (args.expected === 'AUXILIARY') {
        if (html.trim().length >= 200) {
            return { pageType: 'UNKNOWN', blocked: false, notFound: false, reason: null };
        }
        return { pageType: 'UNKNOWN', blocked: true, notFound: false, reason: FAILURE_REASON.EMPTY_TEMPLATE };
    }

    // 3. Unexpectedly tiny or template-only responses. Amazon serves these
    // under load, and treating them as a valid empty page is how competitors
    // end up emitting rows full of nulls.
    if (args.expected === 'PRODUCT' && html.length < MIN_PRODUCT_HTML) {
        return { pageType: 'UNKNOWN', blocked: true, notFound: false, reason: FAILURE_REASON.EMPTY_TEMPLATE };
    }

    const $ = args.dom ?? load(html);

    if (args.expected === 'SEARCH') {
        const hasResults = $(
            '[data-component-type="s-search-result"], .s-result-item[data-asin], .stores-widget-btf [data-asin], '
            + '[data-testid="grid-container"] [data-asin], .ProductGridItem__itemOuter__KUtvv[data-asin]',
        ).length > 0;
        const hasNoResultsMessage = cfg.labels.noResults.some((phrase) => lower.includes(phrase.toLowerCase()));
        if (hasResults) return { pageType: 'SEARCH', blocked: false, notFound: false, reason: null };
        if (hasNoResultsMessage) return { pageType: 'SEARCH', blocked: false, notFound: true, reason: FAILURE_REASON.URL_NO_ASIN };
        return { pageType: 'UNKNOWN', blocked: true, notFound: false, reason: FAILURE_REASON.EMPTY_TEMPLATE };
    }

    const hasProductAnchor = $('#productTitle, #dp, #ppd, input#ASIN').length > 0;
    if (!hasProductAnchor) {
        return { pageType: 'UNKNOWN', blocked: true, notFound: false, reason: FAILURE_REASON.EMPTY_TEMPLATE };
    }

    if ($('#outOfStock').length > 0 && $('#buybox, #addToCart_feature_div').length === 0) {
        return { pageType: 'UNAVAILABLE', blocked: false, notFound: false, reason: null };
    }
    if ($('#twister, #twister-plus-inline-twister, [id^="variation_"]').length > 0) {
        return { pageType: 'VARIATION_PARENT', blocked: false, notFound: false, reason: null };
    }
    if ($('#bookDescription_feature_div, #ebooksProductTitle, #mediaTabs_tabSet').length > 0) {
        return { pageType: 'BOOK_OR_MEDIA', blocked: false, notFound: false, reason: null };
    }
    return { pageType: 'STANDARD_PRODUCT', blocked: false, notFound: false, reason: null };
}
