import assert from "node:assert/strict";
import test from "node:test";
import { matchRobotsTxt, parseRobotsTxt, RobotsTxtChecker, RobotsTxtMemoryCache } from "../dist/index.js";

const ORIGIN = "https://example.org";
const RULES = "User-agent: ExampleBot\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2.5\n";

function createChecker(responses, options = {}) {
    const requests = [];
    const robotsTxtChecker = new RobotsTxtChecker({
        userAgent: options.userAgent,
        cacheTtlMs: options.cacheTtlMs,
        fetch: async (url, requestOptions) => {
            requests.push({ url: url, options: requestOptions });
            const response = responses.shift();

            if (response instanceof Error) {
                throw response;
            }

            assert.ok(response, "Unexpected extra fetch");

            return response;
        },
    });

    return { robotsTxtChecker: robotsTxtChecker, requests: requests };
}

test("fetches only robots.txt with the configured identity and returns matching details", async () => {
    const { robotsTxtChecker, requests } = createChecker([new Response(RULES)], { userAgent: "ExampleBot/1.0" });
    const check = await robotsTxtChecker.check(`${ORIGIN}/private/page`, "ExampleBot");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.href, `${ORIGIN}/robots.txt`);
    assert.equal(requests[0].options.headers["User-Agent"], "ExampleBot/1.0");
    assert.equal(requests[0].options.headers.Accept, "text/plain");
    assert.ok(requests[0].options.signal instanceof AbortSignal);
    assert.equal(check.isAllowed, false);
    assert.equal(check.reason, "disallowed-by-rule");
    assert.equal(check.matchedUserAgentToken.value, "ExampleBot");
    assert.equal(check.matchedRule.line, 2);
    assert.equal(check.crawlDelay, 2.5);
    assert.equal(check.robotsTxt.raw, RULES);
    assert.equal(check.statusCode, 200);
    assert.equal(check.cacheStatus, "miss");
    assert.equal(await robotsTxtChecker.isAllowed(`${ORIGIN}/private/public`, "ExampleBot"), true);
    assert.equal(requests.length, 1);
});

for (const statusCode of [200, 204, 400, 401, 403, 404, 410, 429, 500, 503, 302]) {
    test(`HTTP ${statusCode} follows the documented policy`, async () => {
        const response = new Response(null, { status: statusCode });
        const { robotsTxtChecker } = createChecker([response]);
        const check = await robotsTxtChecker.check(`${ORIGIN}/page`, "ExampleBot");
        const isUnavailable = statusCode >= 400 && statusCode < 500 && statusCode !== 429;
        const isSuccessful = statusCode >= 200 && statusCode < 300;

        assert.equal(check.isAllowed, isSuccessful || isUnavailable);
        assert.equal(check.reason, isSuccessful ? "no-matching-rule" : isUnavailable ? "unavailable" : "unreachable");
        assert.equal(check.statusCode, statusCode);
    });
}

test("network failures deny and are retried on the next check", async () => {
    const { robotsTxtChecker, requests } = createChecker([new TypeError("Network failure"), new Response(RULES)]);
    const failed = await robotsTxtChecker.check(`${ORIGIN}/page`, "ExampleBot");

    assert.equal(failed.isAllowed, false);
    assert.equal(failed.reason, "unreachable");
    assert.equal(failed.statusCode, undefined);
    assert.equal(await robotsTxtChecker.isAllowed(`${ORIGIN}/page`, "ExampleBot"), true);
    assert.equal(requests.length, 2);
});

test("body-read failures retain the response status", async () => {
    const body = new ReadableStream({
        start(controller) {
            controller.error(new Error("Body failed"));
        },
    });
    const { robotsTxtChecker } = createChecker([new Response(body)]);
    const check = await robotsTxtChecker.check(`${ORIGIN}/page`, "ExampleBot");

    assert.equal(check.reason, "unreachable");
    assert.equal(check.statusCode, 200);
});

