export const PRODUCT_TOKEN_PATTERN = /^[a-z_-]+$/i;

export function normalizeUrl(urlInput: string | URL): URL {
    const url = new URL(urlInput);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new TypeError("Only HTTP and HTTPS URLs are supported.");
    }

    if (url.username || url.password) {
        throw new TypeError("URLs must not contain credentials.");
    }

    return url;
}

export function validateUserAgentToken(userAgentToken: string): void {
    if (typeof userAgentToken !== "string" || !PRODUCT_TOKEN_PATTERN.test(userAgentToken)) {
        throw new TypeError("userAgentToken must be a robots.txt user agent token containing only letters, underscores, or hyphens.");
    }
}

export function validateUserAgent(userAgent: string): void {
    if (!userAgent.trim()) {
        throw new TypeError("userAgent must not be empty.");
    }

    new Headers({ "User-Agent": userAgent });
}
