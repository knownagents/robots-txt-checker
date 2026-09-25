export const MAX_ROBOTS_TXT_BYTES = 500 * 1024;
export const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const ROBOTS_TXT_PATH = "/robots.txt";

export const HTTP_STATUS_CODES = {
    BAD_REQUEST: 400,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
} as const;
