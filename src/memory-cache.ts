import type { RobotsTxtCache, RobotsTxtCacheEntry, RobotsTxtMemoryCacheOptions } from "./types.js";

const DEFAULT_MAX_ENTRIES = 1000;

/** In-memory least-recently-used cache. Clones entries on reads and writes and retains stale entries until eviction or deletion. */
export class RobotsTxtMemoryCache implements RobotsTxtCache {
    private readonly entriesByCacheKey = new Map<string, RobotsTxtCacheEntry>();
    private readonly maxEntries: number;

    constructor(options: RobotsTxtMemoryCacheOptions = {}) {
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

        if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
            throw new TypeError("maxEntries must be a positive integer.");
        }
    }

    /** Returns a copy of the entry and marks it as recently used. */
    async get(cacheKey: string): Promise<RobotsTxtCacheEntry | undefined> {
        const entry = this.entriesByCacheKey.get(cacheKey);

        if (!entry) {
            return undefined;
        }

        this.entriesByCacheKey.delete(cacheKey);
        this.entriesByCacheKey.set(cacheKey, entry);

        return structuredClone(entry);
    }

    /** Stores a copy, evicting the least recently used entry if the capacity is exceeded. */
    async set(cacheKey: string, entry: RobotsTxtCacheEntry): Promise<void> {
        const copy = structuredClone(entry);

        this.entriesByCacheKey.delete(cacheKey);
        this.entriesByCacheKey.set(cacheKey, copy);

        if (this.entriesByCacheKey.size > this.maxEntries) {
            const oldestKey = this.entriesByCacheKey.keys().next().value;

            if (oldestKey !== undefined) {
                this.entriesByCacheKey.delete(oldestKey);
            }
        }
    }

    /** Removes an entry if present. */
    async delete(cacheKey: string): Promise<void> {
        this.entriesByCacheKey.delete(cacheKey);
    }
}
