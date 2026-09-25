/** Previous-dataset comparison. Spec 7. */

import type { ChangeType, MonitoringBlock, ProductChange, ProductRecord } from '../types/output.js';
import { locationKey } from '../input/normalizer.js';
import { roundTo } from '../types/money.js';
import { FIELD_STATUS, type FieldStatus } from '../types/status.js';

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function path(root: UnknownRecord, ...parts: string[]): unknown {
    let current: unknown = root;
    for (const part of parts) {
        const item = object(current);
        if (item === null) return null;
        current = item[part];
    }
    return current ?? null;
}

function relativeChange(before: unknown, after: unknown): number | null {
    if (typeof before !== 'number' || typeof after !== 'number' || before === 0) return null;
    return roundTo(((after - before) / before) * 100, 2);
}

function add(
    changes: ProductChange[],
    type: ChangeType,
    field: string,
    before: unknown,
    after: unknown,
    withPercent = false,
): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    changes.push({ type, field, before, after, percentChange: withPercent ? relativeChange(before, after) : null });
}

/**
 * A product observation is location-specific. Keep this key aligned with the
 * product dedupe key so a Los Angeles price can never become the baseline for
 * a New York check of the same ASIN.
 */
export function historyKey(marketplace: string, asin: string, resolvedPostalCode: string | null): string {
    return `${marketplace}|${asin}|${locationKey(resolvedPostalCode)}`;
}

const TRUSTED_STATUSES = {
    pricing: new Set<FieldStatus>([FIELD_STATUS.EXTRACTED, FIELD_STATUS.OUT_OF_STOCK]),
    availability: new Set<FieldStatus>([FIELD_STATUS.EXTRACTED]),
    buyBox: new Set<FieldStatus>([FIELD_STATUS.EXTRACTED, FIELD_STATUS.NOT_PRESENT]),
    offers: new Set<FieldStatus>([FIELD_STATUS.EXTRACTED, FIELD_STATUS.NOT_PRESENT]),
    rankings: new Set<FieldStatus>([FIELD_STATUS.EXTRACTED, FIELD_STATUS.NOT_PRESENT]),
    ratings: new Set<FieldStatus>([FIELD_STATUS.EXTRACTED, FIELD_STATUS.NOT_PRESENT]),
} as const;

type ComparableBlock = keyof typeof TRUSTED_STATUSES;

function statusAt(record: UnknownRecord, block: ComparableBlock): FieldStatus | null {
    const value = path(record, block, 'status');
    return typeof value === 'string' ? value as FieldStatus : null;
}

function comparable(
    block: ComparableBlock,
    currentStatus: FieldStatus,
    previous: UnknownRecord,
    warnings: string[],
): boolean {
    const trusted = TRUSTED_STATUSES[block] as ReadonlySet<FieldStatus>;
    const previousStatus = statusAt(previous, block);
    const reasons: string[] = [];
    if (!trusted.has(currentStatus)) reasons.push(`CURRENT_${currentStatus}`);
    if (previousStatus === null) reasons.push('PREVIOUS_STATUS_MISSING');
    else if (!trusted.has(previousStatus)) reasons.push(`PREVIOUS_${previousStatus}`);
    if (reasons.length === 0) return true;
    warnings.push(`COMPARISON_SUPPRESSED:${block}:${reasons.join(',')}`);
    return false;
}

