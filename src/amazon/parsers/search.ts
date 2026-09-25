/**
 * Search-result parsing. Spec v1.1 sections 4.1, 6.7.
 *
 * Positions are reported three ways because they answer different questions:
 * `position` is what the shopper sees, `organicPosition` excludes ads (what SEO
 * teams rank on), and `sponsoredPosition` counts ads only.
 */

import { toMoney } from '../../types/money.js';
import type { MarketplaceCode } from '../../types/output.js';
import { extractFirstMoney, parseBoughtInPastMonth, parseCount, parseRating } from '../number-parse.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { clean, load, matchesLabel, type Dom } from './dom.js';

export interface SearchCard {
    asin: string;
    title: string | null;
    url: string;
    thumbnail: string | null;
    price: ReturnType<typeof toMoney> | null;
    listPrice: ReturnType<typeof toMoney> | null;
    rating: number | null;
    reviewCount: number | null;
    primeEligible: boolean;
    sponsored: boolean;
    badge: string | null;
    boughtInPastMonthRaw: string | null;
    boughtInPastMonthMin: number | null;
    deliveryText: string | null;
    position: number;
    organicPosition: number | null;
    sponsoredPosition: number | null;
}

export interface SearchPageResult {
    cards: SearchCard[];
    hasNextPage: boolean;
    totalResultsText: string | null;
}

const CARD_SELECTOR = [
    '[data-component-type="s-search-result"][data-asin]',
    '.s-result-item[data-asin]:not(.AdHolder)',
    '.stores-widget-btf [data-asin]',
    '[data-testid="grid-container"] [data-asin]',
    '.ProductGridItem__itemOuter__KUtvv[data-asin]',
].join(', ');

export function parseSearchPage(args: {
    html: string;
    marketplace: MarketplaceCode;
    cfg: MarketplaceConfig;
    page: number;
    dom?: Dom;
}): SearchPageResult {
    const { cfg } = args;
    const $ = args.dom ?? load(args.html);

    const cards: SearchCard[] = [];
    let position = 0;
    let organic = 0;
    let sponsored = 0;

    $(CARD_SELECTOR).each((_, el) => {
        const node = $(el);
        const asin = (node.attr('data-asin') ?? '').toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(asin)) return;
        if (cards.some((c) => c.asin === asin)) return;

        position += 1;

        const isSponsored =
            node.find('.s-sponsored-label-text, .puis-sponsored-label-text, [data-component-type="sp-sponsored-result"]').length > 0 ||
            node.attr('data-component-type') === 'sp-sponsored-result';
        if (isSponsored) sponsored += 1;
        else organic += 1;

        const title =
            clean(node.find('h2 span, [data-cy="title-recipe"] h2 span, h2 a span').first().text()) ??
            clean(node.find('h2').first().text());

        // Amazon's listing hrefs are relative and carry per-session tracking
        // refs, so the canonical /dp/ form is emitted instead: stable across
        // runs and joinable with the detail records for the same ASIN.
        const url = `https://${cfg.host}/dp/${asin}`;

        const priceText = clean(node.find('.a-price .a-offscreen').first().text());
        const listText = clean(node.find('.a-price.a-text-price[data-a-strike="true"] .a-offscreen, .a-price.a-text-price .a-offscreen').last().text());
        const price = priceText === null ? null : extractFirstMoney(priceText, cfg);
        const list = listText === null ? null : extractFirstMoney(listText, cfg);

        const ratingText = clean(node.find('.a-icon-alt').first().text()) ?? clean(node.find('[data-cy="reviews-ratings-slot"] .a-icon-alt').first().text());
        const reviewText =
            clean(node.find('[data-csa-c-func-deps] .a-size-base.s-underline-text').first().text()) ??
            clean(node.find('.a-size-base.s-underline-text, [aria-label*="ratings"], [aria-label*="Bewertungen"]').first().text());

        const secondary = node.find('.a-size-base.a-color-secondary, .a-row .a-size-base').toArray().map((n) => clean($(n).text()) ?? '');
        const demand = secondary.find((t) => matchesLabel(t, cfg.labels.boughtInPastMonth) !== null) ?? null;

        const badge = clean(node.find('.a-badge-text').first().text());
        const delivery = clean(node.find('[data-cy="delivery-recipe"], .udm-primary-delivery-message').first().text());

        cards.push({
            asin,
            title,
            url,
            thumbnail: node.find('img.s-image').first().attr('src') ?? null,
            price: price === null ? null : toMoney(price),
            listPrice: list !== null && price !== null && list.minor > price.minor ? toMoney(list) : null,
            rating: ratingText === null ? null : parseRating(ratingText, cfg),
            reviewCount: reviewText === null ? null : parseCount(reviewText, cfg),
            primeEligible: node.find('.a-icon-prime, [aria-label="Prime"]').length > 0,
            sponsored: isSponsored,
            badge,
            boughtInPastMonthRaw: demand,
            boughtInPastMonthMin: demand === null ? null : parseBoughtInPastMonth(demand, cfg),
            deliveryText: delivery,
            position: position + (args.page - 1) * 16,
            organicPosition: isSponsored ? null : organic,
            sponsoredPosition: isSponsored ? sponsored : null,
        });
    });

    const hasNextPage =
        $('a.s-pagination-next:not(.s-pagination-disabled)').length > 0 ||
        $('.s-pagination-item.s-pagination-next').not('.s-pagination-disabled').length > 0;

    return {
        cards,
        hasNextPage,
        totalResultsText: clean($('[data-component-type="s-result-info-bar"] h1, .s-breadcrumb .sg-col-inner').first().text()),
    };
}
