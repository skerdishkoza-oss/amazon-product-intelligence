import type { MarketplaceConfig } from './types.js';

export const IT: MarketplaceConfig = {
    code: 'IT',
    host: 'www.amazon.it',
    locale: 'it-IT',
    language: 'it_IT',
    currency: 'EUR',
    currencyScale: 100,
    numberFormat: {
        decimalSeparator: ',',
        thousandsSeparator: '.',
        currencySymbols: ['€', 'EUR'],
    },
    labels: {
        bsr: ['Posizione nella classifica Bestseller di Amazon', 'Classifica Bestseller di Amazon'],
        categoryPathSeparator: ' in ',
        availability: [
            { state: 'OUT_OF_STOCK', patterns: ['attualmente non disponibile', 'esaurito', 'non disponibile'] },
            { state: 'LIMITED_STOCK', patterns: ['disponibilità: solo', 'solo'] },
            { state: 'PREORDER', patterns: ['pre-ordina', 'preordine'] },
            { state: 'BACKORDER', patterns: ['generalmente spedito entro'] },
            { state: 'IN_STOCK', patterns: ['disponibilità immediata', 'disponibile', 'in stock'] },
        ],
        soldBy: ['Venduto da', 'Spedito e venduto da'],
        shipsFrom: ['Spedizione da', 'Spedito da'],
        notFound: ['pagina non trovata', 'questa pagina non è disponibile'],
        challenge: [
            'inserisci i caratteri che vedi qui sotto',
            'vogliamo solo assicurarci che tu non sia un robot',
            'accesso automatizzato ai dati amazon',
        ],
        noResults: ['nessun risultato'],
        boughtInPastMonth: ['acquistati nel mese scorso', 'acquistato nel mese scorso'],
        demandMultipliers: [
            { suffix: 'mila', factor: 1000 },
            { suffix: 'K', factor: 1000 },
            { suffix: 'Mln', factor: 1_000_000 },
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
