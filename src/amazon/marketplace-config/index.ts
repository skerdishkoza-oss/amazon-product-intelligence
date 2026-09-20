import type { MarketplaceCode } from '../../types/output.js';
import { DE } from './de.js';
import type { MarketplaceConfig } from './types.js';
import { UK } from './uk.js';
import { US } from './us.js';

export type { MarketplaceConfig } from './types.js';

const REGISTRY: Record<MarketplaceCode, MarketplaceConfig> = { US, UK, DE };

/** Host -> marketplace, for classifying user-supplied URLs. */
const BY_HOST: Record<string, MarketplaceCode> = {
    'amazon.com': 'US',
    'www.amazon.com': 'US',
    'smile.amazon.com': 'US',
    'amazon.co.uk': 'UK',
    'www.amazon.co.uk': 'UK',
    'amazon.de': 'DE',
    'www.amazon.de': 'DE',
};

export const SUPPORTED_MARKETPLACES = Object.keys(REGISTRY) as MarketplaceCode[];

export function getMarketplace(code: MarketplaceCode): MarketplaceConfig {
    const cfg = REGISTRY[code];
    if (!cfg) throw new Error(`unsupported marketplace: ${code}`);
    return cfg;
}

export function isSupportedMarketplace(code: string): code is MarketplaceCode {
    return Object.prototype.hasOwnProperty.call(REGISTRY, code);
}

/** Returns null for a host we do not support yet, e.g. amazon.fr in V1. */
export function marketplaceFromHost(host: string): MarketplaceCode | null {
    return BY_HOST[host.toLowerCase()] ?? null;
}

export { DE, UK, US };
