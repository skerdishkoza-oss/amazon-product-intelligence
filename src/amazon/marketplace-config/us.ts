import type { MarketplaceConfig } from './types.js';

export const US: MarketplaceConfig = {
    code: 'US',
    host: 'www.amazon.com',
    locale: 'en-US',
    language: 'en_US',
    currency: 'USD',
    currencyScale: 100,
    numberFormat: {
        decimalSeparator: '.',
        thousandsSeparator: ',',
        currencySymbols: ['$', 'USD', 'US$'],
    },
    labels: {
        bsr: ['Best Sellers Rank', 'Amazon Best Sellers Rank'],
        categoryPathSeparator: ' in ',
        availability: [
            { state: 'OUT_OF_STOCK', patterns: ['currently unavailable', 'out of stock', 'temporarily out of stock'] },
            { state: 'LIMITED_STOCK', patterns: ['only', 'left in stock'] },
            { state: 'PREORDER', patterns: ['pre-order', 'available for pre-order'] },
            { state: 'BACKORDER', patterns: ['usually ships within', 'on backorder'] },
            { state: 'IN_STOCK', patterns: ['in stock', 'available now'] },
        ],
        soldBy: ['Sold by', 'Ships from and sold by'],
        shipsFrom: ['Ships from', 'Dispatches from'],
        notFound: [
            "we're sorry. the web address you entered is not a functioning page",
            'page not found',
            'looking for something?',
        ],
        challenge: [
            'enter the characters you see below',
            "sorry, we just need to make sure you're not a robot",
            'to discuss automated access to amazon data',
        ],
        noResults: ['no results for', 'we need a little more information to find what you searched for'],
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
        offers: '/gp/product/ajax/ref=aod_f_new?asin={asin}&pc=dp&experienceId=aodAjaxMain',
        bestsellers: '/gp/bestsellers',
    },
};
