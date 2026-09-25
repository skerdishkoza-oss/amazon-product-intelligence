import type { MarketplaceConfig } from './types.js';

export const FR: MarketplaceConfig = {
    code: 'FR',
    host: 'www.amazon.fr',
    locale: 'fr-FR',
    language: 'fr_FR',
    currency: 'EUR',
    currencyScale: 100,
    numberFormat: {
        decimalSeparator: ',',
        thousandsSeparator: ' ',
        currencySymbols: ['€', 'EUR'],
    },
    labels: {
        bsr: ['Classement des meilleures ventes d’Amazon', "Classement des meilleures ventes d'Amazon", 'Classement parmi les meilleures ventes'],
        categoryPathSeparator: ' en ',
        availability: [
            { state: 'OUT_OF_STOCK', patterns: ['actuellement indisponible', 'rupture de stock', 'indisponible'] },
            { state: 'LIMITED_STOCK', patterns: ['il ne reste plus que', 'plus que'] },
            { state: 'PREORDER', patterns: ['précommandez', 'précommande'] },
            { state: 'BACKORDER', patterns: ['habituellement expédié sous'] },
            { state: 'IN_STOCK', patterns: ['en stock', 'disponible'] },
        ],
        soldBy: ['Vendu par', 'Expédié et vendu par'],
        shipsFrom: ['Expédié par'],
        notFound: ['page introuvable', "cette page n'existe pas", 'cette page est indisponible'],
        challenge: [
            'saisissez les caractères que vous voyez ci-dessous',
            "nous voulons simplement nous assurer que vous n'êtes pas un robot",
            'accès automatisé aux données amazon',
        ],
        noResults: ['aucun résultat', 'aucun resultat'],
        boughtInPastMonth: ['achetés au cours du mois dernier', 'acheté au cours du mois dernier'],
        demandMultipliers: [
            { suffix: 'k', factor: 1000 },
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
