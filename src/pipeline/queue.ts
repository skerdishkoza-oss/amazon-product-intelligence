/**
 * Work items and the run queue. Spec v1.1 sections 4.1, 10.3.
 *
 * The queue is mutable because discovery adds work mid-run: a keyword expands
 * into product items, and a variation parent in `full` mode expands into child
 * items. Anything added here is registered with the accounting ledger at the
 * same moment, so a discovered item can never escape the invariant.
 */

import type { DiscoverySource, InputRef, MarketplaceCode } from '../types/output.js';
import type { FailureReason } from '../types/status.js';

export type WorkKind = 'PRODUCT' | 'SEARCH';

export interface WorkItem {
    kind: WorkKind;
    /** Accounting key. For products: marketplace|asin|locationKey. */
    key: string;
    ref: InputRef;
    marketplace: MarketplaceCode;
    asin: string | null;
    /** Product URL, or the first search page URL. */
    url: string;
    /** Search keyword, when this item is a keyword rather than a URL. */
    keyword?: string | null;
    /** All places this item came from. Sources are merged while the item is queued. */
    discoveries?: DiscoverySource[];
    /** Set when the item is unusable and must be emitted as INVALID_INPUT. */
    invalidReason?: FailureReason;
    /** True for items created by discovery rather than requested by the user. */
    derived?: boolean;
}

export class WorkQueue {
    private readonly items: WorkItem[] = [];
    private readonly seen = new Set<string>();
    private readonly byKey = new Map<string, WorkItem>();

    /** Returns false when the key is already known, so callers can skip registering. */
    push(item: WorkItem): boolean {
        const existing = this.byKey.get(item.key);
        if (existing !== undefined) {
            mergeDiscoveries(existing, item.discoveries ?? []);
            return false;
        }
        this.seen.add(item.key);
        this.byKey.set(item.key, item);
        this.items.push(item);
        return true;
    }

    mergeDiscoveries(key: string, sources: DiscoverySource[]): boolean {
        const existing = this.byKey.get(key);
        if (existing === undefined) return false;
        mergeDiscoveries(existing, sources);
        return true;
    }

    /** Search items go first: discovery has to run before the ceiling fills up. */
    shift(): WorkItem | undefined {
        const searchIndex = this.items.findIndex((i) => i.kind === 'SEARCH');
        if (searchIndex >= 0) return this.items.splice(searchIndex, 1)[0];
        return this.items.shift();
    }

    has(key: string): boolean {
        return this.seen.has(key);
    }

    hasKind(kind: WorkKind): boolean {
        return this.items.some((item) => item.kind === kind);
    }

    get length(): number {
        return this.items.length;
    }

    remaining(): WorkItem[] {
        return [...this.items];
    }
}

function mergeDiscoveries(item: WorkItem, sources: DiscoverySource[]): void {
    const target = item.discoveries ?? (item.discoveries = []);
    for (const source of sources) {
        const duplicate = target.some(
            (current) => current.type === source.type
                && current.value === source.value
                && current.page === source.page
                && current.position === source.position,
        );
        if (!duplicate) target.push(source);
    }
}