export function compareProduct(
    current: ProductRecord,
    previous: UnknownRecord | undefined,
    previousDatasetId: string,
): MonitoringBlock {
    if (previous === undefined || previous.status !== 'SUCCESS') {
        return {
            requested: true,
            compared: false,
            previousDatasetId,
            previousScrapedAt: null,
            changed: false,
            changes: [],
            warnings: ['COMPARISON_NOT_AVAILABLE:NO_MATCHING_PREVIOUS_OBSERVATION'],
            status: FIELD_STATUS.NOT_PRESENT,
        };
    }

    const changes: ProductChange[] = [];
    const warnings: string[] = [];

    if (comparable('pricing', current.pricing.status, previous, warnings)) {
        const beforePrice = path(previous, 'pricing', 'currentPrice', 'amount');
        const afterPrice = current.pricing.currentPrice?.amount ?? null;
        const beforeCurrency = path(previous, 'pricing', 'currentPrice', 'currency');
        const afterCurrency = current.pricing.currentPrice?.currency ?? null;
        const bothPricesPresent = typeof beforePrice === 'number' && typeof afterPrice === 'number';
        if (bothPricesPresent && beforeCurrency !== afterCurrency) {
            warnings.push('COMPARISON_SUPPRESSED:pricing.currentPrice:CURRENCY_MISMATCH');
        } else {
            add(changes, 'PRICE_CHANGED', 'pricing.currentPrice.amount', beforePrice, afterPrice, true);
        }
        add(changes, 'DISCOUNT_CHANGED', 'pricing.discountPercent', path(previous, 'pricing', 'discountPercent'), current.pricing.discountPercent, true);

        const beforeCoupon = path(previous, 'pricing', 'coupon');
        const afterCoupon = current.pricing.coupon;
        if (beforeCoupon == null && afterCoupon != null) add(changes, 'COUPON_ADDED', 'pricing.coupon', beforeCoupon, afterCoupon);
        else if (beforeCoupon != null && afterCoupon == null) add(changes, 'COUPON_REMOVED', 'pricing.coupon', beforeCoupon, afterCoupon);
        else if (beforeCoupon != null || afterCoupon != null) add(changes, 'DISCOUNT_CHANGED', 'pricing.coupon', beforeCoupon, afterCoupon);
    }

    if (comparable('availability', current.availability.status, previous, warnings)) {
        const beforeAvailability = path(previous, 'availability', 'state');
        const afterAvailability = current.availability.state;
        if (beforeAvailability !== afterAvailability) {
            if (afterAvailability === 'OUT_OF_STOCK') add(changes, 'OUT_OF_STOCK', 'availability.state', beforeAvailability, afterAvailability);
            else if (beforeAvailability === 'OUT_OF_STOCK' && afterAvailability === 'IN_STOCK') add(changes, 'BACK_IN_STOCK', 'availability.state', beforeAvailability, afterAvailability);
        }
    }

    if (comparable('buyBox', current.buyBox.status, previous, warnings)) {
        const previousBuyBox = path(previous, 'buyBox', 'sellerId') ?? path(previous, 'buyBox', 'seller');
        const currentBuyBox = current.buyBox.sellerId ?? current.buyBox.seller;
        add(changes, 'BUY_BOX_CHANGED', 'buyBox.seller', previousBuyBox, currentBuyBox);
    }

    if (current.offers.requested === true && path(previous, 'offers', 'requested') === true) {
        if (comparable('offers', current.offers.status, previous, warnings)) {
            const previousSellerCount = path(previous, 'offers', 'totalCount')
                ?? (Array.isArray(path(previous, 'offers', 'items')) ? (path(previous, 'offers', 'items') as unknown[]).length : null);
            const currentSellerCount = current.offers.totalCount ?? current.offers.items.length;
            add(changes, 'SELLER_COUNT_CHANGED', 'offers.totalCount', previousSellerCount, currentSellerCount, true);
        }
    }
    if (comparable('rankings', current.rankings.status, previous, warnings)) {
        add(changes, 'BSR_CHANGED', 'rankings.mainBSR', path(previous, 'rankings', 'mainBSR'), current.rankings.mainBSR, true);
    }
    if (comparable('ratings', current.ratings.status, previous, warnings)) {
        add(changes, 'RATING_CHANGED', 'ratings.rating', path(previous, 'ratings', 'rating'), current.ratings.rating, true);
        add(changes, 'REVIEW_COUNT_CHANGED', 'ratings.reviewCount', path(previous, 'ratings', 'reviewCount'), current.ratings.reviewCount, true);
    }

    return {
        requested: true,
        compared: true,
        previousDatasetId,
        previousScrapedAt: typeof previous.scrapedAt === 'string' ? previous.scrapedAt : null,
        changed: changes.length > 0,
        changes,
        warnings,
        status: FIELD_STATUS.EXTRACTED,
    };
}
