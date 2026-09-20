/**
 * Buy Box. Spec v1.1 section 6.9.
 *
 * Absence of a Buy Box is a real state, not a failure: `present: false` with
 * NOT_PRESENT. Sellers care about exactly this distinction.
 */

import type { BuyBoxBlock, Fulfillment } from '../../types/output.js';
import { toMoney } from '../../types/money.js';
import { FIELD_STATUS } from '../../types/status.js';
import { extractFirstMoney } from '../number-parse.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { clean, extractJsString, firstAttr, firstText, load, matchesLabel, type Dom } from './dom.js';

const BUYBOX_PRICE_SELECTORS = [
    '#price_inside_buybox',
    '#newBuyBoxPrice',
    '#buybox .a-price .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
];

const SELLER_NAME_SELECTORS = [
    '#sellerProfileTriggerId',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"] span',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Verkauft von"] span',
    '#merchant-info a',
    '#merchant-info',
    '#bylineInfo_feature_div #sellerProfileTriggerId',
];

const SHIPS_FROM_SELECTORS = [
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Ships from"] span',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Dispatches from"] span',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Versand durch"] span',
    '#fulfillerInfoFeature_feature_div .offer-display-feature-text-message',
];

const AMAZON_NAMES = ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon', 'amazon.com services', 'amazon eu'];

function sellerIdFrom($: Dom, html: string): string | null {
    const href = firstAttr($, ['#sellerProfileTriggerId', '#merchant-info a', 'a[href*="seller="]'], 'href');
    if (href !== null) {
        const m = /[?&](?:seller|me)=([A-Z0-9]{10,20})/i.exec(href.value);
        if (m?.[1]) return m[1];
    }
    const input = firstAttr($, ['input#merchantID', 'input[name="merchantID"]'], 'value');
    if (input !== null) return input.value;
    return extractJsString(html, 'merchantID');
}

function fulfillmentOf(seller: string | null, shipsFrom: string | null, amazonIsSeller: boolean): Fulfillment {
    if (amazonIsSeller) return 'AMZ';
    const shipper = (shipsFrom ?? '').toLowerCase();
    if (shipper === '') return seller === null ? 'UNKNOWN' : 'FBM';
    // Third-party seller with Amazon shipping the item is FBA; shipping it
    // themselves is FBM. This is the classification sellers repricing against
    // competitors actually need.
    return AMAZON_NAMES.some((n) => shipper.includes(n)) ? 'FBA' : 'FBM';
}

export function parseBuyBox(html: string, cfg: MarketplaceConfig, dom?: Dom): BuyBoxBlock {
    const $ = dom ?? load(html);

    const hasBuyBoxContainer = $('#buybox, #desktop_buybox, #tabular-buybox, #addToCart_feature_div, #corePriceDisplay_desktop_feature_div').length > 0;
    const outOfStock = $('#outOfStock').length > 0;

    const priceHit = firstText($, BUYBOX_PRICE_SELECTORS);
    const price = priceHit === null ? null : extractFirstMoney(priceHit.text, cfg);

    const sellerHit = firstText($, SELLER_NAME_SELECTORS);
    let seller = sellerHit?.text ?? null;
    if (seller !== null) {
        const matched = matchesLabel(seller, [...cfg.labels.soldBy, ...cfg.labels.shipsFrom]);
        if (matched !== null) {
            const idx = seller.toLowerCase().indexOf(matched.toLowerCase());
            seller = clean(seller.slice(idx + matched.length).replace(/^[:\uFF1A\s]+/, '')) ?? seller;
        }
    }

    const shipsFromHit = firstText($, SHIPS_FROM_SELECTORS);
    const shipsFrom = shipsFromHit?.text ?? null;
    const sellerId = sellerIdFrom($, html);

    const amazonIsSeller =
        seller === null ? null : AMAZON_NAMES.some((n) => seller.toLowerCase().includes(n));

    if (!hasBuyBoxContainer || (outOfStock && price === null && seller === null)) {
        return {
            present: false,
            seller: null,
            sellerId: null,
            price: null,
            shipsFrom: null,
            fulfillment: 'UNKNOWN',
            amazonIsSeller: null,
            status: FIELD_STATUS.NOT_PRESENT,
        };
    }

    if (price === null && seller === null) {
        return {
            present: false,
            seller: null,
            sellerId,
            price: null,
            shipsFrom,
            fulfillment: 'UNKNOWN',
            amazonIsSeller: null,
            status: FIELD_STATUS.PARSER_MISS,
        };
    }

    return {
        present: true,
        seller,
        sellerId,
        price: price === null ? null : toMoney(price),
        shipsFrom,
        fulfillment: fulfillmentOf(seller, shipsFrom, amazonIsSeller === true),
        amazonIsSeller,
        status: FIELD_STATUS.EXTRACTED,
    };
}
