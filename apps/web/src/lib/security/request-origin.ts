import { parseTrustedWebOrigins } from "./web-origin-policy";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_FETCH_SITES = new Set(["same-origin"]);

interface OriginCheckRequest {
    headers: Headers;
    method: string;
    url: string;
}

interface StateChangeOriginEnvironment {
    [key: string]: string | undefined;
    NODE_ENV?: string;
    NEXT_PUBLIC_SITE_URL?: string;
    TRUSTED_WEB_ORIGINS?: string;
    STATE_CHANGE_ORIGIN_POLICY?: string;
}

interface StateChangeOriginOptions {
    env?: StateChangeOriginEnvironment;
    trustedOrigins?: ReadonlySet<string>;
}

export type StateChangeOriginPolicy = "strict" | "compatible";

export function resolveStateChangeOriginPolicy(
    env: StateChangeOriginEnvironment = process.env
): StateChangeOriginPolicy {
    if (env.NODE_ENV === "production") return "strict";
    return env.STATE_CHANGE_ORIGIN_POLICY === "strict" ? "strict" : "compatible";
}

function developmentRequestOrigins(request: OriginCheckRequest): ReadonlySet<string> {
    const expectedOrigins = new Set<string>();

    try {
        const requestUrl = new URL(request.url);
        expectedOrigins.add(requestUrl.origin);
        const forwardedProto = request.headers
            .get("x-forwarded-proto")
            ?.split(",", 1)[0]
            ?.trim();
        const protocol = forwardedProto
            ? `${forwardedProto.replace(/:$/, "")}:`
            : requestUrl.protocol;
        const forwardedHost = request.headers
            .get("x-forwarded-host")
            ?.split(",", 1)[0]
            ?.trim();
        const host = forwardedHost || request.headers.get("host")?.trim();

        if (host && (protocol === "http:" || protocol === "https:")) {
            expectedOrigins.add(new URL(`${protocol}//${host}`).origin);
        }
    } catch {
        return expectedOrigins;
    }

    return expectedOrigins;
}

function hasTrustedOrigin(
    request: OriginCheckRequest,
    origin: string,
    options: StateChangeOriginOptions
): boolean {
    try {
        const url = new URL(origin);
        if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
            return false;
        }

        const env = options.env ?? process.env;
        const trustedOrigins =
            options.trustedOrigins ??
            (env.NODE_ENV === "production"
                ? parseTrustedWebOrigins(env)
                : developmentRequestOrigins(request));
        return trustedOrigins.has(url.origin);
    } catch {
        return false;
    }
}

export function isTrustedStateChangeRequest(
    request: OriginCheckRequest,
    options: StateChangeOriginOptions = {}
): boolean {
    if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
        return true;
    }

    const originHeader = request.headers.get("origin");
    const fetchSiteHeader = request.headers.get("sec-fetch-site")?.toLowerCase();

    if (fetchSiteHeader && !SAFE_FETCH_SITES.has(fetchSiteHeader)) {
        return false;
    }

    if (originHeader) {
        return hasTrustedOrigin(request, originHeader, options);
    }

    if (resolveStateChangeOriginPolicy(options.env) === "strict") {
        return false;
    }

    return !fetchSiteHeader || SAFE_FETCH_SITES.has(fetchSiteHeader);
}
