import { HTTP_STATUS_CODES, ROBOTS_TXT_PATH } from "./constants.js";
import { parseRobotsTxt } from "./parser.js";
import type { RobotsTxt } from "./types.js";

const ACCEPT_CONTENT_TYPE = "text/plain";

export interface RobotsTxtFetchOptions {
    fetch: typeof globalThis.fetch;
    userAgent: string;
    requestTimeoutMs: number;
}

export interface RobotsTxtFetchResponse {
    robotsTxt?: RobotsTxt;
    statusCode?: number;
    isUnreachable: boolean;
}

export async function fetchRobotsTxtResponse(origin: string, options: RobotsTxtFetchOptions): Promise<RobotsTxtFetchResponse> {
    const signal = AbortSignal.timeout(options.requestTimeoutMs);
    const fetchImplementation = options.fetch;
    let statusCode: number | undefined;

    try {
        const url = new URL(ROBOTS_TXT_PATH, origin);
        const response = await fetchImplementation(url, {
            headers: {
                "User-Agent": options.userAgent,
                Accept: ACCEPT_CONTENT_TYPE,
            },
            signal: signal,
        });

        statusCode = response.status;

        if (response.ok) {
            const raw = await response.text();
            const robotsTxt = parseRobotsTxt(raw);

            return {
                robotsTxt: robotsTxt,
                statusCode: response.status,
                isUnreachable: false,
            };
        }

        await response.body?.cancel().catch(() => {
            return undefined;
        });

        if (response.status >= HTTP_STATUS_CODES.BAD_REQUEST && response.status < HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR && response.status !== HTTP_STATUS_CODES.TOO_MANY_REQUESTS) {
            return {
                statusCode: response.status,
                isUnreachable: false,
            };
        }

        return {
            statusCode: response.status,
            isUnreachable: true,
        };
    } catch {
        return {
            statusCode: statusCode,
            isUnreachable: true,
        };
    }
}
