import { ROBOTS_TXT_PATH } from "./constants.js";
import type { RobotsTxt, RobotsTxtMatch, RobotsTxtRule, RobotsTxtUserAgentToken } from "./types.js";
import { normalizeUrl, validateUserAgentToken } from "./validation.js";

const MAX_ASCII_CODE_POINT = 127;
const TEXT_ENCODER = new TextEncoder();

/**
 * Matches a URL against a parsed document without fetching or caching. Longest matching rules win, with Allow winning ties.
 * @param robotsTxt Document belonging to the target URL's origin.
 * @param urlInput Absolute HTTP or HTTPS URL without credentials. The query is included in matching, but the fragment is ignored.
 * @param userAgentToken Case-insensitive token containing only ASCII letters, underscores, or hyphens.
 */
export function matchRobotsTxt(robotsTxt: RobotsTxt, urlInput: string | URL, userAgentToken: string): RobotsTxtMatch {
    const url = normalizeUrl(urlInput);

    validateUserAgentToken(userAgentToken);

    const normalizedUserAgentToken = userAgentToken.toLowerCase();
    const matchingGroups = robotsTxt.groups.filter((group) => {
        return group.userAgentTokens.some((userAgentToken) => {
            return userAgentToken.value.toLowerCase() === normalizedUserAgentToken;
        });
    });
    const selectedUserAgentToken = matchingGroups.length > 0 ? normalizedUserAgentToken : "*";
    const groups = matchingGroups.length > 0 ? matchingGroups : robotsTxt.groups.filter((group) => {
        return group.userAgentTokens.some((userAgentToken) => {
            return userAgentToken.value === "*";
        });
    });
    const path = getUrlPath(url);

    let matchedRule: RobotsTxtRule | undefined;
    let matchedUserAgentToken: RobotsTxtUserAgentToken | undefined;
    let crawlDelay: number | undefined;
    let longestMatch = -1;

    for (const group of groups) {
        const groupUserAgentToken = group.userAgentTokens.find((candidateToken) => {
            return candidateToken.value.toLowerCase() === selectedUserAgentToken;
        });

        matchedUserAgentToken ??= groupUserAgentToken;

        if (group.crawlDelay !== undefined) {
            crawlDelay = Math.max(crawlDelay ?? 0, group.crawlDelay);
        }

        if (path === ROBOTS_TXT_PATH) {
            continue;
        }

        for (const rule of group.rules) {
            if (!rule.pattern) {
                continue;
            }

            const pattern = normalizePath(rule.pattern, true);

            if (pattern.length < longestMatch || !isMatchingPath(path, pattern)) {
                continue;
            }

            if (pattern.length === longestMatch && (matchedRule?.directive === "allow" || rule.directive !== "allow")) {
                continue;
            }

            longestMatch = pattern.length;
            matchedRule = rule;
            matchedUserAgentToken = groupUserAgentToken;
        }
    }

    return {
        isAllowed: matchedRule?.directive !== "disallow",
        reason: matchedRule ? (matchedRule.directive === "allow" ? "allowed-by-rule" : "disallowed-by-rule") : "no-matching-rule",
        matchedUserAgentToken: matchedUserAgentToken,
        matchedRule: matchedRule,
        crawlDelay: crawlDelay,
    };
}

export function isRobotsTxtUrl(url: URL): boolean {
    return getUrlPath(url) === ROBOTS_TXT_PATH;
}

function getUrlPath(url: URL): string {
    return normalizePath(url.href.slice(url.origin.length).split("#", 1)[0]!, false);
}

function normalizePath(value: string, isPattern: boolean): string {
    const normalized: string[] = [];

    for (let index = 0; index < value.length;) {
        const character = String.fromCodePoint(value.codePointAt(index)!);
        const encodedByte = value.slice(index + 1, index + 3);

        if (character === "%" && /^[a-f\d]{2}$/i.test(encodedByte)) {
            const decoded = String.fromCharCode(Number.parseInt(encodedByte, 16));

            normalized.push(/^[a-z\d._~-]$/i.test(decoded) ? decoded : `%${encodedByte.toUpperCase()}`);
            index += 3;

            continue;
        }

        if (character.codePointAt(0)! > MAX_ASCII_CODE_POINT || (!isPattern && (character === "*" || character === "$"))) {
            for (const byte of TEXT_ENCODER.encode(character)) {
                normalized.push(`%${byte.toString(16).toUpperCase().padStart(2, "0")}`);
            }
        } else if (isPattern && character === "$" && index !== value.length - 1) {
            normalized.push("%24");
        } else {
            normalized.push(character);
        }

        index += character.length;
    }

    return normalized.join("");
}

function isMatchingPath(path: string, pattern: string): boolean {
    const isAnchored = pattern.endsWith("$");
    const segments = (isAnchored ? pattern.slice(0, -1) : pattern).split("*");
    const first = segments[0]!;

    if (!path.startsWith(first)) {
        return false;
    }

    if (segments.length === 1) {
        return !isAnchored || path.length === first.length;
    }

    let position = first.length;

    for (let index = 1; index < segments.length; index++) {
        const segment = segments[index]!;

        if (isAnchored && index === segments.length - 1) {
            return path.endsWith(segment) && path.length - segment.length >= position;
        }

        const matchIndex = path.indexOf(segment, position);

        if (matchIndex === -1) {
            return false;
        }

        position = matchIndex + segment.length;
    }

    return true;
}
