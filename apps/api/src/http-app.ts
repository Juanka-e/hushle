import type { IncomingMessage, ServerResponse } from "node:http";
import {
    getOrCreateRequestId,
    reportError,
} from "@hushle/platform-observability";
import {
    buildMobileApiError,
    buildMobileApiSuccess,
    MOBILE_API_ROUTES,
    MOBILE_API_VERSION,
    type MobileApiError,
    type MobileApiHealthData,
    type MobileApiRuntimeMetaData,
} from "@hushle/api-contracts";
import {
    handleAuthRoute,
    isAuthRoute,
    type AuthRouteResult,
} from "./auth-routes.js";
import {
    handlePlayerRoute,
    isPlayerRoute,
} from "./player-routes.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const MAX_JSON_BODY_BYTES = 16 * 1024;

export interface MobileApiHttpOptions {
    allowedOrigins: ReadonlySet<string>;
    authEnabled?: boolean;
    trustProxy?: boolean;
    accessTokenTtlMs?: number;
    refreshTokenTtlMs?: number;
}

function getRequestId(request: IncomingMessage): string {
    const candidate = request.headers["x-request-id"];
    return getOrCreateRequestId(
        typeof candidate === "string" ? candidate : undefined
    );
}

function appendVary(response: ServerResponse, value: string): void {
    const existing = response.getHeader("Vary");
    const values = new Set(
        (typeof existing === "string" ? existing.split(",") : [])
            .map((entry) => entry.trim())
            .filter(Boolean)
    );
    values.add(value);
    response.setHeader("Vary", [...values].join(", "));
}

function applyBaseHeaders(response: ServerResponse, requestId: string): void {
    response.setHeader("Content-Type", JSON_CONTENT_TYPE);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Request-Id", requestId);
    response.setHeader("X-Api-Version", MOBILE_API_VERSION);
}

function applyCorsHeaders(
    request: IncomingMessage,
    response: ServerResponse,
    allowedOrigins: ReadonlySet<string>
): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;

    appendVary(response, "Origin");
    if (!allowedOrigins.has(origin)) return false;
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS"
    );
    response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Request-Id"
    );
    response.setHeader(
        "Access-Control-Expose-Headers",
        "Retry-After, X-Api-Version, X-Request-Id"
    );
    response.setHeader("Access-Control-Max-Age", "600");
    return true;
}

function sendJson(
    response: ServerResponse,
    statusCode: number,
    payload?: unknown
): void {
    response.statusCode = statusCode;
    if (statusCode === 204) {
        response.removeHeader("Content-Type");
        response.end();
        return;
    }
    response.end(JSON.stringify(payload));
}

function getRemoteIp(request: IncomingMessage, trustProxy: boolean): string {
    if (trustProxy) {
        const realIp = request.headers["x-real-ip"];
        if (typeof realIp === "string" && realIp.trim()) {
            return realIp.trim().slice(0, 64);
        }
        const forwarded = request.headers["x-forwarded-for"];
        if (typeof forwarded === "string") {
            const first = forwarded.split(",")[0]?.trim();
            if (first) return first.slice(0, 64);
        }
    }
    return request.socket.remoteAddress?.slice(0, 64) || "unknown";
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
    if (
        !contentType &&
        !request.headers["content-length"] &&
        !request.headers["transfer-encoding"]
    ) {
        return {};
    }
    if (contentType !== "application/json") {
        throw new Error("unsupported_content_type");
    }
    const declaredLength = Number(request.headers["content-length"] ?? 0);
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_JSON_BODY_BYTES
    ) {
        throw new Error("body_too_large");
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_JSON_BODY_BYTES) {
            throw new Error("body_too_large");
        }
        chunks.push(buffer);
    }
    if (size === 0) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Error("invalid_json");
    }
}

function sendAuthResult(
    response: ServerResponse,
    requestId: string,
    result: AuthRouteResult
): void {
    for (const [key, value] of Object.entries(result.headers ?? {})) {
        response.setHeader(key, value);
    }
    if (result.error) {
        sendJson(
            response,
            result.status,
            buildMobileApiError(
                result.error.code as MobileApiError["error"]["code"],
                result.error.message,
                requestId
            )
        );
        return;
    }
    sendJson(
        response,
        result.status,
        result.status === 204
            ? undefined
            : buildMobileApiSuccess(result.data, requestId)
    );
}

