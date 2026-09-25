import assert from "node:assert/strict";
import test from "node:test";
import { matchRobotsTxt, parseRobotsTxt } from "../dist/index.js";

function assertAccess(raw, userAgentToken, path, isAllowed) {
    const match = matchRobotsTxt(parseRobotsTxt(raw), `http://foo.bar${path}`, userAgentToken);

    assert.equal(match.isAllowed, isAllowed, `${userAgentToken}: ${path}`);
}

test("Google ID_LineSyntax_Line: valid and unknown records", () => {
    assertAccess("user-agent: FooBot\ndisallow: /\n", "FooBot", "/x/y", false);
    assertAccess("foo: FooBot\nbar: /\n", "FooBot", "/x/y", true);
});

test("Google ID_LineSyntax_Groups: combine groups and ignore ungrouped rules", () => {
    const raw = "allow: /foo/bar/\n\nuser-agent: FooBot\ndisallow: /\nallow: /x/\nuser-agent: BarBot\ndisallow: /\nallow: /y/\n\n\nallow: /w/\nuser-agent: BazBot\n\nuser-agent: FooBot\nallow: /z/\ndisallow: /\n";

    for (const [userAgentToken, path, isAllowed] of [
        ["FooBot", "/x/b", true],
        ["FooBot", "/z/d", true],
        ["FooBot", "/y/c", false],
        ["BarBot", "/y/c", true],
        ["BarBot", "/w/a", true],
        ["BarBot", "/z/d", false],
        ["BazBot", "/z/d", true],
        ["FooBot", "/foo/bar/", false],
        ["BarBot", "/foo/bar/", false],
        ["BazBot", "/foo/bar/", false],
    ]) {
        assertAccess(raw, userAgentToken, path, isAllowed);
    }
});

for (const record of ["Sitemap: https://foo.bar/sitemap", "Invalid-Unknown-Line: unknown"]) {
    test(`Google ID_LineSyntax_Groups_OtherRules: ${record}`, () => {
        const raw = `User-agent: BarBot\n${record}\nUser-agent: *\nDisallow: /\n`;

        assertAccess(raw, "FooBot", "/", false);
        assertAccess(raw, "BarBot", "/", false);
    });
}

for (const raw of [
    "USER-AGENT: FooBot\nALLOW: /x/\nDISALLOW: /\n",
    "user-agent: FooBot\nallow: /x/\ndisallow: /\n",
    "uSeR-aGeNt: FooBot\nAlLoW: /x/\nDisAlLoW: /\n",
]) {
    test(`Google ID_REPLineNamesCaseInsensitive: ${raw.split("\n")[0]}`, () => {
        assertAccess(raw, "FooBot", "/x/y", true);
        assertAccess(raw, "FooBot", "/a/b", false);
    });
}

test("Google ID_GlobalGroups_Secondary: specific groups override wildcard groups", () => {
    assertAccess("", "FooBot", "/x/y", true);
    assertAccess("user-agent: *\nallow: /\nuser-agent: FooBot\ndisallow: /\n", "FooBot", "/x/y", false);
    assertAccess("user-agent: *\nallow: /\nuser-agent: FooBot\ndisallow: /\n", "BarBot", "/x/y", true);
    assertAccess("user-agent: FooBot\nallow: /\nuser-agent: BarBot\ndisallow: /\nuser-agent: BazBot\ndisallow: /\n", "QuxBot", "/x/y", true);
});

test("Google ID_AllowDisallow_Value_CaseSensitive", () => {
    assertAccess("user-agent: FooBot\ndisallow: /x/\n", "FooBot", "/x/y", false);
    assertAccess("user-agent: FooBot\ndisallow: /X/\n", "FooBot", "/x/y", true);
});

