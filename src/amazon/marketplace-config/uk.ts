import type { MarketplaceConfig } from './types.js';

export const UK: MarketplaceConfig = {
    code: 'UK',
    host: 'www.amazon.co.uk',
    locale: 'en-GB',
    language: 'en_GB',
    currency: 'GBP',
    currencyScale: 100,
    numberFormat: {
        decimalSeparator: '.',
        thousandsSeparator: ',',
        currencySymbols: ['£', 'GBP'],
    },
    labels: {
        bsr: ['Best Sellers Rank', 'Amazon Bestsellers Rank'],
        categoryPathSeparator: ' in ',
        availability: [
            { state: 'OUT_OF_STOCK', patterns: ['currently unavailable', 'out of stock'] },
            { state: 'LIMITED_STOCK', patterns: ['only', 'left in stock'] },
            { state: 'PREORDER', patterns: ['pre-order'] },
            { state: 'BACKORDER', patterns: ['usually dispatched within', 'on backorder'] },
            { state: 'IN_STOCK', patterns: ['in stock'] },
        ],
        soldBy: ['Sold by', 'Dispatches from and sold by'],
        shipsFrom: ['Dispatches from', 'Ships from'],
        notFound: ['page not found', 'looking for something?'],
        challenge: ['enter the characters you see below', 'to discuss automated access to amazon data'],
        boughtInPastMonth: ['bought in past month'],
        demandMultipliers: [
            { suffix: 'K', factor: 1000 },
            { suffix: 'M', factor: 1_000_000 },
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
        offers: '/gp/product/ajax/ref=dp_aod_ALL_mbc?asin={asin}',
        bestsellers: '/gp/bestsellers',
    },
};
