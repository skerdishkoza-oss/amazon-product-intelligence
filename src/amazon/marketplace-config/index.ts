import type { MarketplaceCode } from '../../types/output.js';
import { CA } from './ca.js';
import { DE } from './de.js';
import { ES } from './es.js';
import { FR } from './fr.js';
import { IT } from './it.js';
import type { MarketplaceConfig } from './types.js';
import { UK } from './uk.js';
import { US } from './us.js';

export type { MarketplaceConfig } from './types.js';

const REGISTRY: Record<MarketplaceCode, MarketplaceConfig> = { US, UK, DE, FR, IT, ES, CA };

/** Host -> marketplace, for classifying user-supplied URLs. */
const BY_HOST: Record<string, MarketplaceCode> = {
    'amazon.com': 'US',
    'www.amazon.com': 'US',
    'smile.amazon.com': 'US',
    'amazon.co.uk': 'UK',
    'www.amazon.co.uk': 'UK',
    'amazon.de': 'DE',
    'www.amazon.de': 'DE',
    'amazon.fr': 'FR',
    'www.amazon.fr': 'FR',
    'amazon.it': 'IT',
    'www.amazon.it': 'IT',
    'amazon.es': 'ES',
    'www.amazon.es': 'ES',
    'amazon.ca': 'CA',
    'www.amazon.ca': 'CA',
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

/** Returns null for a host outside the supported marketplace registry. */
export function marketplaceFromHost(host: string): MarketplaceCode | null {
    return BY_HOST[host.toLowerCase()] ?? null;
}

export { CA, DE, ES, FR, IT, UK, US };
