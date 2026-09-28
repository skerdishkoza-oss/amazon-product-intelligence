import type { MarketplaceCode } from '../types/output.js';

/** ISO 3166-1 country used for proxy geolocation for each Amazon marketplace. */
const MARKETPLACE_PROXY_COUNTRY: Record<MarketplaceCode, string> = {
    US: 'US',
    UK: 'GB',
    DE: 'DE',
    FR: 'FR',
    IT: 'IT',
    ES: 'ES',
    CA: 'CA',
};

/**
 * Keep Amazon's rendered currency and catalogue aligned with the requested
 * marketplace. A caller-supplied proxy country remains authoritative.
 */
export function proxyCountryForMarketplace(marketplace: MarketplaceCode, explicitCountry?: string): string {
    const normalized = explicitCountry?.trim().toUpperCase();
    return normalized && normalized.length > 0 ? normalized : MARKETPLACE_PROXY_COUNTRY[marketplace];
}
