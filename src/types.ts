export interface RobotsTxtCheckerOptions {
    /** Fetch implementation. Defaults to globalThis.fetch. Custom implementations must honor the abort signal. */
    fetch?: typeof globalThis.fetch;
    /** HTTP User-Agent header used for fetching, separate from the token being checked. Defaults to the library identification string. */
    userAgent?: string;
    /** Cache implementation. Defaults to a new RobotsTxtMemoryCache per checker. */
    cache?: RobotsTxtCache;
    /** Freshness lifetime in milliseconds, from 0 to 86400000. Defaults to 86400000 (24 hours). Zero disables caching. HTTP cache headers are ignored. */
    cacheTtlMs?: number;
    /** Positive request timeout in milliseconds, including redirects and body reading. Defaults to 10000. */
    requestTimeoutMs?: number;
}

/** A parsed robots.txt document. */
export interface RobotsTxt {
    /** Source text retained by the parser, limited to 500 KiB of UTF-8 input. */
    raw: string;
    groups: RobotsTxtGroup[];
}

/** User agent tokens and the rules that apply to them. */
export interface RobotsTxtGroup {
    userAgentTokens: RobotsTxtUserAgentToken[];
    rules: RobotsTxtRule[];
    /** Largest valid Crawl-delay in this group, in seconds. */
    crawlDelay?: number;
}

export interface RobotsTxtUserAgentToken {
    /** User agent token or the wildcard "*". */
    value: string;
    /** One-based line number in the source document. */
    line: number;
}

export interface RobotsTxtRule {
    directive: "allow" | "disallow";
    /** Path pattern, including any wildcard or end anchor. */
    pattern: string;
    /** One-based line number in the source document. */
    line: number;
}

export type RobotsTxtMatchReason =
    | "allowed-by-rule"
    | "disallowed-by-rule"
    | "no-matching-rule";

/** "unavailable" allows access after 4xx responses other than 429. "unreachable" denies access after a failure when no stale document is available. */
export type RobotsTxtCheckReason =
    | RobotsTxtMatchReason
    | "unavailable"
    | "unreachable";

/** The result of matching a URL against a document without fetching. */
export interface RobotsTxtMatch {
    isAllowed: boolean;
    reason: RobotsTxtMatchReason;
    matchedUserAgentToken?: RobotsTxtUserAgentToken;
    matchedRule?: RobotsTxtRule;
    /** Largest Crawl-delay among matching groups, in seconds. Does not affect isAllowed. */
    crawlDelay?: number;
}

/** An access decision with document, matching, and retrieval details. */
export interface RobotsTxtCheck {
    isAllowed: boolean;
    reason: RobotsTxtCheckReason;
    matchedUserAgentToken?: RobotsTxtUserAgentToken;
    matchedRule?: RobotsTxtRule;
    /** Largest Crawl-delay among matching groups, in seconds. Scheduling is left to the caller. */
    crawlDelay?: number;
    robotsTxt?: RobotsTxt;
    /** HTTP status from the retrieval attempt, or the cached status on a hit. May be absent on network failure. */
    statusCode?: number;
    /** "hit" uses a fresh entry, "miss" attempts retrieval, and "stale" uses an expired document after retrieval fails. */
    cacheStatus: "miss" | "hit" | "stale";
}

export interface RobotsTxtMemoryCacheOptions {
    /** Maximum stored entries. Must be a positive integer. Defaults to 1000. */
    maxEntries?: number;
}

/** Custom cache contract. Keys are opaque and include the origin and fetching identity. Cache errors propagate to callers. */
export interface RobotsTxtCache {
    /** Returns an entry or undefined. Retaining expired entries enables stale fallback, since the checker evaluates freshness. */
    get(cacheKey: string): Promise<RobotsTxtCacheEntry | undefined>;
    /** Stores or replaces an entry. Do not mutate the supplied entry. */
    set(cacheKey: string, entry: RobotsTxtCacheEntry): Promise<void>;
    /** Removes an entry. Missing keys should be a no-op. */
    delete(cacheKey: string): Promise<void>;
}

export interface RobotsTxtCacheEntry {
    /** Parsed document, absent when the response indicates robots.txt is unavailable. */
    robotsTxt?: RobotsTxt;
    statusCode: number;
    /** ISO 8601 timestamp after which the entry is stale. */
    expiresAt: string;
}