test("request timeout aborts the fetch and returns unreachable", async () => {
    const keepAlive = setTimeout(() => {}, 1000);
    const robotsTxtChecker = new RobotsTxtChecker({
        requestTimeoutMs: 5,
        fetch: async (url, options) => {
            return new Promise((resolve, reject) => {
                options.signal.addEventListener("abort", () => {
                    reject(options.signal.reason);
                }, { once: true });
            });
        },
    });

    try {
        const check = await robotsTxtChecker.check(`${ORIGIN}/page`, "ExampleBot");

        assert.equal(check.reason, "unreachable");
        assert.equal(check.statusCode, undefined);
    } finally {
        clearTimeout(keepAlive);
    }
});

test("robots.txt itself is allowed even after a retrieval failure", async () => {
    const { robotsTxtChecker } = createChecker([new Error("Offline")]);

    assert.equal(await robotsTxtChecker.isAllowed(`${ORIGIN}/robots.txt`, "ExampleBot"), true);
});

test("cache expiration uses stale rules on failure without extending freshness", async (context) => {
    let now = 1000;

    context.mock.method(Date, "now", () => {
        return now;
    });

    const { robotsTxtChecker, requests } = createChecker([
        new Response(RULES), new Response(null, { status: 503 }), new Response(null, { status: 404 }),
    ], { cacheTtlMs: 100 });

    await robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");
    const fresh = await robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");

    assert.equal(fresh.cacheStatus, "hit");
    now = 1100;

    const stale = await robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");

    assert.equal(stale.cacheStatus, "stale");
    assert.equal(stale.isAllowed, false);
    assert.equal(stale.statusCode, 503);

    const unavailable = await robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");
    const cached = await robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");

    assert.equal(unavailable.reason, "unavailable");
    assert.equal(cached.isAllowed, true);
    assert.equal(cached.robotsTxt, undefined);
    assert.equal(cached.cacheStatus, "hit");
    assert.equal(requests.length, 3);
});

test("zero TTL disables storage but still deduplicates concurrent checks", async () => {
    const { robotsTxtChecker, requests } = createChecker([new Response(RULES), new Response(RULES)], { cacheTtlMs: 0 });
    const checks = await Promise.all([
        robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot"),
        robotsTxtChecker.check(`${ORIGIN}/private/public`, "ExampleBot"),
    ]);

    assert.equal(requests.length, 1);
    assert.equal(checks[0].isAllowed, false);
    assert.equal(checks[1].isAllowed, true);
    checks[0].robotsTxt.groups[0].rules.length = 0;
    assert.equal(checks[1].robotsTxt.groups[0].rules.length, 2);
    await robotsTxtChecker.check(`${ORIGIN}/page`, "ExampleBot");
    assert.equal(requests.length, 2);
});

test("invalidate removes the origin entry without fetching", async () => {
    const { robotsTxtChecker, requests } = createChecker([new Response(RULES), new Response("")]);

    await robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");
    await robotsTxtChecker.invalidate(`${ORIGIN}/another/path`);
    assert.equal(requests.length, 1);
    assert.equal(await robotsTxtChecker.isAllowed(`${ORIGIN}/private`, "ExampleBot"), true);
    assert.equal(requests.length, 2);
});

test("in-flight requests can repopulate an invalidated entry", async () => {
    const response = Promise.withResolvers();
    const started = Promise.withResolvers();
    const robotsTxtChecker = new RobotsTxtChecker({
        fetch: async () => {
            started.resolve();

            return response.promise;
        },
    });
    const pending = robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");

    await started.promise;
    await robotsTxtChecker.invalidate(ORIGIN);
    response.resolve(new Response(RULES));
    await pending;
    const check = await robotsTxtChecker.check(`${ORIGIN}/private`, "ExampleBot");

    assert.equal(check.cacheStatus, "hit");
});

test("cache errors propagate and pending requests are cleaned up", async () => {
    const failure = new Error("Cache unavailable");
    let reads = 0;
    const robotsTxtChecker = new RobotsTxtChecker({
        cache: {
            async get() {
                reads++;
                throw failure;
            },
            async set() {},
            async delete() {},
        },
    });

    await assert.rejects(robotsTxtChecker.check(`${ORIGIN}/page`, "ExampleBot"), failure);
    await assert.rejects(robotsTxtChecker.check(`${ORIGIN}/page`, "ExampleBot"), failure);
    assert.equal(reads, 2);
});

