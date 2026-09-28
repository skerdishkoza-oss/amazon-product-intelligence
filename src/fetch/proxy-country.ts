import type { MarketplaceCode } from '../types/output.js';
import type { RunMode } from '../types/input.js';

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

/**
 * Automatic datacenter proxy groups do not necessarily have country-specific
 * exits. Only apply an inferred country to a residential primary group; an
 * explicit user choice is always preserved.
 */
export function proxyCountryForPrimary(
    marketplace: MarketplaceCode,
    groups: readonly string[],
    explicitCountry?: string,
): string | undefined {
    const normalized = explicitCountry?.trim().toUpperCase();
    if (normalized && normalized.length > 0) return normalized;
    return groups.some((group) => group.toUpperCase() === 'RESIDENTIAL')
        ? MARKETPLACE_PROXY_COUNTRY[marketplace]
        : undefined;
}

/**
 * Full product modes favor reliable residential acquisition by default. Fast
 * discovery retains the cheaper automatic tier. An explicit group selection
 * always wins, and disabling residential fallback also disables this default.
 */
export function proxyGroupsForRun(
    configuredGroups: readonly string[],
    mode: RunMode,
    allowResidential: boolean,
): string[] {
    if (configuredGroups.length > 0) return [...configuredGroups];
    return mode !== 'fast' && allowResidential ? ['RESIDENTIAL'] : [];
}
