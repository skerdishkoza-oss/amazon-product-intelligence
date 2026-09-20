/**
 * Product page parser. Spec v1.1 sections 4.2, 9.6.
 *
 * Composes the field strategies. Each block reports its own status, so a page
 * that yields a title and a price but no BSR produces a SUCCESS record whose
 * rankings block says exactly why the rank is absent -- the distinction the
 * whole product promise rests on (spec 5.3).
 *
 * A page that yields no critical field at all is PARSER_ERROR at the record
 * level rather than a success full of nulls.
 */

import { getMarketplace } from '../marketplace-config/index.js';
import type {
    AvailabilityBlock,
    BuyBoxBlock,
    MarketplaceCode,
    MediaBlock,
    PageType,
    PricingBlock,
    ProductContentBlock,
    RankingsBlock,
    RatingsBlock,
    VariantMode,
    VariantsBlock,
} from '../../types/output.js';
import { FIELD_STATUS, type FieldStatus } from '../../types/status.js';
import { parseAvailability } from './availability.js';
import { parseRankings } from './bsr.js';
import { parseBuyBox } from './buybox.js';
import { parseContent } from './content.js';
import { load } from './dom.js';
import { parseIdentity } from './identity.js';
import { parseMedia } from './media.js';
import { parsePricing } from './price.js';
import { parseRatings } from './ratings.js';
import { parseVariants } from './variants.js';

export interface ProductPageParseResult {
    asin: string | null;
    parentAsin: string | null;
    title: string | null;
    brand: string | null;
    pricing: PricingBlock;
    availability: AvailabilityBlock;
    rankings: RankingsBlock;
    ratings: RatingsBlock;
    buyBox: BuyBoxBlock;
    variants: VariantsBlock | null;
    product: ProductContentBlock;
    media: MediaBlock;
    warnings: string[];
    hasAnyCriticalField: boolean;
}

export interface ProductPageParseArgs {
    html: string;
    url: string;
    marketplace: MarketplaceCode;
    variantMode: VariantMode;
    maxVariants?: number;
    pageType?: PageType;
}

/**
 * Each strategy runs through this wrapper so a thrown selector error degrades
 * that one field to PARSER_MISS instead of failing the record. Per the parser
 * contract a throw is a test failure; the warning is what surfaces it in QA
 * rather than hiding it.
 */
function safely<T>(label: string, fn: () => T, fallback: (status: FieldStatus) => T, warnings: string[]): T {
    try {
        return fn();
    } catch (err) {
        warnings.push(`PARSER_THREW:${label}:${(err as Error).message}`);
        return fallback(FIELD_STATUS.PARSER_MISS);
    }
}

