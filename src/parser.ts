import { MAX_ROBOTS_TXT_BYTES } from "./constants.js";
import type { RobotsTxt, RobotsTxtGroup } from "./types.js";
import { PRODUCT_TOKEN_PATTERN } from "./validation.js";

/** Parses up to 500 KiB of UTF-8 robots.txt text, ignoring unsupported directives and invalid records. Does not fetch. */
export function parseRobotsTxt(raw: string): RobotsTxt {
    const bytes = new TextEncoder().encode(raw);
    const isTruncated = bytes.length > MAX_ROBOTS_TXT_BYTES;
    const content = isTruncated
        ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, MAX_ROBOTS_TXT_BYTES), { stream: true })
        : raw;
    const lines = content.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
    const groups: RobotsTxtGroup[] = [];

    let group: RobotsTxtGroup | undefined;
    let isRuleSection = false;
    let isCrawlDelaySection = false;

    if (isTruncated && !/[\r\n]$/.test(content)) {
        lines.pop();
    }

    for (const [index, rawLine] of lines.entries()) {
        const commentIndex = rawLine.indexOf("#");
        const line = commentIndex === -1 ? rawLine : rawLine.slice(0, commentIndex);
        const record = /^[\t ]*([a-z-]+)[\t ]*:[\t ]*([\s\S]*?)[\t ]*$/i.exec(line);

        if (!record) {
            continue;
        }

        const directive = record[1]!.toLowerCase();
        const value = record[2]!;

        if (directive === "user-agent") {
            if (value !== "*" && !PRODUCT_TOKEN_PATTERN.test(value)) {
                continue;
            }

            if (!group || isRuleSection || isCrawlDelaySection) {
                const rules = group && !isRuleSection ? group.rules : [];

                group = { userAgentTokens: [], rules: rules };
                groups.push(group);
                isRuleSection = false;
                isCrawlDelaySection = false;
            }

            group.userAgentTokens.push({ value: value, line: index + 1 });

            continue;
        }

        if (!group) {
            continue;
        }

        if (directive === "crawl-delay") {
            const crawlDelay = Number(value);

            isCrawlDelaySection = true;

            if (/^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(crawlDelay)) {
                group.crawlDelay = Math.max(group.crawlDelay ?? 0, crawlDelay);
            }

            continue;
        }

        if (directive !== "allow" && directive !== "disallow") {
            continue;
        }

        isRuleSection = true;

        if (!value || !/^[/*]/.test(value) || /[\u0000-\u0020\u007F]/.test(value)) {
            continue;
        }

        group.rules.push({ directive: directive, pattern: value, line: index + 1 });
    }

    return { raw: content, groups: groups };
}
