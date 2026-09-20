/**
 * Spec v1.1 section 9.2 (C5, C6).
 *
 * Everything marketplace-specific lives in these objects. If a parser contains
 * an English label or a hard-coded decimal point, that is a bug: DE and UK will
 * silently drop the field and the record will still look plausible.
 */

import type { AvailabilityState, MarketplaceCode } from '../../types/output.js';

export interface NumberFormat {
    decimalSeparator: '.' | ',';
    thousandsSeparator: '.' | ',' | ' ' | "'";
    /** Currency symbols and codes seen on this marketplace. Stripped before parsing. */
    currencySymbols: string[];
}

export interface LabelDictionary {
    /** Localized Best Sellers Rank labels (C6, C20). */
    bsr: string[];
    /** Separator between category path segments in a rank line. */
    categoryPathSeparator: string;
    /** Localized availability phrasings, longest-match-first within each state. */
    availability: Array<{ state: AvailabilityState; patterns: string[] }>;
    /** "sold by" / "ships from" style labels used by the Buy Box parser. */
    soldBy: string[];
    shipsFrom: string[];
    /** Phrases that identify a not-found / unavailable product page. */
    notFound: string[];
    /** Phrases that identify a bot challenge page. */
    challenge: string[];
    /** Phrases that identify a valid search page with zero matching products. */
    noResults: string[];
    /** "N bought in past month" style demand signal. */
    boughtInPastMonth: string[];
    /**
     * Localized magnitude suffixes for the demand signal: US/UK write "2K+",
     * DE writes "2Tsd.+". Without this, a German signal reads as 2 instead of
     * 2000 and looks entirely plausible.
     */
    demandMultipliers: Array<{ suffix: string; factor: number }>;
}

export interface LocationMechanism {
    method: 'SESSION_COOKIE' | 'QUERY_PARAM';
    /** Path used to apply a delivery location to the current session. */
    applyPath: string;
    /** Page selectors that report the currently applied location, checked in order. */
    confirmSelectors: string[];
}

export interface MarketplaceConfig {
    code: MarketplaceCode;
    host: string;
    locale: string;
    language: string;
    currency: string;
    /** Minor units per major unit. */
    currencyScale: number;
    numberFormat: NumberFormat;
    labels: LabelDictionary;
    location: LocationMechanism;
    /** Path templates. `{asin}` and `{keyword}` are substituted. */
    paths: {
        product: string;
        search: string;
        offers: string;
        bestsellers: string;
    };
}