export function parseProductPage(args: ProductPageParseArgs): ProductPageParseResult {
    const cfg = getMarketplace(args.marketplace);
    const $ = load(args.html);
    const warnings: string[] = [];

    const identity = safely(
        'identity',
        () => parseIdentity(args.html, $),
        () => ({ asin: null, parentAsin: null, title: null, brand: null }),
        warnings,
    );

    const pricing = safely('price', () => parsePricing(args.html, cfg, $), emptyPricingWith, warnings);
    const availability = safely('availability', () => parseAvailability(args.html, cfg, $), emptyAvailabilityWith, warnings);
    const rankings = safely('bsr', () => parseRankings(args.html, cfg, $), emptyRankingsWith, warnings);
    const ratings = safely(
        'ratings',
        () => parseRatings(args.html, cfg, $),
        (s) => ({ rating: null, reviewCount: null, starDistribution: null, status: s }),
        warnings,
    );
    const buyBox = safely('buybox', () => parseBuyBox(args.html, cfg, $), emptyBuyBoxWith, warnings);
    const product = safely('content', () => parseContent(args.html, cfg, $), emptyContentWith, warnings);
    const media = safely(
        'media',
        () => parseMedia(args.html, $),
        (s) => ({ mainImage: null, images: [], videos: [], status: s }),
        warnings,
    );
    const variants = safely(
        'variants',
        () => parseVariants({ html: args.html, mode: args.variantMode, maxVariants: args.maxVariants ?? 50, dom: $ }),
        (s) => ({ mode: args.variantMode, dimensions: [], items: [], truncated: false, status: s }),
        warnings,
    );

    if (pricing.status === FIELD_STATUS.PARSER_MISS) warnings.push('PRICE_PARSER_MISS');
    if (pricing.priceSource === 'JSON_LD') warnings.push('PRICE_FROM_JSON_LD');
    if (availability.status === FIELD_STATUS.PARSER_MISS && availability.availabilityText !== null) {
        // Unrecognized localized phrasing: preserve it so QA extends the
        // marketplace config rather than patching a parser.
        warnings.push(`AVAILABILITY_UNRECOGNIZED:${availability.availabilityText.slice(0, 60)}`);
    }
    if (variants.truncated) warnings.push(`VARIANTS_TRUNCATED_AT_${variants.truncatedAt ?? 0}`);

    // A record needs one identity field plus one substantive field to be worth
    // emitting and charging for.
    const hasIdentity = identity.title !== null || identity.asin !== null;
    const hasSubstance =
        pricing.status === FIELD_STATUS.EXTRACTED ||
        pricing.status === FIELD_STATUS.OUT_OF_STOCK ||
        availability.status === FIELD_STATUS.EXTRACTED ||
        ratings.status === FIELD_STATUS.EXTRACTED ||
        rankings.status === FIELD_STATUS.EXTRACTED ||
        product.status === FIELD_STATUS.EXTRACTED;

    return {
        asin: identity.asin,
        parentAsin: identity.parentAsin,
        title: identity.title,
        brand: identity.brand,
        pricing,
        availability,
        rankings,
        ratings,
        buyBox,
        variants,
        product,
        media,
        warnings,
        hasAnyCriticalField: hasIdentity && hasSubstance,
    };
}

/* Local fallbacks, kept here rather than imported from record-builder to avoid
 * a cycle: record-builder builds records, parsers build blocks. */

function emptyPricingWith(status: FieldStatus): PricingBlock {
    return {
        currentPrice: null,
        listPrice: null,
        discountAmount: null,
        discountPercent: null,
        dealPrice: null,
        dealType: null,
        coupon: null,
        subscribeAndSave: null,
        unitPrice: null,
        priceSource: null,
        status,
    };
}

function emptyAvailabilityWith(status: FieldStatus): AvailabilityBlock {
    return {
        state: 'UNKNOWN',
        inStock: null,
        availabilityText: null,
        stockLeftText: null,
        deliveryDate: null,
        deliveryText: null,
        shippingPrice: null,
        primeEligible: null,
        shipsFrom: null,
        soldBy: null,
        status,
    };
}

function emptyRankingsWith(status: FieldStatus): RankingsBlock {
    return {
        mainBSR: null,
        mainBSRCategory: null,
        all: [],
        boughtInPastMonthRaw: null,
        boughtInPastMonthMin: null,
        source: null,
        status,
    };
}

function emptyBuyBoxWith(status: FieldStatus): BuyBoxBlock {
    return {
        present: false,
        seller: null,
        sellerId: null,
        price: null,
        shipsFrom: null,
        fulfillment: 'UNKNOWN',
        amazonIsSeller: null,
        status,
    };
}

function emptyContentWith(status: FieldStatus): ProductContentBlock {
    return {
        bullets: [],
        description: null,
        specifications: {},
        technicalDetails: {},
        manufacturer: null,
        model: null,
        partNumber: null,
        productType: null,
        breadcrumb: [],
        dimensions: null,
        packageDimensions: null,
        weight: null,
        dateFirstAvailable: null,
        aPlusContent: null,
        badges: [],
        status,
    };
}