test("memory cache clones entries and evicts the least recently used", async () => {
    const cache = new RobotsTxtMemoryCache({ maxEntries: 2 });
    const entry = { robotsTxt: parseRobotsTxt(RULES), statusCode: 200, expiresAt: new Date(0).toISOString() };

    await cache.set("first", entry);
    entry.robotsTxt.groups.length = 0;
    await cache.set("second", entry);
    const first = await cache.get("first");

    assert.equal(first.robotsTxt.groups.length, 1);
    first.robotsTxt.groups.length = 0;
    assert.equal((await cache.get("first")).robotsTxt.groups.length, 1);
    await cache.set("third", entry);
    assert.equal(await cache.get("second"), undefined);
    await cache.delete("first");
    assert.equal(await cache.get("first"), undefined);
    await cache.delete("missing");
});

for (const userAgentToken of ["", "ExampleBot/1.0", "Example Bot", "*", "Bot123"]) {
    test(`rejects invalid matching token ${JSON.stringify(userAgentToken)}`, () => {
        assert.throws(() => {
            matchRobotsTxt(parseRobotsTxt(""), ORIGIN, userAgentToken);
        }, TypeError);
    });
}

test("crawl-delay uses the maximum applicable value without changing access", () => {
    const document = parseRobotsTxt("User-agent: *\nCrawl-delay: 20\nDisallow: /\nUser-agent: ExampleBot\nCrawl-delay: 0\nCrawl-delay: 1.5\nAllow: /\nUser-agent: ExampleBot\nCrawl-delay: 2.5\n");
    const match = matchRobotsTxt(document, ORIGIN, "examplebot");

    assert.equal(match.isAllowed, true);
    assert.equal(match.crawlDelay, 2.5);
    assert.equal(matchRobotsTxt(document, ORIGIN, "OtherBot").crawlDelay, 20);
});

test("delay-only sections keep separate delays but share access-rule grouping", () => {
    const document = parseRobotsTxt("User-agent: FirstBot\nCrawl-delay: 1\nUser-agent: SecondBot\nCrawl-delay: 10\nDisallow: /private\n");

    for (const [userAgentToken, crawlDelay] of [["FirstBot", 1], ["SecondBot", 10]]) {
        const match = matchRobotsTxt(document, `${ORIGIN}/private`, userAgentToken);

        assert.equal(match.crawlDelay, crawlDelay);
        assert.equal(match.isAllowed, false);
    }
});

for (const value of ["-1", "NaN", "Infinity", "1 second", "", "1e3"]) {
    test(`ignores invalid crawl-delay ${JSON.stringify(value)}`, () => {
        const document = parseRobotsTxt(`User-agent: *\nCrawl-delay: ${value}\n`);

        assert.equal(matchRobotsTxt(document, ORIGIN, "ExampleBot").crawlDelay, undefined);
    });
}

for (const [pattern, path, isAllowed] of [
    ["/ツ", "/%E3%83%84", false],
    ["/%E3%83%84", "/ツ", false],
    ["/%62%61%7A", "/baz", false],
    ["/baz", "/%62%61%7a", false],
    ["/a%2Fb", "/a/b", true],
    ["/a%2Fb", "/a%2fb", false],
    ["/page$", "/page#fragment", false],
    ["/page$", "/page?query", true],
    ["/a%2Ab", "/a*b", false],
    ["/a%24b", "/a$b", false],
]) {
    test(`normalizes ${path} against ${pattern}`, () => {
        const document = parseRobotsTxt(`User-agent: *\nDisallow: ${pattern}\n`);

        assert.equal(matchRobotsTxt(document, ORIGIN + path, "ExampleBot").isAllowed, isAllowed);
    });
}

test("processing limit retains complete rules and ignores an incomplete final rule", () => {
    const prefix = "User-agent: *\nDisallow: /private\n";
    const maximumBytes = 500 * 1024;
    const padding = "#" + "a".repeat(maximumBytes - prefix.length - 10) + "\n";
    const document = parseRobotsTxt(prefix + padding + "Allow: /private\n");

    assert.equal(new TextEncoder().encode(document.raw).length, maximumBytes);
    assert.equal(document.groups[0].rules.length, 1);
    assert.equal(matchRobotsTxt(document, `${ORIGIN}/private`, "ExampleBot").isAllowed, false);
});