export function createMobileApiHttpHandler(options: MobileApiHttpOptions) {
    return async (
        request: IncomingMessage,
        response: ServerResponse
    ): Promise<void> => {
        const requestId = getRequestId(request);
        applyBaseHeaders(response, requestId);

        if (!applyCorsHeaders(request, response, options.allowedOrigins)) {
            sendJson(
                response,
                403,
                buildMobileApiError(
                    "cors_denied",
                    "Request origin is not allowed.",
                    requestId
                )
            );
            return;
        }
        if (request.method === "OPTIONS") {
            sendJson(response, 204);
            return;
        }

        let url: URL;
        try {
            url = new URL(request.url ?? "/", "http://api.internal");
        } catch {
            sendJson(
                response,
                400,
                buildMobileApiError(
                    "invalid_request",
                    "Request URL is invalid.",
                    requestId
                )
            );
            return;
        }

        try {
            if (isAuthRoute(url.pathname) || isPlayerRoute(url.pathname)) {
                let body: unknown = {};
                if (
                    request.method === "POST" ||
                    request.method === "PATCH"
                ) {
                    try {
                        body = await readJsonBody(request);
                    } catch {
                        sendJson(
                            response,
                            400,
                            buildMobileApiError(
                                "invalid_request",
                                "Request body must be valid JSON.",
                                requestId
                            )
                        );
                        return;
                    }
                }
                const remoteIp = getRemoteIp(
                    request,
                    options.trustProxy ?? false
                );
                const result = isAuthRoute(url.pathname)
                    ? await handleAuthRoute({
                          authEnabled: options.authEnabled ?? false,
                          authOptions: {
                              accessTtlMs:
                                  options.accessTokenTtlMs ?? 15 * 60_000,
                              refreshTtlMs:
                                  options.refreshTokenTtlMs ??
                                  30 * 24 * 60 * 60_000,
                          },
                          body,
                          method: request.method ?? "GET",
                          pathname: url.pathname,
                          remoteIp,
                          request,
                      })
                    : await handlePlayerRoute({
                          authEnabled: options.authEnabled ?? false,
                          body,
                          method: request.method ?? "GET",
                          pathname: url.pathname,
                          query: url.searchParams,
                          remoteIp,
                          request,
                      });
                sendAuthResult(response, requestId, result);
                return;
            }

            const knownRoute =
                url.pathname === MOBILE_API_ROUTES.health ||
                url.pathname === MOBILE_API_ROUTES.meta;
            if (knownRoute && request.method !== "GET") {
                response.setHeader("Allow", "GET, OPTIONS");
                sendJson(
                    response,
                    405,
                    buildMobileApiError(
                        "method_not_allowed",
                        "Method is not allowed for this endpoint.",
                        requestId
                    )
                );
                return;
            }
            if (
                request.method === "GET" &&
                url.pathname === MOBILE_API_ROUTES.health
            ) {
                const data: MobileApiHealthData = {
                    service: "hushle-api",
                    status: "ok",
                };
                sendJson(
                    response,
                    200,
                    buildMobileApiSuccess(data, requestId)
                );
                return;
            }
            if (
                request.method === "GET" &&
                url.pathname === MOBILE_API_ROUTES.meta
            ) {
                const data: MobileApiRuntimeMetaData = {
                    service: "hushle-api",
                    apiVersion: MOBILE_API_VERSION,
                    capabilities: {
                        runtimeMeta: "available",
                        bearerAuth: options.authEnabled
                            ? "available"
                            : "planned",
                        profile: options.authEnabled
                            ? "available"
                            : "planned",
                        inventory: options.authEnabled
                            ? "available"
                            : "planned",
                        storeCatalog: options.authEnabled
                            ? "available"
                            : "planned",
                        progression: "planned",
                        realtimeGameplay: "web_runtime_only",
                        admin: "web_runtime_only",
                    },
                };
                sendJson(
                    response,
                    200,
                    buildMobileApiSuccess(data, requestId)
                );
                return;
            }

            sendJson(
                response,
                404,
                buildMobileApiError(
                    "not_found",
                    "Endpoint was not found.",
                    requestId
                )
            );
        } catch (error) {
            await reportError({
                service: "hushle-api",
                event: "http.request.failed",
                requestId,
                error,
                context: {
                    method: request.method ?? "unknown",
                    path: url.pathname,
                },
            });
            if (!response.headersSent) {
                sendJson(
                    response,
                    500,
                    buildMobileApiError(
                        "internal_error",
                        "An internal error occurred.",
                        requestId
                    )
                );
            } else {
                response.destroy();
            }
        }
    };
}
