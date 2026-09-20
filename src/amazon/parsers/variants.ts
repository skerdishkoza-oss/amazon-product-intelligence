/**
 * Variants. Spec v1.1 section 6.10 (C13). The major differentiator.
 *
 * Discovery reads the twister payload Amazon embeds in the parent product page.
 * That payload carries the option dimensions and the complete child-ASIN-to-
 * option mapping, so `discover` mode costs ZERO extra requests -- which is what
 * makes it includable in the base detail result while competitors either skip
 * variants or charge for a fetch per child.
 *
 * The payload does not carry reliable per-child price or stock. That is what
 * `price` and `full` modes are for, and why their per-child keys are absent
 * rather than null in `discover` output.
 */

import { FIELD_STATUS } from '../../types/status.js';
import type { VariantItem, VariantMode, VariantsBlock } from '../../types/output.js';
import { clean, extractJsonBlob, load, type Dom } from './dom.js';

/**
 * `dimensionValuesDisplayData` maps each child ASIN to its ordered option
 * values: { "B0CHILD001": ["Black", "Medium"] }.
 * `dimensionsDisplay` (or `variationDisplayLabels`) names the dimensions in the
 * same order: ["Color", "Size"].
 */
interface TwisterShape {
    dimensionValuesDisplayData?: Record<string, string[]>;
    dimensionsDisplay?: string[];
    variationDisplayLabels?: Record<string, string> | string[];
    dimensions?: string[];
    parentAsin?: string;
}

function readDimensionLabels(html: string): string[] | null {
    const display = extractJsonBlob(html, 'dimensionsDisplay');
    if (Array.isArray(display) && display.every((d) => typeof d === 'string')) return display as string[];

    const labels = extractJsonBlob(html, 'variationDisplayLabels');
    if (Array.isArray(labels) && labels.every((d) => typeof d === 'string')) return labels as string[];
    if (labels !== null && typeof labels === 'object') {
        const values = Object.values(labels as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
        if (values.length > 0) return values;
    }

    // `dimensions` holds internal keys like "color_name"; humanize them as a
    // last resort so the output is still usable.
    const raw = extractJsonBlob(html, 'dimensions');
    if (Array.isArray(raw) && raw.every((d) => typeof d === 'string')) {
        return (raw as string[]).map(humanizeDimension);
    }
    return null;
}

function humanizeDimension(key: string): string {
    return key
        .replace(/_name$/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function readMatrix(html: string): Record<string, string[]> | null {
    const blob = extractJsonBlob(html, 'dimensionValuesDisplayData');
    if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) return null;
    const out: Record<string, string[]> = {};
    for (const [asin, values] of Object.entries(blob as Record<string, unknown>)) {
        if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
        if (!Array.isArray(values)) continue;
        const strings = values.filter((v): v is string => typeof v === 'string');
        if (strings.length > 0) out[asin] = strings;
    }
    return Object.keys(out).length === 0 ? null : out;
}

/**
 * DOM fallback for layouts that render the twister as buttons carrying
 * `data-defaultasin` / `data-dp-url`, with no usable JS blob.
 */
function readFromDom($: Dom): { dimensions: string[]; items: VariantItem[] } | null {
    const dimensions: string[] = [];
    const byAsin = new Map<string, Record<string, string>>();

    $('#twister .a-row, #twister-plus-inline-twister .a-row, [id^="variation_"]').each((_, row) => {
        const container = $(row);
        const rawId = container.attr('id') ?? '';
        const label =
            clean(container.find('.a-form-label, .twisterTextDiv, .inline-twister-dim-title-value').first().text())?.replace(/[:\uFF1A]\s*$/, '') ??
            (rawId.startsWith('variation_') ? humanizeDimension(rawId.replace('variation_', '')) : null);
        if (label === null) return;
        if (!dimensions.includes(label)) dimensions.push(label);

        container.find('li[data-defaultasin], li[data-dp-url], .swatchAvailable, .swatchSelect').each((__, li) => {
            const el = $(li);
            const asin =
                el.attr('data-defaultasin')?.toUpperCase() ??
                /\/dp\/([A-Z0-9]{10})/.exec(el.attr('data-dp-url') ?? '')?.[1]?.toUpperCase() ??
                null;
            const value = clean(el.find('.a-button-text, .swatch-title-text').first().text()) ?? clean(el.attr('title'));
            if (asin === null || !/^[A-Z0-9]{10}$/.test(asin) || value === null) return;
            const existing = byAsin.get(asin) ?? {};
            existing[label] = value.replace(/^Click to select\s*/i, '');
            byAsin.set(asin, existing);
        });
    });

    if (byAsin.size === 0) return null;
    const items: VariantItem[] = [...byAsin.entries()].map(([asin, options]) => ({ asin, options }));
    return { dimensions, items };
}

export interface ParseVariantsArgs {
    html: string;
    mode: VariantMode;
    maxVariants: number;
    dom?: Dom;
}

export function parseVariants(args: ParseVariantsArgs): VariantsBlock {
    const { html, mode, maxVariants } = args;
    if (mode === 'none') {
        return { mode, dimensions: [], items: [], truncated: false, status: FIELD_STATUS.NOT_APPLICABLE };
    }

    const $ = args.dom ?? load(html);
    const matrix = readMatrix(html);
    let dimensions = readDimensionLabels(html) ?? [];
    let items: VariantItem[] = [];

    if (matrix !== null) {
        // Dimension count must match the option-array length, otherwise the
        // labels belong to a different twister and pairing them would produce
        // confidently wrong option names.
        const width = Math.max(...Object.values(matrix).map((v) => v.length));
        if (dimensions.length !== width) {
            dimensions = Array.from({ length: width }, (_, i) => dimensions[i] ?? `Option ${i + 1}`);
        }
        items = Object.entries(matrix).map(([asin, values]) => {
            const options: Record<string, string> = {};
            values.forEach((value, i) => {
                options[dimensions[i] ?? `Option ${i + 1}`] = value;
            });
            return { asin, options };
        });
    } else {
        const fromDom = readFromDom($);
        if (fromDom !== null) {
            dimensions = fromDom.dimensions.length > 0 ? fromDom.dimensions : dimensions;
            items = fromDom.items;
        }
    }

    if (items.length === 0) {
        // Most products are not variation parents. That is NOT_PRESENT, not a
        // parser failure -- reporting it as a miss would make the quality
        // metrics meaningless.
        const looksLikeParent = $('#twister, #twister-plus-inline-twister, [id^="variation_"]').length > 0;
        return {
            mode,
            dimensions: [],
            items: [],
            truncated: false,
            status: looksLikeParent ? FIELD_STATUS.PARSER_MISS : FIELD_STATUS.NOT_PRESENT,
        };
    }

    // Deterministic order so repeated runs of the same page produce identical
    // records (spec 12.2 requires exactly this).
    items.sort((a, b) => a.asin.localeCompare(b.asin));

    const truncated = items.length > maxVariants;
    const kept = truncated ? items.slice(0, maxVariants) : items;

    const block: VariantsBlock = {
        mode,
        dimensions,
        items: kept,
        truncated,
        status: FIELD_STATUS.EXTRACTED,
    };
    if (truncated) block.truncatedAt = maxVariants;
    return block;
}
