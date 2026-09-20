/** Bounded offer-list extraction. Spec 6.11. */

import type { Fulfillment, OfferCondition, OfferItem, OffersBlock } from '../../types/output.js';
import { money, toMoney, type MoneyInternal } from '../../types/money.js';
import { FIELD_STATUS } from '../../types/status.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { extractFirstMoney, parseCount } from '../number-parse.js';
import { clean, load, type Dom } from './dom.js';

const AMAZON_NAMES = ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca', 'amazon'];

function sellerIdFromHref(href: string | undefined): string | null {
    if (!href) return null;
    const match = /[?&](?:seller|me)=([A-Z0-9]{5,30})/i.exec(href);
    return match?.[1] ?? null;
}

function conditionOf(text: string | null): OfferCondition {
    const value = (text ?? '').toLowerCase();
    if (/refurbished|renewed|reconditionné|ricondizionato|reacondicionado/.test(value)) return 'REFURBISHED';
    if (/collectible|collection|collezione|coleccionable/.test(value)) return 'COLLECTIBLE';
    if (/used|occasion|usato|segunda mano/.test(value)) return 'USED';
    if (/new|neuf|nuovo|nuevo|neu/.test(value)) return 'NEW';
    return 'UNKNOWN';
}

function fulfillmentOf(sellerName: string | null, shipsFrom: string | null): Fulfillment {
    const seller = (sellerName ?? '').toLowerCase();
    const shipper = (shipsFrom ?? '').toLowerCase();
    if (AMAZON_NAMES.some((name) => seller.includes(name))) return 'AMZ';
    if (AMAZON_NAMES.some((name) => shipper.includes(name))) return 'FBA';
    return sellerName === null ? 'UNKNOWN' : 'FBM';
}

function sumMoney(item: MoneyInternal | null, shipping: MoneyInternal | null, freeShipping: boolean): ReturnType<typeof toMoney> | null {
    if (item === null) return null;
    if (shipping === null && !freeShipping) return null;
    const shippingMinor = shipping?.minor ?? 0;
    if (shipping && shipping.currency !== item.currency) return null;
    return toMoney(money(item.minor + shippingMinor, item.currency, `${item.raw} + ${shipping?.raw ?? 'free shipping'}`, item.scale));
}

export function parseOffers(args: {
    html: string;
    cfg: MarketplaceConfig;
    sourceUrl: string;
    maxOffers: number;
    dom?: Dom;
}): OffersBlock {
    const $ = args.dom ?? load(args.html);
    const nodes = $('#aod-pinned-offer, #aod-offer, .aod-information-block, [data-csa-c-content-id="aod-offer"]');
    const items: OfferItem[] = [];

    nodes.each((_, element) => {
        if (items.length >= args.maxOffers) return;
        const node = $(element);
        const priceRaw = clean(node.find('#aod-offer-price .a-offscreen, .a-price .a-offscreen').first().text());
        const itemPriceInternal = priceRaw === null ? null : extractFirstMoney(priceRaw, args.cfg);

        const shippingRaw = clean(node.find(
            '#aod-offer-shipping-price .a-offscreen, .aod-offer-shipping-price .a-offscreen, [data-csa-c-content-id="aod-offer-shipping-price"]',
        ).first().text());
        const shippingInternal = shippingRaw === null ? null : extractFirstMoney(shippingRaw, args.cfg);
        const wholeText = clean(node.text()) ?? '';
        const freeShipping = /free shipping|livraison gratuite|spedizione gratuita|envío gratis|kostenlose lieferung/i.test(wholeText);

        const sellerLink = node.find('#aod-offer-soldBy a, .aod-offer-soldBy a, [id*="soldBy"] a, a[href*="seller="]').first();
        const sellerName = clean(sellerLink.text())
            ?? clean(node.find('#aod-offer-soldBy, .aod-offer-soldBy, [id*="soldBy"]').first().text());
        const sellerId = sellerIdFromHref(sellerLink.attr('href'));
        const conditionText = clean(node.find('#aod-offer-heading, .aod-offer-heading, [id*="condition"]').first().text());
        const deliveryText = clean(node.find(
            '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE, .aod-delivery-promise, [data-csa-c-content-id*="delivery"]',
        ).first().text());
        const shipsFrom = clean(node.find('#aod-offer-shipsFrom, .aod-offer-shipsFrom, [id*="shipsFrom"] .a-size-small').first().text());
        const feedbackText = clean(node.find('#aod-offer-seller-rating, .aod-offer-seller-rating, [id*="seller-rating"]').first().text());
        const ratingMatch = feedbackText === null ? null : /([0-9]{1,3}(?:[.,][0-9]+)?)\s*%/.exec(feedbackText);
        const sellerRating = ratingMatch?.[1] ? Number(ratingMatch[1].replace(',', '.')) : null;
        const sellerFeedbackCount = feedbackText === null ? null : parseCount(feedbackText.replace(/^[^(]*\(/, '').replace(/\).*$/, ''), args.cfg);
        const itemPrice = itemPriceInternal === null ? null : toMoney(itemPriceInternal);
        const shippingPrice = shippingInternal === null
            ? freeShipping && itemPriceInternal !== null
                ? toMoney(money(0, itemPriceInternal.currency, shippingRaw ?? 'FREE', itemPriceInternal.scale))
                : null
            : toMoney(shippingInternal);

        // Ignore wrapper nodes that contain no offer value. Amazon sometimes
        // nests .aod-information-block inside #aod-offer.
        if (itemPrice === null && sellerName === null) return;
        const duplicate = items.some((offer) => offer.sellerId === sellerId
            && offer.sellerName === sellerName
            && offer.itemPrice?.amount === itemPrice?.amount);
        if (duplicate) return;

        items.push({
            sellerId,
            sellerName,
            condition: conditionOf(conditionText),
            itemPrice,
            shippingPrice,
            landedPrice: sumMoney(itemPriceInternal, shippingInternal, freeShipping),
            primeEligible: /prime/i.test(wholeText) || node.find('.a-icon-prime, [aria-label="Prime"]').length > 0,
            fulfillment: fulfillmentOf(sellerName, shipsFrom),
            deliveryText,
            sellerRating: Number.isFinite(sellerRating) ? sellerRating : null,
            sellerFeedbackCount,
            sourceUrl: args.sourceUrl,
            status: itemPrice !== null || sellerName !== null ? FIELD_STATUS.EXTRACTED : FIELD_STATUS.PARSER_MISS,
        });
    });

    const totalText = clean($('#aod-filter-offer-count-string, #aod-total-offer-count, [data-aod-offer-count]').first().text());
    const totalCount = totalText === null ? (items.length > 0 ? items.length : null) : parseCount(totalText, args.cfg);
    const recognizedPage = $('#aod-container, #all-offers-display, #aod-offer-list').length > 0;
    return {
        requested: true,
        totalCount,
        items,
        truncated: (totalCount ?? items.length) > items.length,
        status: items.length > 0
            ? FIELD_STATUS.EXTRACTED
            : recognizedPage
                ? FIELD_STATUS.NOT_PRESENT
                : FIELD_STATUS.PARSER_MISS,
    };
}
