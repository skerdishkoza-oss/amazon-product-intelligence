/**
 * Price extraction. Spec v1.1 sections 6.2, 9.6.
 *
 * Multiple ordered strategies, first EXTRACTED wins, and the winning strategy
 * is recorded in `priceSource` so a customer can tell a Buy Box price from a
 * deal badge or a JSON-LD offer.
 *
 * The hard rule from the spec: never guess a price from unrelated
 * currency-looking strings on the page. Every strategy here is anchored to a
 * container that Amazon uses only for the price it claims to be.
 */

import { toMoney, type MoneyInternal } from '../../types/money.js';
import { FIELD_STATUS } from '../../types/status.js';
import type { Coupon, PriceSource, PricingBlock } from '../../types/output.js';
import { discountAmount, discountPercent } from '../../types/money.js';
import { extractFirstMoney } from '../number-parse.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { clean, extractJsonLd, firstText, load, type Dom } from './dom.js';

interface PriceHit {
    money: MoneyInternal;
    source: PriceSource;
}

/** Current/"price to pay" strategies, most specific first. */
const CURRENT_PRICE_SELECTORS: Array<{ selectors: string[]; source: PriceSource }> = [
    {
        source: 'CORE_PRICE_DISPLAY',
        selectors: [
            '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
            '#corePriceDisplay_desktop_feature_div span.aok-offscreen',
            '#corePriceDisplay_mobile_feature_div .priceToPay .a-offscreen',
            '#corePrice_feature_div .priceToPay .a-offscreen',
            '#corePrice_feature_div .a-price .a-offscreen',
            '#apex_desktop .priceToPay .a-offscreen',
            '#apex_desktop .a-price .a-offscreen',
        ],
    },
    {
        source: 'DEAL_PRICE',
        selectors: ['#priceblock_dealprice', '#priceblock_saleprice', '#dealprice_feature_div .a-offscreen'],
    },
    {
        source: 'BUY_BOX',
        selectors: [
            '#price_inside_buybox',
            '#newBuyBoxPrice',
            '#buybox .a-price .a-offscreen',
            '#priceblock_ourprice',
            '#tp_price_block_total_price_ww .a-offscreen',
        ],
    },
];

const LIST_PRICE_SELECTORS = [
    '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen',
    '#corePriceDisplay_desktop_feature_div span[data-a-strike="true"] .a-offscreen',
    '#corePrice_feature_div .basisPrice .a-offscreen',
    '#apex_desktop span[data-a-strike="true"] .a-offscreen',
    '.a-price.a-text-price[data-a-strike="true"] .a-offscreen',
    '#listPrice',
    '#priceblock_listprice',
];

const SNS_SELECTORS = ['#sns-base-price', '#snsPrice .a-offscreen', '#sns-tiered-price .a-offscreen'];

const UNIT_PRICE_SELECTORS = [
    '#corePriceDisplay_desktop_feature_div .pricePerUnit',
    '#corePrice_feature_div .pricePerUnit',
    '.a-price + .a-size-small.a-color-price',
    '#per-unit-price',
];

const COUPON_SELECTORS = [
    '#promoPriceBlockMessage .couponLabelText',
    '#couponTextpctch',
    '#couponBadgeRegularVpc',
    '#vpcButton .a-color-success',
    '.promoPriceBlockMessage .a-color-success',
    'label[id^="couponText"]',
];

const DEAL_BADGE_SELECTORS = ['#dealBadge', '.dealBadge', '#deal_badge_inner_div', '.a-badge-label-inner .a-badge-text'];

function fromSelectors($: Dom, selectors: string[], cfg: MarketplaceConfig): MoneyInternal | null {
    const hit = firstText($, selectors);
    if (hit === null) return null;
    return extractFirstMoney(hit.text, cfg);
}

/** JSON-LD offers, when Amazon ships them. Stable but often absent. */
function fromJsonLd($: Dom, cfg: MarketplaceConfig): MoneyInternal | null {
    for (const node of extractJsonLd($)) {
        const offers = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const candidates = Array.isArray(offers) ? offers : offers ? [offers] : [];
        for (const offer of candidates) {
            const price = offer.price ?? offer.lowPrice;
            const currency = typeof offer.priceCurrency === 'string' ? offer.priceCurrency : cfg.currency;
            if (currency !== cfg.currency) continue;
            if (typeof price === 'number' && Number.isFinite(price)) {
                return {
                    minor: Math.round(price * cfg.currencyScale),
                    currency: cfg.currency,
                    raw: String(price),
                    scale: cfg.currencyScale,
                };
            }
            if (typeof price === 'string') {
                // JSON-LD prices are machine-readable (dot decimal) regardless of locale.
                const numeric = Number(price.replace(/,/g, ''));
                if (Number.isFinite(numeric)) {
                    return {
                        minor: Math.round(numeric * cfg.currencyScale),
                        currency: cfg.currency,
                        raw: price,
                        scale: cfg.currencyScale,
                    };
                }
            }
        }
    }
    return null;
}

