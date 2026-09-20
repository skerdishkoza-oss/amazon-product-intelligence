/**
 * Apify-specific charging backend. The only file in the repo that knows the
 * platform's charging API exists (spec 8.2).
 */

import { Actor } from 'apify';
import type { BillingEventName, ChargingBackend } from './events.js';

export class ApifyChargingBackend implements ChargingBackend {
    async charge(eventName: BillingEventName, count: number): Promise<{ capReached: boolean; chargedCount: number }> {
        const result = await Actor.charge({ eventName, count });
        // The SDK reports how much of the user's cap is left. Treat "no further
        // charges possible" as the wind-down signal (C8).
        const remaining = (result as { eventChargeLimitReached?: boolean }).eventChargeLimitReached;
        return { capReached: remaining === true, chargedCount: result.chargedCount };
    }
}
