import { MAX_CACHE_TTL_MS } from "./constants.js";
import { fetchRobotsTxtResponse } from "./fetch.js";
import { isRobotsTxtUrl, matchRobotsTxt } from "./matcher.js";
import { RobotsTxtMemoryCache } from "./memory-cache.js";
import type { RobotsTxt, RobotsTxtCache, RobotsTxtCheck, RobotsTxtCheckerOptions } from "./types.js";
import { normalizeUrl, validateUserAgent, validateUserAgentToken } from "./validation.js";

const DEFAULT_USER_AGENT = "RobotsTxtChecker/0.1.0 (+https://github.com/knownagents/robots-txt-checker)";
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const CACHE_KEY_NAMESPACE = "robots-txt-checker-v1";

interface RobotsTxtResponse {
    robotsTxt?: RobotsTxt;
    statusCode?: number;
    cacheStatus: RobotsTxtCheck["cacheStatus"];
    isUnreachable: boolean;
}

/** Checks robots.txt access rules. Reuse an instance for caching and concurrent request deduplication. */
export class RobotsTxtChecker {
    private readonly fetchImplementation: typeof globalThis.fetch;
    private readonly userAgent: string;
    private readonly cache: RobotsTxtCache;
    private readonly cacheTtlMs: number;
    private readonly requestTimeoutMs: number;
    private readonly pendingRequestsByCacheKey = new Map<string, Promise<RobotsTxtResponse>>();

    constructor(options: RobotsTxtCheckerOptions = {}) {
        this.fetchImplementation = options.fetch ?? globalThis.fetch;
        this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
        this.cache = options.cache ?? new RobotsTxtMemoryCache();
        this.cacheTtlMs = options.cacheTtlMs ?? MAX_CACHE_TTL_MS;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

        if (!Number.isInteger(this.cacheTtlMs) || this.cacheTtlMs < 0 || this.cacheTtlMs > MAX_CACHE_TTL_MS) {
            throw new TypeError(`cacheTtlMs must be an integer between 0 and ${MAX_CACHE_TTL_MS}.`);
        }

        if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
            throw new TypeError("requestTimeoutMs must be a positive integer.");
        }

        validateUserAgent(this.userAgent);
    }

    /**
     * Returns whether robots.txt permits access without fetching the target page.
     * @param url Absolute HTTP or HTTPS URL without credentials.
     * @param userAgentToken User agent token such as "ExampleBot", not a full User-Agent header value.
     */
    async isAllowed(url: string | URL, userAgentToken: string): Promise<boolean> {
        const check = await this.check(url, userAgentToken);

        return check.isAllowed;
    }

    /**
     * Returns an access decision and matching details. Retrieval failures use a stale document if available, otherwise deny access. The /robots.txt URL itself is always allowed.
     * @param urlInput Absolute HTTP or HTTPS URL without credentials.
     * @param userAgentToken Case-insensitive token containing only ASCII letters, underscores, or hyphens.
     * @throws Invalid input, invalid configuration, or cache errors reject the operation.
     */
    async check(urlInput: string | URL, userAgentToken: string): Promise<RobotsTxtCheck> {
        validateUserAgentToken(userAgentToken);

        const url = normalizeUrl(urlInput);
        const cacheKey = this.getCacheKey(url.origin);
        const sharedResponse = await this.getOrCreateRobotsTxtPendingRequest(url.origin, cacheKey);
        const response = structuredClone(sharedResponse);

        if (response.robotsTxt) {
            const match = matchRobotsTxt(response.robotsTxt, url, userAgentToken);

            return {
                isAllowed: match.isAllowed,
                reason: match.reason,
                matchedUserAgentToken: match.matchedUserAgentToken,
                matchedRule: match.matchedRule,
                crawlDelay: match.crawlDelay,
                robotsTxt: response.robotsTxt,
                statusCode: response.statusCode,
                cacheStatus: response.cacheStatus,
            };
        }

        if (isRobotsTxtUrl(url)) {
            return {
                isAllowed: true,
                reason: "no-matching-rule",
                statusCode: response.statusCode,
                cacheStatus: response.cacheStatus,
            };
        }

        return {
            isAllowed: !response.isUnreachable,
            reason: response.isUnreachable ? "unreachable" : "unavailable",
            statusCode: response.statusCode,
            cacheStatus: response.cacheStatus,
        };
    }

    /** Removes the cached entry for the URL's origin. Does not cancel in-flight requests, which may repopulate the cache. */
    async invalidate(urlInput: string | URL): Promise<void> {
        const origin = normalizeUrl(urlInput).origin;
        const cacheKey = this.getCacheKey(origin);

        await this.cache.delete(cacheKey);
    }

    private getCacheKey(origin: string): string {
        return JSON.stringify([CACHE_KEY_NAMESPACE, this.userAgent, origin]);
    }

    private getOrCreateRobotsTxtPendingRequest(origin: string, cacheKey: string): Promise<RobotsTxtResponse> {
        const pendingRequest = this.pendingRequestsByCacheKey.get(cacheKey);

        if (pendingRequest) {
            return pendingRequest;
        }

        const request = this.getRobotsTxtResponse(origin, cacheKey);

        this.pendingRequestsByCacheKey.set(cacheKey, request);

        const cleanup = (): void => {
            this.pendingRequestsByCacheKey.delete(cacheKey);
        };

        request.then(cleanup, cleanup);

        return request;
    }

    private async getRobotsTxtResponse(origin: string, cacheKey: string): Promise<RobotsTxtResponse> {
        const cacheEntry = this.cacheTtlMs > 0 ? await this.cache.get(cacheKey) : undefined;

        if (cacheEntry && Date.parse(cacheEntry.expiresAt) > Date.now()) {
            return {
                robotsTxt: cacheEntry.robotsTxt,
                statusCode: cacheEntry.statusCode,
                cacheStatus: "hit",
                isUnreachable: false,
            };
        }

        const response = await fetchRobotsTxtResponse(origin, {
            fetch: this.fetchImplementation,
            userAgent: this.userAgent,
            requestTimeoutMs: this.requestTimeoutMs,
        });

        if (response.isUnreachable) {
            if (cacheEntry?.robotsTxt) {
                return {
                    robotsTxt: cacheEntry.robotsTxt,
                    statusCode: response.statusCode,
                    cacheStatus: "stale",
                    isUnreachable: false,
                };
            }

            return {
                statusCode: response.statusCode,
                cacheStatus: "miss",
                isUnreachable: true,
            };
        }

        if (this.cacheTtlMs > 0) {
            const expiresAt = new Date(Date.now() + this.cacheTtlMs).toISOString();

            await this.cache.set(cacheKey, {
                robotsTxt: response.robotsTxt,
                statusCode: response.statusCode!,
                expiresAt: expiresAt,
            });
        }

        return {
            robotsTxt: response.robotsTxt,
            statusCode: response.statusCode,
            cacheStatus: "miss",
            isUnreachable: false,
        };
    }
}
