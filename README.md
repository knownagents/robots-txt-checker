# robots-txt-checker

[![Tests](https://github.com/knownagents/robots-txt-checker/actions/workflows/test.yml/badge.svg)](https://github.com/knownagents/robots-txt-checker/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@knownagents/robots-txt-checker)](https://www.npmjs.com/package/@knownagents/robots-txt-checker)

A dependency-free robots.txt checker that makes it easy for respectful AI agents, crawlers, scrapers, and other bots to follow the rules. Includes fetching, parsing, and caching based on the RFC 9309 industry standard.

## Installation

```sh
npm install @knownagents/robots-txt-checker
```

## Usage

```ts
import { RobotsTxtChecker } from "@knownagents/robots-txt-checker"

const robotsTxtChecker = new RobotsTxtChecker({
    userAgent: "ExampleBot/1.0 (+https://example.com/bot)",
})

const url = "https://example.org/articles/example"
const isAllowed = await robotsTxtChecker.isAllowed(url, "ExampleBot")

if (isAllowed) {
    // Proceed with fetching the page
    const response = await fetch(url, {
        headers: {
            "User-Agent": "ExampleBot/1.0 (+https://example.com/bot)",
        },
    })
}
```

Reuse one checker to share cached documents and concurrent requests. It checks the supplied URL, not subsequent page redirects.

`userAgent` identifies your crawler when fetching robots.txt. It defaults to the library's identification string.

`userAgentToken` is the user agent token to match, such as `ExampleBot`, not a full user agent.

## API

```ts
const isAllowed = await robotsTxtChecker.isAllowed(url, "ExampleBot")
const check = await robotsTxtChecker.check(url, "ExampleBot")
await robotsTxtChecker.invalidate("https://example.org")
```

Use `isAllowed()` for a boolean or `check()` for details:

```ts
interface RobotsTxtCheck {
    isAllowed: boolean
    reason: RobotsTxtCheckReason
    matchedUserAgentToken?: RobotsTxtUserAgentToken
    matchedRule?: RobotsTxtRule
    crawlDelay?: number
    robotsTxt?: RobotsTxt
    statusCode?: number
    cacheStatus: "miss" | "hit" | "stale"
}

type RobotsTxtCheckReason =
    | "allowed-by-rule"
    | "disallowed-by-rule"
    | "no-matching-rule"
    | "unavailable"
    | "unreachable"
```

`robotsTxt` contains the source text in `raw` and parsed rules in `groups`. Matched rules and tokens include line numbers.

`statusCode` is the cached or latest HTTP response status, when available.

`crawlDelay` is the requested delay in seconds, when specified. `check()` and `matchRobotsTxt()` return it, but do not wait or change `isAllowed()`. Your crawler handles scheduling.

`cacheStatus` is `hit` for a fresh entry, `stale` for fallback after a failed fetch, or `miss` otherwise.

`invalidate()` clears the cache for an origin or URL. Pending requests are not canceled and may repopulate the cache.

## Options

| Option | Default | Behavior |
| --- | --- | --- |
| `fetch` | `globalThis.fetch` | Custom fetch implementation that follows redirects automatically and honors abort signals |
| `userAgent` | Library identification string | HTTP identity for robots.txt requests |
| `cache` | `new RobotsTxtMemoryCache()` | Asynchronous cache implementation |
| `cacheTtlMs` | `86400000` (24 hours) | Cache lifetime in milliseconds, from zero to 24 hours |
| `requestTimeoutMs` | `10000` (10 seconds) | Request timeout in milliseconds, including redirects and body reading |

URLs must be absolute HTTP or HTTPS URLs. Invalid URLs, tokens, or configuration reject the operation, as do cache errors. Network failures return a decision instead.

## HTTP Behavior

The checker follows these policies when fetching robots.txt:

| Result | Behavior |
| --- | --- |
| `2xx` | Parse the response and evaluate usable rules |
| `4xx` other than `429`, including `401`, `403`, and `404` | Allow with `unavailable` |
| `429`, `5xx`, timeout, DNS failure, or network failure | Evaluate a previously cached document, otherwise deny with `unreachable` |
| Redirect failure or unexpected response | Treat as unreachable and use a retained document, otherwise deny |
| Empty document or no applicable rule | Allow |

Robots.txt redirects are followed automatically. Matching supports [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) user agent groups, wildcards, and end anchors. The longest matching rule wins, with `Allow` winning ties. `/robots.txt` itself is always allowed. Only the first 500 KiB of robots.txt is parsed.

`Crawl-delay` is also supported. If multiple delays apply, the largest is returned. Delays stay with their user agent sections without changing how access rules are grouped. Your crawler handles the waiting.

## Caching

```ts
import { RobotsTxtMemoryCache, RobotsTxtChecker } from "@knownagents/robots-txt-checker"

const robotsTxtChecker = new RobotsTxtChecker({
    cache: new RobotsTxtMemoryCache({ maxEntries: 500 }),
    cacheTtlMs: 3600000,
})
```

The default in-memory cache holds up to 1000 entries, evicting the least recently used first. Set `cacheTtlMs` to `0` to disable caching. Concurrent checks still share requests within one checker.

Expired documents can be used when fetching fails until they are replaced, evicted, or invalidated. Failed fetches are not cached. Caching uses the configured TTL, not HTTP cache headers.

Custom caches implement this interface:

```ts
interface RobotsTxtCache {
    get(cacheKey: string): Promise<RobotsTxtCacheEntry | undefined>
    set(cacheKey: string, entry: RobotsTxtCacheEntry): Promise<void>
    delete(cacheKey: string): Promise<void>
}

interface RobotsTxtCacheEntry {
    robotsTxt?: RobotsTxt
    statusCode: number
    expiresAt: string
}
```

Store entries unchanged under the supplied keys. `expiresAt` is an ISO 8601 timestamp. Retain expired documents to support stale fallback. Share caches only between compatible fetch configurations and cache policies.

## Parsing Without Fetching

```ts
import { matchRobotsTxt, parseRobotsTxt } from "@knownagents/robots-txt-checker"

const robotsTxt = parseRobotsTxt(`User-agent: *
Disallow: /private/
Allow: /private/public$
`)

const match = matchRobotsTxt(
    robotsTxt,
    "https://example.org/private/public",
    "ExampleBot",
)

const isAllowed = match.isAllowed
```

The matcher returns the decision and matched rule details without making network requests.

## Testing

The test suite includes selected parsing and matching cases adapted from [Google's official robots.txt test suite](https://github.com/google/robotstxt/blob/master/robots_test.cc), alongside additional tests for fetching, caching, and crawl-delay. The adapted tests in `test/google.test.js` are Copyright 2019 Google LLC and licensed under [Apache 2.0](https://github.com/knownagents/robots-txt-checker/blob/main/test/LICENSE.google).

## Requirements

This package uses ESM and native `fetch` and includes TypeScript declarations.

The following runtimes are supported:

- Node.js 22 or later

## Support

Please [open an issue](https://github.com/knownagents/robots-txt-checker/issues) with questions, bugs, or suggestions.
