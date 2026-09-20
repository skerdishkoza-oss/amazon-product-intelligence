/** Public seller-profile extraction. Spec 6.12. */

import type { SellerFeedbackWindow, SellerProfile } from '../../types/output.js';
import { FIELD_STATUS } from '../../types/status.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { parseCount } from '../number-parse.js';
import { clean, extractKeyValueTable, firstText, load, type Dom } from './dom.js';

function percent(text: string, label: string): number | null {
    const match = new RegExp(`([0-9]{1,3}(?:[.,][0-9]+)?)\\s*%\\s*${label}`, 'i').exec(text);
    if (!match?.[1]) return null;
    const value = Number(match[1].replace(',', '.'));
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function feedbackWindow(text: string | null, cfg: MarketplaceConfig): SellerFeedbackWindow | null {
    if (text === null) return null;
    const positivePercent = percent(text, 'positive|positif|positiv|positivo|positiva');
    const neutralPercent = percent(text, 'neutral|neutre|neutro|neutrale');
    const negativePercent = percent(text, 'negative|négatif|negativ|negativo|negativa');
    const countMatch = /\(([0-9.,\s]+)\)/.exec(text);
    const count = countMatch?.[1] ? parseCount(countMatch[1], cfg) : null;
    if (positivePercent === null && neutralPercent === null && negativePercent === null && count === null) return null;
    return { positivePercent, neutralPercent, negativePercent, count };
}

function findValue(table: Record<string, string>, labels: string[]): string | null {
    for (const [key, value] of Object.entries(table)) {
        if (labels.some((label) => key.toLowerCase().includes(label))) return value;
    }
    return null;
}

export function sellerProfileUrl(cfg: MarketplaceConfig, sellerId: string): string {
    const url = new URL(`https://${cfg.host}/sp`);
    url.searchParams.set('seller', sellerId);
    return url.toString();
}

export function parseSellerProfile(args: {
    html: string;
    cfg: MarketplaceConfig;
    sellerId: string;
    sourceUrl: string;
    dom?: Dom;
}): SellerProfile {
    const $ = args.dom ?? load(args.html);
    const sellerName = firstText($, ['#sellerName', '#seller-profile-container h1', '[data-testid="seller-name"]'])?.text ?? null;
    const table = extractKeyValueTable($, [
        '#page-section-detail-seller-info',
        '#seller-profile-container',
        '[data-testid="seller-business-info"]',
    ]);
    const businessName = findValue(table, ['business name', 'nom commercial', 'unternehmensname', 'ragione sociale', 'nombre de empresa']);
    const businessAddress = findValue(table, ['business address', 'adresse commerciale', 'geschäftsadresse', 'indirizzo aziendale', 'dirección empresarial']);

    const summary = firstText($, ['#seller-feedback-summary', '#feedback-summary-table', '[data-testid="feedback-summary"]'])?.text ?? null;
    const ratingMatch = summary === null ? null : /([0-9]{1,3}(?:[.,][0-9]+)?)\s*%/.exec(summary);
    const rating = ratingMatch?.[1] ? Number(ratingMatch[1].replace(',', '.')) : null;
    const countMatch = summary === null ? null : /\(([0-9.,\s]+)\)/.exec(summary);
    const feedbackCount = countMatch?.[1] ? parseCount(countMatch[1], args.cfg) : null;

    const windowText = (selector: string): string | null => clean($(selector).first().text());
    const feedback30Days = feedbackWindow(windowText('[data-feedback-window="30"], #feedback-30-days'), args.cfg);
    const feedback90Days = feedbackWindow(windowText('[data-feedback-window="90"], #feedback-90-days'), args.cfg);
    const feedback365Days = feedbackWindow(windowText('[data-feedback-window="365"], #feedback-365-days'), args.cfg);

    const legalIdentifiers: Record<string, string> = {};
    for (const [key, value] of Object.entries(table)) {
        if (/vat|ust-id|iva|tva|partita|registro|register|siret|nif|cif/i.test(key)) legalIdentifiers[key] = value;
    }
    const extracted = sellerName !== null || businessName !== null || businessAddress !== null || feedbackCount !== null;

    return {
        sellerId: args.sellerId,
        sellerName,
        businessName,
        businessAddress,
        rating: Number.isFinite(rating) ? rating : null,
        feedbackCount,
        feedback30Days,
        feedback90Days,
        feedback365Days,
        legalIdentifiers,
        sourceUrl: args.sourceUrl,
        status: extracted ? FIELD_STATUS.EXTRACTED : FIELD_STATUS.PARSER_MISS,
    };
}