for (const [rules, path, isAllowed] of [
    ["disallow: /x/page.html\nallow: /x/", "/x/page.html", false],
    ["allow: /x/page.html\ndisallow: /x/", "/x/page.html", true],
    ["allow: /x/page.html\ndisallow: /x/", "/x/", false],
    ["disallow: \nallow: ", "/x/page.html", true],
    ["disallow: /\nallow: /", "/x/page.html", true],
    ["disallow: /x\nallow: /x/", "/x", false],
    ["disallow: /x\nallow: /x/", "/x/", true],
    ["disallow: /x/page.html\nallow: /x/page.html", "/x/page.html", true],
    ["allow: /page\ndisallow: /*.html", "/page.html", false],
    ["allow: /page\ndisallow: /*.html", "/page", true],
    ["allow: /x/page.\ndisallow: /*.html", "/x/page.html", true],
    ["allow: /x/page.\ndisallow: /*.html", "/x/y.html", false],
]) {
    test(`Google ID_LongestMatch: ${JSON.stringify(rules)} at ${path}`, () => {
        assertAccess(`user-agent: FooBot\n${rules}\n`, "FooBot", path, isAllowed);
    });
}

for (const [pattern, allowedPaths, disallowedPaths] of [
    ["/fish", ["/fish", "/fish.html", "/fish/salmon.html", "/fishheads", "/fishheads/yummy.html", "/fish.html?id=anything"], ["/bar", "/Fish.asp", "/catfish", "/?id=fish"]],
    ["/fish*", ["/fish", "/fish.html", "/fish/salmon.html", "/fishheads", "/fishheads/yummy.html", "/fish.html?id=anything"], ["/bar", "/Fish.bar", "/catfish", "/?id=fish"]],
    ["/fish/", ["/fish/", "/fish/salmon", "/fish/?salmon", "/fish/salmon.html", "/fish/?id=anything"], ["/bar", "/fish", "/fish.html", "/Fish/Salmon.html"]],
    ["/*.php", ["/filename.php", "/folder/filename.php", "/folder/filename.php?parameters", "//folder/any.php.file.html", "/filename.php/", "/index?f=filename.php/"], ["/bar", "/php/", "/index?php", "/windows.PHP"]],
    ["/*.php$", ["/filename.php", "/folder/filename.php"], ["/bar", "/filename.php?parameters", "/filename.php/", "/filename.php5", "/php/", "/filename?php", "/aaaphpaaa", "//windows.PHP"]],
    ["/fish*.php", ["/fish.php", "/fishheads/catfish.php?parameters"], ["/bar", "/Fish.PHP"]],
    ["/$", ["/"], ["/page.html"]],
]) {
    test(`Google documentation matching examples: ${pattern}`, () => {
        const raw = `user-agent: FooBot\ndisallow: /\nallow: ${pattern}\n`;

        for (const path of allowedPaths) {
            assertAccess(raw, "FooBot", path, true);
        }

        for (const path of disallowedPaths) {
            assertAccess(raw, "FooBot", path, false);
        }
    });
}

test("Google ID_SpecialCharacters: end anchors and comments", () => {
    const raw = "User-agent: FooBot\nDisallow: /foo/bar$\nAllow: /foo/bar/qux\n";

    assertAccess(raw, "FooBot", "/foo/bar", false);

    for (const path of ["/foo/bar/qux", "/foo/bar/", "/foo/bar/baz"]) {
        assertAccess(raw, "FooBot", path, true);
    }

    assertAccess("User-agent: FooBot\nDisallow: /foo/bar # comment\n", "FooBot", "/foo/bar", false);
});

for (const lineEnding of ["\n", "\r\n", "\r"]) {
    test(`Google ID_LinesNumbersAreCountedCorrectly: ${JSON.stringify(lineEnding)}`, () => {
        const raw = ["User-Agent: foo", "Allow: /some/path", "User-Agent: bar", "", "", "Disallow: /"].join(lineEnding);

        for (const content of [raw, raw + lineEnding]) {
            const document = parseRobotsTxt(content);

            assert.equal(document.groups[0].userAgentTokens[0].line, 1);
            assert.equal(document.groups[0].rules[0].line, 2);
            assert.equal(document.groups[1].userAgentTokens[0].line, 3);
            assert.equal(document.groups[1].rules[0].line, 6);
        }
    });
}

test("Google ID_UTF8ByteOrderMarkIsSkipped: complete BOM", () => {
    const document = parseRobotsTxt("\uFEFFUser-Agent: foo\nAllow: /AnyValue\n");

    assert.equal(document.groups[0].userAgentTokens[0].value, "foo");
    assert.equal(document.groups[0].rules[0].pattern, "/AnyValue");
});
