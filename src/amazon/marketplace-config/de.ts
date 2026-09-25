import type { MarketplaceConfig } from './types.js';

/**
 * DE renders 1.234,56 -- the decimal separator is a comma and the thousands
 * separator is a period. A parser written for US formatting returns 1.23 from
 * that string, and the record still looks entirely plausible. This is the
 * single most dangerous silent failure in the Actor (C5).
 */
export const DE: MarketplaceConfig = {
    code: 'DE',
    host: 'www.amazon.de',
    locale: 'de-DE',
    language: 'de_DE',
    currency: 'EUR',
    currencyScale: 100,
    numberFormat: {
        decimalSeparator: ',',
        thousandsSeparator: '.',
        currencySymbols: ['€', 'EUR'],
    },
    labels: {
        bsr: ['Amazon Bestseller-Rang', 'Bestseller-Rang', 'Amazon Bestseller Rang'],
        categoryPathSeparator: ' in ',
        availability: [
            { state: 'OUT_OF_STOCK', patterns: ['derzeit nicht verfügbar', 'nicht auf lager', 'nicht verfügbar'] },
            { state: 'LIMITED_STOCK', patterns: ['nur noch'] },
            { state: 'PREORDER', patterns: ['vorbestellen', 'vorbestellung'] },
            { state: 'BACKORDER', patterns: ['gewöhnlich versandfertig in'] },
            { state: 'IN_STOCK', patterns: ['auf lager', 'verfügbar'] },
        ],
        soldBy: ['Verkauf durch', 'Verkauf und Versand durch'],
        shipsFrom: ['Versand durch'],
        notFound: ['seite nicht gefunden', 'diese seite ist nicht verfügbar'],
        challenge: [
            'geben sie die zeichen unten ein',
            'wir möchten nur sicherstellen, dass sie kein roboter sind',
            'automatisierten zugriff auf amazon-daten',
        ],
        noResults: ['keine ergebnisse', 'keine resultate'],
        boughtInPastMonth: ['mal im letzten monat gekauft', 'im letzten monat gekauft'],
        demandMultipliers: [
            { suffix: 'Tsd', factor: 1000 },
            { suffix: 'Mio', factor: 1_000_000 },
            { suffix: 'K', factor: 1000 },
        ],
    },
    location: {
        method: 'SESSION_COOKIE',
        applyPath: '/portal-migration/hz/glow/address-change',
        confirmSelectors: ['#glow-ingress-line2', '#nav-global-location-slot'],
    },
    paths: {
        product: '/dp/{asin}',
        search: '/s?k={keyword}',
        offers: '/gp/product/ajax/ref=aod_f_new?asin={asin}&pc=dp&experienceId=aodAjaxMain',
        bestsellers: '/gp/bestsellers',
    },
};