function parseCoupon($: Dom, cfg: MarketplaceConfig): Coupon | null {
    const hit = firstText($, COUPON_SELECTORS);
    if (hit === null) return null;
    const text = hit.text;
    const pctMatch = /(\d{1,3})\s*%/.exec(text);
    if (pctMatch?.[1]) {
        return { text, type: 'PERCENT', percent: Number(pctMatch[1]), amount: null };
    }
    const amount = extractFirstMoney(text, cfg);
    if (amount !== null) {
        return { text, type: 'AMOUNT', percent: null, amount: toMoney(amount) };
    }
    return { text, type: 'UNKNOWN', percent: null, amount: null };
}

/**
 * Out-of-stock pages legitimately have no price. Returning OUT_OF_STOCK rather
 * than PARSER_MISS is the whole point of the two-enum status model: the user
 * must be able to tell "Amazon showed no price" from "we failed to read one".
 */
function looksOutOfStock($: Dom, cfg: MarketplaceConfig): boolean {
    if ($('#outOfStock').length > 0) return true;
    const availability = clean($('#availability').text());
    if (availability === null) return false;
    const lower = availability.toLowerCase();
    const oos = cfg.labels.availability.find((a) => a.state === 'OUT_OF_STOCK');
    return (oos?.patterns ?? []).some((p) => lower.includes(p.toLowerCase()));
}

export function parsePricing(html: string, cfg: MarketplaceConfig, dom?: Dom): PricingBlock {
    const $ = dom ?? load(html);
    const warnings: string[] = [];

    let hit: PriceHit | null = null;
    for (const group of CURRENT_PRICE_SELECTORS) {
        const found = fromSelectors($, group.selectors, cfg);
        if (found !== null) {
            hit = { money: found, source: group.source };
            break;
        }
    }
    if (hit === null) {
        const jsonLd = fromJsonLd($, cfg);
        if (jsonLd !== null) {
            hit = { money: jsonLd, source: 'JSON_LD' };
            warnings.push('price found only in JSON-LD');
        }
    }

    const listPrice = fromSelectors($, LIST_PRICE_SELECTORS, cfg);
    const sns = fromSelectors($, SNS_SELECTORS, cfg);
    const unitPriceHit = firstText($, UNIT_PRICE_SELECTORS);
    const dealBadge = firstText($, DEAL_BADGE_SELECTORS);
    const coupon = parseCoupon($, cfg);

    if (hit === null) {
        const status = looksOutOfStock($, cfg) ? FIELD_STATUS.OUT_OF_STOCK : FIELD_STATUS.PARSER_MISS;
        return {
            currentPrice: null,
            listPrice: listPrice === null ? null : toMoney(listPrice),
            discountAmount: null,
            discountPercent: null,
            dealPrice: null,
            dealType: dealBadge?.text ?? null,
            coupon,
            subscribeAndSave: sns === null ? null : toMoney(sns),
            unitPrice: unitPriceHit?.text ?? null,
            priceSource: null,
            status,
        };
    }

    // A "list price" below the current price is a mis-read, not a discount.
    const validList = listPrice !== null && listPrice.minor > hit.money.minor ? listPrice : null;
    if (listPrice !== null && validList === null) {
        warnings.push('discarded a list price that was not above the current price');
    }

    return {
        currentPrice: toMoney(hit.money),
        listPrice: validList === null ? null : toMoney(validList),
        discountAmount: validList === null ? null : toMoney(discountAmount(validList, hit.money)),
        discountPercent: validList === null ? null : discountPercent(validList, hit.money),
        dealPrice: hit.source === 'DEAL_PRICE' ? toMoney(hit.money) : null,
        dealType: dealBadge?.text ?? null,
        coupon,
        subscribeAndSave: sns === null ? null : toMoney(sns),
        unitPrice: unitPriceHit?.text ?? null,
        priceSource: hit.source,
        status: FIELD_STATUS.EXTRACTED,
    };
}

export function pricingWarnings(block: PricingBlock): string[] {
    const out: string[] = [];
    if (block.status === FIELD_STATUS.PARSER_MISS) out.push('PRICE_PARSER_MISS');
    if (block.priceSource === 'JSON_LD') out.push('PRICE_FROM_JSON_LD');
    return out;
}
