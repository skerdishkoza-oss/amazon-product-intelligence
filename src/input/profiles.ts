import type { DataBlock, DataProfile } from '../types/input.js';

export const DATA_BLOCKS: readonly DataBlock[] = [
    'pricing',
    'availability',
    'ratings',
    'rankings',
    'buyBox',
    'variants',
    'product',
    'media',
    'offers',
    'sellerProfiles',
] as const;

export const ESSENTIAL_BLOCKS: readonly DataBlock[] = [
    'pricing',
    'availability',
    'ratings',
] as const;

export const CATALOG_BLOCKS: readonly DataBlock[] = [
    ...ESSENTIAL_BLOCKS,
    'rankings',
    'buyBox',
    'variants',
    'product',
    'media',
] as const;

export const COMPETITIVE_BLOCKS: readonly DataBlock[] = [
    ...CATALOG_BLOCKS,
    'offers',
    'sellerProfiles',
] as const;

const PROFILE_BLOCKS: Record<Exclude<DataProfile, 'custom'>, readonly DataBlock[]> = {
    essential: ESSENTIAL_BLOCKS,
    catalog: CATALOG_BLOCKS,
    competitive: COMPETITIVE_BLOCKS,
};

export function resolveDataBlocks(args: {
    profile: DataProfile;
    customBlocks: DataBlock[];
    includeOffers: boolean;
    includeSellerDetails: boolean;
}): DataBlock[] {
    const selected = args.profile === 'custom'
        ? args.customBlocks
        : PROFILE_BLOCKS[args.profile];
    const blocks = new Set<DataBlock>(selected);
    if (args.includeOffers) blocks.add('offers');
    if (args.includeSellerDetails) blocks.add('sellerProfiles');
    return DATA_BLOCKS.filter((block) => blocks.has(block));
}

/** Offers and seller profiles have their own events; this classifies the base product payload. */
export function usesEssentialProductEvent(blocks: readonly DataBlock[]): boolean {
    const essential = new Set<DataBlock>(ESSENTIAL_BLOCKS);
    return blocks.every((block) => block === 'offers' || block === 'sellerProfiles' || essential.has(block));
}

export function includesBlock(blocks: readonly DataBlock[], block: DataBlock): boolean {
    return blocks.includes(block);
}
