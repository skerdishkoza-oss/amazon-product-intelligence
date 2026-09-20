/**
 * Images and video. Spec v1.1 section 6.6.
 *
 * Never downloads binaries. Image URLs are normalized to the highest available
 * resolution variant: Amazon encodes the transform in the filename, so
 * `._AC_SX300_.jpg` and `._AC_SL1500_.jpg` are the same asset at two sizes and
 * a customer almost always wants the large one.
 */

import type { MediaBlock } from '../../types/output.js';
import { FIELD_STATUS } from '../../types/status.js';
import { extractJsonBlob, firstAttr, load, type Dom } from './dom.js';

const MAIN_IMAGE_SELECTORS = ['#landingImage', '#imgTagWrapperId img', '#main-image-container img', '#ebooksImgBlkFront'];

/** Strip the size transform so the CDN serves the original. */
export function maxResolution(url: string): string {
    return url.replace(/\._[A-Z0-9_,]+_\.(jpg|jpeg|png|gif|webp)/i, '.$1');
}

interface ColorImage {
    hiRes?: string | null;
    large?: string | null;
    thumb?: string | null;
    variant?: string;
}

export function parseMedia(html: string, dom?: Dom): MediaBlock {
    const $ = dom ?? load(html);
    const images: string[] = [];

    const push = (url: string | null | undefined): void => {
        if (typeof url !== 'string' || url === '') return;
        if (!/^https?:\/\//.test(url)) return;
        const normalized = maxResolution(url);
        if (!images.includes(normalized)) images.push(normalized);
    };

    // Preferred source: the colorImages JS blob carries every gallery asset at
    // full resolution, which the DOM thumbnails do not.
    const colorImages = extractJsonBlob(html, 'colorImages') as { initial?: ColorImage[] } | null;
    if (colorImages?.initial) {
        for (const entry of colorImages.initial) push(entry.hiRes ?? entry.large ?? entry.thumb);
    }

    if (images.length === 0) {
        const dynamic = firstAttr($, MAIN_IMAGE_SELECTORS, 'data-a-dynamic-image');
        if (dynamic !== null) {
            try {
                const parsed = JSON.parse(dynamic.value) as Record<string, [number, number]>;
                const sorted = Object.entries(parsed).sort((a, b) => (b[1]?.[0] ?? 0) - (a[1]?.[0] ?? 0));
                for (const [url] of sorted) push(url);
            } catch {
                /* attribute is occasionally malformed; fall through to src */
            }
        }
    }

    const srcHit = firstAttr($, MAIN_IMAGE_SELECTORS, 'src');
    if (srcHit !== null) push(srcHit.value);

    $('#altImages li img, #imageBlockThumbs img').each((_, el) => push($(el).attr('src')));

    const videos: string[] = [];
    const videoBlob = extractJsonBlob(html, 'videos') as Array<{ url?: string; slateUrl?: string }> | null;
    if (Array.isArray(videoBlob)) {
        for (const v of videoBlob) {
            if (typeof v.url === 'string' && /^https?:\/\//.test(v.url) && !videos.includes(v.url)) videos.push(v.url);
        }
    }

    return {
        mainImage: images[0] ?? null,
        images,
        videos,
        status: images.length > 0 ? FIELD_STATUS.EXTRACTED : FIELD_STATUS.PARSER_MISS,
    };
}
