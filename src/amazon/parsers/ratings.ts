/** Ratings and review counts. Spec v1.1 section 6.4. */

import type { RatingsBlock } from '../../types/output.js';
import { FIELD_STATUS } from '../../types/status.js';
import { parseCount, parseRating } from '../number-parse.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { clean, firstAttr, firstText, load, type Dom } from './dom.js';

const RATING_TEXT_SELECTORS = [
    '#acrPopover .a-size-base.a-color-base',
    'span[data-hook="rating-out-of-text"]',
    '#averageCustomerReviews .a-icon-alt',
    '#acrPopover .a-icon-alt',
    '.reviewCountTextLinkedHistogram .a-icon-alt',
];

const REVIEW_COUNT_SELECTORS = ['#acrCustomerReviewText', '[data-hook="total-review-count"]', '#reviewsMedley .a-size-base'];

export function parseRatings(html: string, cfg: MarketplaceConfig, dom?: Dom): RatingsBlock {
    const $ = dom ?? load(html);

    // The title attribute on #acrPopover is the most stable source and survives
    // the icon-alt markup changing.
    const attr = firstAttr($, ['#acrPopover'], 'title');
    const text = firstText($, RATING_TEXT_SELECTORS);
    const ratingRaw = attr?.value ?? text?.text ?? null;
    const rating = ratingRaw === null ? null : parseRating(ratingRaw, cfg);

    const countHit = firstText($, REVIEW_COUNT_SELECTORS);
    const reviewCount = countHit === null ? null : parseCount(countHit.text, cfg);

    const distribution = parseHistogram($, cfg);

    if (rating === null && reviewCount === null) {
        // No review section at all is a real state for new products.
        const hasReviewSection = $('#averageCustomerReviews, #acrPopover, #reviewsMedley').length > 0;
        return {
            rating: null,
            reviewCount: null,
            starDistribution: null,
            status: hasReviewSection ? FIELD_STATUS.PARSER_MISS : FIELD_STATUS.NOT_PRESENT,
        };
    }

    return {
        rating,
        reviewCount,
        starDistribution: distribution,
        status: FIELD_STATUS.EXTRACTED,
    };
}

/** "5 star 61%" rows in the ratings histogram. */
function parseHistogram($: Dom, cfg: MarketplaceConfig): Record<string, number> | null {
    const out: Record<string, number> = {};
    $('#histogramTable tr, [data-hook="histogram-row"], .a-histogram-row').each((_, row) => {
        const label = clean($(row).find('.a-text-left, .a-size-base:first-child, td:first-child').first().text());
        const percentText = clean($(row).find('.a-text-right, .a-size-base:last-child, td:last-child').last().text());
        if (label === null || percentText === null) return;
        const star = /([1-5])/.exec(label)?.[1];
        const percent = parseCount(percentText.replace('%', ''), cfg);
        if (star !== undefined && percent !== null && percent >= 0 && percent <= 100) out[`${star}`] = percent;
    });
    return Object.keys(out).length === 0 ? null : out;
}
