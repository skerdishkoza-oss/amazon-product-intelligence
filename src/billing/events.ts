/**
 * Spec v1.1 section 8.2 (C7, C8).
 *
 * Everything that can charge money goes through this module. Scraping code
 * calls a domain method such as chargeProductDetail(record) and never touches
 * the charging API, so prices and pricing models can change without editing a
 * single parser.
 *
 * Two rules are enforced here rather than trusted to callers:
 *
 *   1. Only a SUCCESS record can produce a charge. The guard derives from
 *      types/status.ts, so adding a new failure status cannot accidentally make
 *      it billable.
 *   2. When the user's max-total-charge is reached, charging stops and the run
 *      is told to wind down. Ignoring that signal means doing unpaid work.
 *
 * Note on the platform config: the synthetic `apify-default-dataset-item` event
 * must be removed or zero-priced in the Actor's monetization settings. This
 * Actor writes failure rows to the default dataset by design (spec 5.4), so
 * leaving that event enabled would bill users for BLOCKED and FETCH_FAILED
 * rows and violate Appendix C. No code here can prevent that; it is a console
 * setting, and 8.4's pre-publish gate checks it.
 */

import { isBillable, type RecordStatus } from '../types/status.js';

export const BILLING_EVENT = {
    PRODUCT_BASIC: 'product-basic',
    PRODUCT_DETAIL: 'product-detail',
    VARIANT_DETAIL: 'variant-detail',
    OFFER: 'offer',
    SELLER_DETAIL: 'seller-detail',
    PRODUCT_CHECK: 'product-check',
} as const;

export type BillingEventName = (typeof BILLING_EVENT)[keyof typeof BILLING_EVENT];

export interface ChargeOutcome {
    charged: boolean;
    eventName: BillingEventName;
    count: number;
    chargedCount: number;
    /** True once the user's configured cap has been hit. */
    capReached: boolean;
    reason?: 'NOT_BILLABLE_STATUS' | 'CAP_REACHED' | 'BACKEND_ERROR' | 'DRY_RUN';
}

/** The platform-facing seam. ApifyChargingBackend wraps Actor.charge(). */
export interface ChargingBackend {
    charge(eventName: BillingEventName, count: number): Promise<{ capReached: boolean; chargedCount: number }>;
}

/** Used in tests and in local runs with no monetization configured. */
export class NoopChargingBackend implements ChargingBackend {
    readonly calls: Array<{ eventName: BillingEventName; count: number }> = [];

    constructor(private readonly capAfter = Number.POSITIVE_INFINITY) {}

    async charge(eventName: BillingEventName, count: number): Promise<{ capReached: boolean; chargedCount: number }> {
        this.calls.push({ eventName, count });
        const requestedBefore = this.calls.slice(0, -1).reduce((a, c) => a + c.count, 0);
        const remaining = Math.max(0, this.capAfter - requestedBefore);
        const chargedCount = Math.min(count, remaining);
        return { capReached: chargedCount < count || requestedBefore + chargedCount >= this.capAfter, chargedCount };
    }
}

export class BillingEvents {
    private capReached = false;
    private successfulEvents = 0;
    private failedEvents = 0;
    private readonly perEvent = new Map<BillingEventName, number>();

    constructor(
        private readonly backend: ChargingBackend,
        private readonly log: (msg: string, data?: unknown) => void = () => {},
    ) {}

    /**
     * The only path to a charge. `status` is taken from the record itself, not
     * from the caller's intent.
     */
    private async chargeFor(
        eventName: BillingEventName,
        status: RecordStatus,
        count = 1,
    ): Promise<ChargeOutcome> {
        if (!isBillable(status)) {
            return { charged: false, eventName, count, chargedCount: 0, capReached: this.capReached, reason: 'NOT_BILLABLE_STATUS' };
        }
        if (this.capReached) {
            return { charged: false, eventName, count, chargedCount: 0, capReached: true, reason: 'CAP_REACHED' };
        }
        try {
            const { capReached, chargedCount } = await this.backend.charge(eventName, count);
            this.successfulEvents += chargedCount;
            this.perEvent.set(eventName, (this.perEvent.get(eventName) ?? 0) + chargedCount);
            if (capReached) {
                this.capReached = true;
                this.log('charge cap reached; winding down the run', { eventName });
            }
            return {
                charged: chargedCount === count,
                eventName,
                count,
                chargedCount,
                capReached,
                ...(chargedCount === count ? {} : { reason: 'CAP_REACHED' as const }),
            };
        } catch (err) {
            this.failedEvents += count;
            this.log('charge failed', { eventName, error: (err as Error).message });
            return { charged: false, eventName, count, chargedCount: 0, capReached: this.capReached, reason: 'BACKEND_ERROR' };
        }
    }

    chargeProductBasic(status: RecordStatus): Promise<ChargeOutcome> {
        return this.chargeFor(BILLING_EVENT.PRODUCT_BASIC, status);
    }

    chargeProductDetail(status: RecordStatus): Promise<ChargeOutcome> {
        return this.chargeFor(BILLING_EVENT.PRODUCT_DETAIL, status);
    }

    chargeVariantDetail(status: RecordStatus, count = 1): Promise<ChargeOutcome> {
        return this.chargeFor(BILLING_EVENT.VARIANT_DETAIL, status, count);
    }

    chargeOffers(status: RecordStatus, count = 1): Promise<ChargeOutcome> {
        return this.chargeFor(BILLING_EVENT.OFFER, status, count);
    }

    chargeSellerDetail(status: RecordStatus): Promise<ChargeOutcome> {
        return this.chargeFor(BILLING_EVENT.SELLER_DETAIL, status);
    }

    /**
     * Monitoring: fires even when nothing changed, because the acquisition work
     * happened either way (spec 7.3). Still requires a SUCCESS check.
     */
    chargeProductCheck(status: RecordStatus): Promise<ChargeOutcome> {
        return this.chargeFor(BILLING_EVENT.PRODUCT_CHECK, status);
    }

    /** The run loop polls this and stops scheduling new work when true. */
    isCapReached(): boolean {
        return this.capReached;
    }

    stats(): { successfulPaidEvents: number; failedPaidEvents: number; byEvent: Record<string, number> } {
        return {
            successfulPaidEvents: this.successfulEvents,
            failedPaidEvents: this.failedEvents,
            byEvent: Object.fromEntries(this.perEvent),
        };
    }
}
