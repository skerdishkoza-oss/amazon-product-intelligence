import type { DataBlock } from '../types/input.js';
import type { ProductRecord } from '../types/output.js';
import { FIELD_STATUS } from '../types/status.js';
import {
    emptyAvailability,
    emptyBuyBox,
    emptyMedia,
    emptyOffers,
    emptyPricing,
    emptyProductContent,
    emptyRankings,
    emptyRatings,
    emptySellerProfiles,
    emptyVariants,
} from './record-builder.js';

/** Keep the output contract stable while making non-purchased blocks explicit. */
export function projectRecordToBlocks(record: ProductRecord, requestedBlocks: readonly DataBlock[]): ProductRecord {
    const requested = new Set<DataBlock>(requestedBlocks);
    const omitted = FIELD_STATUS.NOT_APPLICABLE;
    if (!requested.has('pricing')) record.pricing = emptyPricing(omitted);
    if (!requested.has('availability')) record.availability = emptyAvailability(omitted);
    if (!requested.has('ratings')) record.ratings = emptyRatings(omitted);
    if (!requested.has('rankings')) record.rankings = emptyRankings(omitted);
    if (!requested.has('buyBox')) record.buyBox = emptyBuyBox(omitted);
    if (!requested.has('variants')) record.variants = emptyVariants('none', omitted);
    if (!requested.has('product')) record.product = emptyProductContent(omitted);
    if (!requested.has('media')) record.media = emptyMedia(omitted);
    if (!requested.has('offers')) record.offers = emptyOffers(false, omitted);
    if (!requested.has('sellerProfiles')) record.sellerProfiles = emptySellerProfiles(false, omitted);
    return record;
}
