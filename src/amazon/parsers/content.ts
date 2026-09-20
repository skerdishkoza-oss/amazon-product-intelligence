/** Product content and specifications. Spec v1.1 section 6.5. */

import type { ProductContentBlock } from '../../types/output.js';
import { FIELD_STATUS } from '../../types/status.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { clean, extractKeyValueTable, firstText, load, lookupLabel, type Dom } from './dom.js';

const BULLET_SELECTORS = [
    '#feature-bullets li:not(.aok-hidden) span.a-list-item',
    '#featurebullets_feature_div li span.a-list-item',
    '#productFactsDesktop_feature_div li span',
];

const DESCRIPTION_SELECTORS = ['#productDescription p', '#productDescription', '#bookDescription_feature_div'];

const SPEC_TABLES = [
    '#productDetails_techSpec_section_1',
    '#productDetails_techSpec_section_2',
    '#technicalSpecifications_section_1',
    '#productDetails_detailBullets_sections1',
    '#detailBullets_feature_div',
    '#detailBulletsWrapper_feature_div',
    '#prodDetails table',
    '#poExpander table',
    '#productOverview_feature_div table',
];

const BADGE_SELECTORS = ['#climatePledgeFriendlyBadge', '.climate-pledge-friendly-badge', '#zeitgeistBadge_feature_div', '.badge-wrapper .a-badge-text'];

const LABELS = {
    manufacturer: ['Manufacturer', 'Hersteller'],
    model: ['Item model number', 'Model', 'Modellnummer', 'Modell'],
    partNumber: ['Part Number', 'Teilenummer', 'Artikelnummer'],
    productType: ['Product type', 'Produkttyp'],
    dimensions: ['Product Dimensions', 'Produktabmessungen', 'Item Dimensions'],
    packageDimensions: ['Package Dimensions', 'Verpackungsabmessungen'],
    weight: ['Item Weight', 'Artikelgewicht', 'Weight', 'Gewicht'],
    dateFirstAvailable: ['Date First Available', 'Im Angebot von Amazon.de seit', 'Im Angebot seit'],
};

export function parseContent(html: string, cfg: MarketplaceConfig, dom?: Dom): ProductContentBlock {
    const $ = dom ?? load(html);

    const bullets: string[] = [];
    for (const selector of BULLET_SELECTORS) {
        $(selector).each((_, el) => {
            const text = clean($(el).text());
            if (text !== null && text.length > 1 && !bullets.includes(text)) bullets.push(text);
        });
        if (bullets.length > 0) break;
    }

    const descriptionHit = firstText($, DESCRIPTION_SELECTORS);
    const specifications = extractKeyValueTable($, SPEC_TABLES);

    const breadcrumb: string[] = [];
    $('#wayfinding-breadcrumbs_feature_div li a, #nav-subnav .nav-a-content').each((_, el) => {
        const text = clean($(el).text());
        if (text !== null && !breadcrumb.includes(text)) breadcrumb.push(text);
    });

    const badges: string[] = [];
    for (const selector of BADGE_SELECTORS) {
        $(selector).each((_, el) => {
            const text = clean($(el).text());
            if (text !== null && !badges.includes(text)) badges.push(text);
        });
    }

    const aPlus = $('#aplus, #aplus_feature_div, #aplusBrandStory_feature_div').length > 0;

    const anything =
        bullets.length > 0 || descriptionHit !== null || Object.keys(specifications).length > 0 || breadcrumb.length > 0;

    return {
        bullets,
        description: descriptionHit?.text ?? null,
        specifications,
        technicalDetails: extractKeyValueTable($, ['#productDetails_techSpec_section_1', '#technicalSpecifications_section_1']),
        manufacturer: lookupLabel(specifications, LABELS.manufacturer),
        model: lookupLabel(specifications, LABELS.model),
        partNumber: lookupLabel(specifications, LABELS.partNumber),
        productType: lookupLabel(specifications, LABELS.productType),
        breadcrumb,
        dimensions: lookupLabel(specifications, LABELS.dimensions),
        packageDimensions: lookupLabel(specifications, LABELS.packageDimensions),
        weight: lookupLabel(specifications, LABELS.weight),
        dateFirstAvailable: lookupLabel(specifications, LABELS.dateFirstAvailable),
        aPlusContent: aPlus,
        badges,
        status: anything ? FIELD_STATUS.EXTRACTED : FIELD_STATUS.PARSER_MISS,
    };
}
