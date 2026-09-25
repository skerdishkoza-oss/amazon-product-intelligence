import type { SearchCard } from '../amazon/parsers/search.js';
import type { DiscoveryFilters } from '../types/input.js';

export type DiscoveryFilterReason =
    | 'PRICE_MISSING'
    | 'PRICE_BELOW_MIN'
    | 'PRICE_ABOVE_MAX'
    | 'RATING_MISSING'
    | 'RATING_BELOW_MIN'
    | 'REVIEW_COUNT_MISSING'
    | 'REVIEW_COUNT_BELOW_MIN'
    | 'NOT_PRIME'
    | 'SPONSORED_EXCLUDED'
    | 'ORGANIC_EXCLUDED'
    | 'DEMAND_MISSING'
    | 'DEMAND_BELOW_MIN'
    | 'DISCOUNT_MISSING'
    | 'DISCOUNT_BELOW_MIN';

export interface DiscoveryFilterResult {
    matches: boolean;
    reasons: DiscoveryFilterReason[];
}

export function cardDiscountPercent(card: SearchCard): number | null {
    const current = card.price;
    const list = card.listPrice;
    if (current === null || list === null || current.currency !== list.currency || list.amount <= 0 || list.amount <= current.amount) {
        return null;
    }
    return Math.round((((list.amount - current.amount) / list.amount) * 100 + Number.EPSILON) * 100) / 100;
}

/**
 * A requested filter only passes when the listing card proves the condition.
 * Missing values are excluded instead of guessed, which makes filtered runs
 * reproducible and safe for sourcing decisions.
 */
export function matchDiscoveryCard(card: SearchCard, filters: DiscoveryFilters): DiscoveryFilterResult {
    const reasons: DiscoveryFilterReason[] = [];

    if (filters.minPrice !== null || filters.maxPrice !== null) {
        if (card.price === null) reasons.push('PRICE_MISSING');
        else {
            if (filters.minPrice !== null && card.price.amount < filters.minPrice) reasons.push('PRICE_BELOW_MIN');
            if (filters.maxPrice !== null && card.price.amount > filters.maxPrice) reasons.push('PRICE_ABOVE_MAX');
        }
    }
    if (filters.minRating !== null) {
        if (card.rating === null) reasons.push('RATING_MISSING');
        else if (card.rating < filters.minRating) reasons.push('RATING_BELOW_MIN');
    }
    if (filters.minReviewCount !== null) {
        if (card.reviewCount === null) reasons.push('REVIEW_COUNT_MISSING');
        else if (card.reviewCount < filters.minReviewCount) reasons.push('REVIEW_COUNT_BELOW_MIN');
    }
    if (filters.primeOnly && !card.primeEligible) reasons.push('NOT_PRIME');
    if (filters.sponsoredPolicy === 'exclude' && card.sponsored) reasons.push('SPONSORED_EXCLUDED');
    if (filters.sponsoredPolicy === 'only' && !card.sponsored) reasons.push('ORGANIC_EXCLUDED');
    if (filters.minBoughtInPastMonth !== null) {
        if (card.boughtInPastMonthMin === null) reasons.push('DEMAND_MISSING');
        else if (card.boughtInPastMonthMin < filters.minBoughtInPastMonth) reasons.push('DEMAND_BELOW_MIN');
    }
    if (filters.minDiscountPercent !== null) {
        const discount = cardDiscountPercent(card);
        if (discount === null) reasons.push('DISCOUNT_MISSING');
        else if (discount < filters.minDiscountPercent) reasons.push('DISCOUNT_BELOW_MIN');
    }

    return { matches: reasons.length === 0, reasons };
}
