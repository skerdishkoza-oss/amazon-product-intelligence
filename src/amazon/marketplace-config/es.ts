import type { MarketplaceConfig } from './types.js';

export const ES: MarketplaceConfig = {
    code: 'ES',
    host: 'www.amazon.es',
    locale: 'es-ES',
    language: 'es_ES',
    currency: 'EUR',
    currencyScale: 100,
    numberFormat: {
        decimalSeparator: ',',
        thousandsSeparator: '.',
        currencySymbols: ['€', 'EUR'],
    },
    labels: {
        bsr: ['Clasificación en los más vendidos de Amazon', 'Clasificación de los más vendidos en Amazon'],
        categoryPathSeparator: ' en ',
        availability: [
            { state: 'OUT_OF_STOCK', patterns: ['no disponible por el momento', 'agotado', 'no disponible'] },
            { state: 'LIMITED_STOCK', patterns: ['solo queda', 'quedan solo'] },
            { state: 'PREORDER', patterns: ['resérvalo ya', 'precompra'] },
            { state: 'BACKORDER', patterns: ['normalmente se envía en'] },
            { state: 'IN_STOCK', patterns: ['en stock', 'disponible'] },
        ],
        soldBy: ['Vendido por', 'Envíos y vendido por', 'Enviado y vendido por'],
        shipsFrom: ['Envíos desde', 'Enviado desde'],
        notFound: ['página no encontrada', 'esta página no está disponible'],
        challenge: [
            'escribe los caracteres que ves a continuación',
            'solo queremos asegurarnos de que no eres un robot',
            'acceso automatizado a los datos de amazon',
        ],
        noResults: ['no hay resultados', 'ningún resultado'],
        boughtInPastMonth: ['comprados el mes pasado', 'comprado el mes pasado'],
        demandMultipliers: [
            { suffix: 'mil', factor: 1000 },
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
