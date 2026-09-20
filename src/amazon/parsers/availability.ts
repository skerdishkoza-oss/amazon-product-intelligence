/**
 * Availability and delivery. Spec v1.1 section 6.3.
 *
 * The localized-label map lives in the marketplace config (C6): "Auf Lager" and
 * "In Stock" are the same state, and a parser that only knows English silently
 * reports UNKNOWN for every DE product.
 */

import type { AvailabilityBlock, AvailabilityState } from '../../types/output.js';
import { toMoney } from '../../types/money.js';
import { FIELD_STATUS, type FieldStatus } from '../../types/status.js';
import { extractFirstMoney } from '../number-parse.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { clean, firstText, load, matchesLabel, type Dom } from './dom.js';

const AVAILABILITY_SELECTORS = [
    '#availability .a-color-success',
    '#availability .a-color-price',
    '#availability .a-color-state',
    '#availability span',
    '#availability',
    '#outOfStock .a-color-price',
    '#exports_desktop_outOfStock_buybox_message_feature_div',
];

const DELIVERY_SELECTORS = [
    '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
    '#deliveryBlockMessage .a-text-bold',
    '#deliveryBlockMessage',
    '#mir-layout-DELIVERY_BLOCK',
    '#delivery-block',
    '#ddmDeliveryMessage',
    '[data-csa-c-delivery-time]',
];

const SHIPPING_SELECTORS = ['#deliveryBlockMessage .a-color-secondary', '#shippingMessageInsideBuyBox_feature_div', '#price-shipping-message'];

const SOLD_BY_SELECTORS = [
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"]',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Verkauft von"]',
    '#sellerProfileTriggerId',
    '#merchant-info',
];

const SHIPS_FROM_SELECTORS = [
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Ships from"]',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Dispatches from"]',
    '#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Versand durch"]',
    '#fulfillerInfoFeature_feature_div .offer-display-feature-text-message',
];

const STOCK_LEFT_SELECTORS = ['#availability .a-color-price', '#availability .a-color-state', '#availability span', '#availability'];

/** Longest pattern first inside each state, so "auf lager." beats "auf lager". */
function classify(text: string, cfg: MarketplaceConfig): AvailabilityState | null {
    const lower = text.toLowerCase();
    for (const entry of cfg.labels.availability) {
        const sorted = [...entry.patterns].sort((a, b) => b.length - a.length);
        for (const pattern of sorted) {
            if (lower.includes(pattern.toLowerCase())) return entry.state;
        }
    }
    return null;
}

function isPrime($: Dom): boolean | null {
    if ($('#primeSavingsBadge, #isPrimeExclusive, .a-icon-prime, #primeBadge_feature_div .a-icon-prime').length > 0) return true;
    // Absence of the badge is weak evidence, so report null rather than false
    // unless the delivery block exists and simply has no Prime marker.
    return $('#mir-layout-DELIVERY_BLOCK, #deliveryBlockMessage').length > 0 ? false : null;
}

export function parseAvailability(html: string, cfg: MarketplaceConfig, dom?: Dom): AvailabilityBlock {
    const $ = dom ?? load(html);

    const outOfStockNode = $('#outOfStock').length > 0;
    const availabilityHit = firstText($, AVAILABILITY_SELECTORS);
    const availabilityText = availabilityHit?.text ?? null;

    let state: AvailabilityState = 'UNKNOWN';
    let status: FieldStatus = FIELD_STATUS.PARSER_MISS;

    if (availabilityText !== null) {
        const classified = classify(availabilityText, cfg);
        if (classified !== null) {
            state = classified;
            status = FIELD_STATUS.EXTRACTED;
        } else {
            // Text present but unrecognized: a genuine parser miss, and the raw
            // text is preserved so QA can add the pattern to the config.
            status = FIELD_STATUS.PARSER_MISS;
        }
    } else if (outOfStockNode) {
        state = 'OUT_OF_STOCK';
        status = FIELD_STATUS.EXTRACTED;
    } else if ($('#availability').length === 0 && $('#buybox, #corePriceDisplay_desktop_feature_div').length > 0) {
        // Buy Box present with no availability node at all: Amazon omits it for
        // plainly in-stock items on some layouts.
        state = 'IN_STOCK';
        status = FIELD_STATUS.EXTRACTED;
    }

    const deliveryHit = firstText($, DELIVERY_SELECTORS);
    const shippingHit = firstText($, SHIPPING_SELECTORS);
    const shippingPrice = shippingHit === null ? null : extractFirstMoney(shippingHit.text, cfg);

    const soldByHit = firstText($, SOLD_BY_SELECTORS);
    const shipsFromHit = firstText($, SHIPS_FROM_SELECTORS);
    const stockLeftHit = firstText($, STOCK_LEFT_SELECTORS);

    return {
        state,
        inStock: status === FIELD_STATUS.EXTRACTED ? state === 'IN_STOCK' || state === 'LIMITED_STOCK' : null,
        availabilityText,
        stockLeftText: state === 'LIMITED_STOCK' ? (stockLeftHit?.text ?? null) : null,
        deliveryDate: deliveryHit === null ? null : extractDeliveryDate(deliveryHit.text),
        deliveryText: deliveryHit?.text ?? null,
        shippingPrice: shippingPrice === null ? null : toMoney(shippingPrice),
        primeEligible: isPrime($),
        shipsFrom: shipsFromHit === null ? null : stripLabel(shipsFromHit.text, cfg.labels.shipsFrom),
        soldBy: soldByHit === null ? null : stripLabel(soldByHit.text, cfg.labels.soldBy),
        status,
    };
}

/**
 * Keep the raw text; the date is a convenience field and stays a string rather
 * than a parsed Date, because Amazon's delivery wording is a promise window in
 * a local timezone, not an instant.
 */
const WEEKDAY =
    '(?:Mon|Tue|Tues|Wed|Wednes|Thu|Thur|Thurs|Fri|Sat|Satur|Sun)[a-z]*' +
    '|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag';

function extractDeliveryDate(text: string): string | null {
    const re = new RegExp(`((?:${WEEKDAY}),?\\s+(?:[A-Za-z\\u00c0-\\u024f]+\\s+)?\\d{1,2}(?:\\.|st|nd|rd|th)?)`);
    const m = re.exec(text);
    return clean(m?.[1]?.replace(/\.$/, '')) ?? null;
}

function stripLabel(text: string, labels: string[]): string {
    const matched = matchesLabel(text, labels);
    if (matched === null) return text;
    const idx = text.toLowerCase().indexOf(matched.toLowerCase());
    return clean(text.slice(idx + matched.length).replace(/^[:\uFF1A\s]+/, '')) ?? text;
}
