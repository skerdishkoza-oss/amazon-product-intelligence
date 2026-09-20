/**
 * Best Sellers Rank. Spec v1.1 section 6.8 (C20).
 *
 * Amazon places the rank in one of three different containers depending on
 * category and layout test, so all three are tried and the winner is recorded
 * in `source`. A product with no BSR is normal and common: that is NOT_PRESENT,
 * never PARSER_MISS, unless a rank label was found and the number could not be
 * read.
 */

import type { RankEntry, RankingSource, RankingsBlock } from '../../types/output.js';
import { FIELD_STATUS } from '../../types/status.js';
import { parseBoughtInPastMonth, parseCount } from '../number-parse.js';
import type { MarketplaceConfig } from '../marketplace-config/types.js';
import { clean, firstText, load, matchesLabel, type Dom } from './dom.js';

const SOURCES: Array<{ source: RankingSource; selectors: string[] }> = [
    { source: 'PRODUCT_DETAILS_TABLE', selectors: ['#productDetails_detailBullets_sections1', '#productDetails_db_sections', '#prodDetails'] },
    { source: 'DETAIL_BULLETS', selectors: ['#detailBulletsWrapper_feature_div', '#detailBullets_feature_div'] },
    { source: 'PRODUCT_INFORMATION', selectors: ['#productDetails_feature_div', '#SalesRank', '#detail-bullets'] },
];

const DEMAND_SELECTORS = [
    '#social-proofing-faceout-title-tk_bought',
    '#socialProofingAsinFaceout_feature_div',
    '.social-proofing-faceout-title-text',
    '#acrCustomerReviewText + span',
];

/**
 * A rank line looks like "#14 in Kitchen & Dining (See Top 100 ...)" or, on DE,
 * "Nr. 14 in Küche, Haushalt & Wohnen". Take the number, then the category text
 * up to the first parenthesis or line break.
 */
function parseRankLines(text: string, cfg: MarketplaceConfig): RankEntry[] {
    const entries: RankEntry[] = [];
    const rankRe = /(?:#|Nr\.?\s*)([\d.,\u00a0 ]+)\s*(?:in|en)\s+([^#(\n]{2,120})/gi;
    let match = rankRe.exec(text);
    while (match !== null) {
        const rank = parseCount(match[1] ?? '', cfg);
        const category = clean((match[2] ?? '').replace(/\(.*$/, '').replace(/\s*(?:See|Siehe)\b.*$/i, ''));
        if (rank !== null && rank > 0 && category !== null) entries.push({ rank, category });
        match = rankRe.exec(text);
    }
    return entries;
}

export function parseRankings(html: string, cfg: MarketplaceConfig, dom?: Dom): RankingsBlock {
    const $ = dom ?? load(html);

    let entries: RankEntry[] = [];
    let source: RankingSource | null = null;
    let sawLabel = false;

    for (const candidate of SOURCES) {
        for (const selector of candidate.selectors) {
            const container = $(selector);
            if (container.length === 0) continue;
            const text = clean(container.text());
            if (text === null) continue;
            if (matchesLabel(text, cfg.labels.bsr) === null) continue;
            sawLabel = true;
            const parsed = parseRankLines(text, cfg);
            if (parsed.length > 0) {
                entries = parsed;
                source = candidate.source;
                break;
            }
        }
        if (entries.length > 0) break;
    }

    const demandHit = firstText($, DEMAND_SELECTORS);
    const demandText =
        demandHit !== null && matchesLabel(demandHit.text, cfg.labels.boughtInPastMonth) !== null ? demandHit.text : null;
    const demandMin = demandText === null ? null : parseBoughtInPastMonth(demandText, cfg);

    if (entries.length === 0) {
        return {
            mainBSR: null,
            mainBSRCategory: null,
            all: [],
            boughtInPastMonthRaw: demandText,
            boughtInPastMonthMin: demandMin,
            source: null,
            // A rank label with no readable number is a miss; no label at all
            // means this product simply has no BSR.
            status: sawLabel ? FIELD_STATUS.PARSER_MISS : FIELD_STATUS.NOT_PRESENT,
        };
    }

    // The main BSR is the broadest category, which Amazon lists first.
    const main = entries[0]!;
    return {
        mainBSR: main.rank,
        mainBSRCategory: main.category,
        all: entries,
        boughtInPastMonthRaw: demandText,
        boughtInPastMonthMin: demandMin,
        source,
        status: FIELD_STATUS.EXTRACTED,
    };
}
