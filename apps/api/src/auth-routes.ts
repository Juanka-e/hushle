import type { IncomingMessage } from "node:http";
import {
    authenticateAccessToken,
    checkPasswordLoginRateLimit,
    clearPasswordLoginAccountFailures,
    consumeAuthRateLimit,
    listMobileSessions,
    loginWithPassword,
    MobileAuthError,
    recordPasswordLoginFailure,
    revokeMobileSession,
    rotateRefreshToken,
    type MobileAuthOptions,
    type MobileTokenPair,
} from "@hushle/platform-auth";
import {
    MOBILE_API_ROUTES,
    type MobileApiError,
    type MobileAuthLoginData,
    type MobileAuthUserData,
    type MobileAuthSessionData,
    type MobileAuthTokenData,
} from "@hushle/api-contracts";
import { verifyMobileLoginCaptcha } from "./captcha.js";

export type AuthRouteResult = {
    status: number;
    data?: unknown;
    error?: {
        code: MobileApiError["error"]["code"];
        message: string;
    };
    headers?: Record<string, string>;
};

type AuthRouteContext = {
    authEnabled: boolean;
    authOptions: MobileAuthOptions;
    body: unknown;
    method: string;
    pathname: string;
    remoteIp: string;
    request: IncomingMessage;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function readString(
    value: unknown,
    min: number,
    max: number
): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length >= min && normalized.length <= max
        ? normalized
        : null;
}

function toTokenData(tokens: MobileTokenPair): MobileAuthTokenData {
    return {
        tokenType: "Bearer",
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
        sessionId: tokens.sessionId,
    };
}

function toUserData(user: {
    id: number;
    username: string;
    role: string;
}): MobileAuthUserData {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
    };
}

function getBearerToken(request: IncomingMessage): string | null {
    const value = request.headers.authorization;
    if (!value) return null;
    const match = /^Bearer ([^\s]+)$/.exec(value);
    return match?.[1] ?? null;
}

function mapAuthError(error: unknown): AuthRouteResult {
    if (!(error instanceof MobileAuthError)) {
        throw error;
    }
    const status =
        error.code === "account_suspended"
            ? 403
            : error.code === "token_reuse_detected"
              ? 401
              : 401;
    return {
        status,
        error: {
            code: error.code,
            message:
                error.code === "account_suspended"
                    ? "Sign-in is unavailable for this account."
                    : "Authentication failed.",
        },
    };
}

async function requireAccess(request: IncomingMessage) {
    const token = getBearerToken(request);
    if (!token) throw new MobileAuthError("invalid_token");
    return authenticateAccessToken(token);
}

async function applyRateLimit(
    scope: string,
    identifier: string,
    limit: number
): Promise<AuthRouteResult | null> {
    const result = await consumeAuthRateLimit({
        scope,
        identifier,
        limit,
        windowMs: 10 * 60_000,
    });
    if (result.allowed) return null;
    return {
        status: 429,
        headers: { "Retry-After": String(result.retryAfterSeconds) },
        error: {
            code: "rate_limited",
            message: "Too many attempts. Try again later.",
        },
    };
}

export function isAuthRoute(pathname: string): boolean {
    return (
        pathname === MOBILE_API_ROUTES.authLogin ||
        pathname === MOBILE_API_ROUTES.authRefresh ||
        pathname === MOBILE_API_ROUTES.authLogout ||
        pathname === MOBILE_API_ROUTES.authSessions ||
        pathname.startsWith(`${MOBILE_API_ROUTES.authSessions}/`)
    );
}

export async function handleAuthRoute(
    context: AuthRouteContext
): Promise<AuthRouteResult> {
    if (!context.authEnabled) {
        return {
            status: 503,
            error: {
                code: "auth_unavailable",
                message: "Mobile authentication is not enabled.",
            },
        };
    }

    try {
        if (
            context.pathname === MOBILE_API_ROUTES.authLogin &&
            context.method === "POST"
        ) {
            const body = asRecord(context.body);
            const username = readString(body?.username, 1, 50);
            const password =
                typeof body?.password === "string" &&
                body.password.length >= 1 &&
                body.password.length <= 255
                    ? body.password
                    : null;
            const deviceName = readString(body?.deviceName, 1, 80);
            if (!username || !password || !deviceName) {
                return {
                    status: 400,
                    error: {
                        code: "invalid_request",
                        message: "Login payload is invalid.",
                    },
                };
            }

            const loginLimit = await checkPasswordLoginRateLimit({
                remoteIp: context.remoteIp,
                username,
            });
            if (!loginLimit.allowed) {
                return {
                    status: 429,
                    headers: {
                        "Retry-After": String(loginLimit.retryAfterSeconds),
                    },
                    error: {
                        code: "rate_limited",
                        message: "Too many attempts. Try again later.",
                    },
                };
            }

            const captchaOk = await verifyMobileLoginCaptcha({
                token:
                    typeof body?.captchaToken === "string"
                        ? body.captchaToken
                        : null,
                remoteIp: context.remoteIp,
            });
            if (!captchaOk) {
                return {
                    status: 403,
                    error: {
                        code: "captcha_failed",
                        message: "Security verification failed.",
                    },
                };
            }

            let result;
            try {
                result = await loginWithPassword({
                    username,
                    password,
                    deviceName,
                    userAgent:
                        typeof context.request.headers["user-agent"] === "string"
                            ? context.request.headers["user-agent"]
                            : null,
                    options: context.authOptions,
                });
            } catch (error) {
                if (
                    error instanceof MobileAuthError &&
                    error.code === "invalid_credentials"
                ) {
                    await recordPasswordLoginFailure({
                        remoteIp: context.remoteIp,
                        username,
                    });
                }
                throw error;
            }
            await clearPasswordLoginAccountFailures(username);
            const data: MobileAuthLoginData = {
                user: toUserData(result.user),
                tokens: toTokenData(result.tokens),
            };
            return { status: 200, data };
        }

        if (
            context.pathname === MOBILE_API_ROUTES.authRefresh &&
            context.method === "POST"
        ) {
            const limited = await applyRateLimit(
                "refresh-ip",
                context.remoteIp,
                60
            );
            if (limited) return limited;
            const body = asRecord(context.body);
            const refreshToken = readString(body?.refreshToken, 20, 200);
            if (!refreshToken) {
                return {
                    status: 400,
                    error: {
                        code: "invalid_request",
                        message: "Refresh payload is invalid.",
                    },
                };
            }
            const result = await rotateRefreshToken({
                refreshToken,
                options: context.authOptions,
            });
            const data: MobileAuthLoginData = {
                user: toUserData(result.user),
                tokens: toTokenData(result.tokens),
            };
            return { status: 200, data };
        }

        if (
            context.pathname === MOBILE_API_ROUTES.authLogout &&
            context.method === "POST"
        ) {
            const auth = await requireAccess(context.request);
            await revokeMobileSession({
                userId: auth.user.id,
                sessionId: auth.sessionId,
                reason: "logout",
            });
            return { status: 204 };
        }

        if (
            context.pathname === MOBILE_API_ROUTES.authSessions &&
            context.method === "GET"
        ) {
            const auth = await requireAccess(context.request);
            const sessions = await listMobileSessions(
                auth.user.id,
                auth.sessionId
            );
            const data: MobileAuthSessionData[] = sessions.map((session) => ({
                ...session,
                createdAt: session.createdAt.toISOString(),
                lastSeenAt: session.lastSeenAt.toISOString(),
            }));
            return { status: 200, data };
        }

        if (
            context.pathname.startsWith(
                `${MOBILE_API_ROUTES.authSessions}/`
            ) &&
            context.method === "DELETE"
        ) {
            const auth = await requireAccess(context.request);
            let sessionId: string;
            try {
                sessionId = decodeURIComponent(
                    context.pathname.slice(
                        `${MOBILE_API_ROUTES.authSessions}/`.length
                    )
                );
            } catch {
                sessionId = "";
            }
            if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
                return {
                    status: 400,
                    error: {
                        code: "invalid_request",
                        message: "Session id is invalid.",
                    },
                };
            }
            const revoked = await revokeMobileSession({
                userId: auth.user.id,
                sessionId,
            });
            return revoked
                ? { status: 204 }
                : {
                      status: 404,
                      error: {
                          code: "session_not_found",
                          message: "Session was not found.",
                      },
                  };
        }

        return {
            status: 405,
            error: {
                code: "method_not_allowed",
                message: "Method is not allowed for this endpoint.",
            },
        };
    } catch (error) {
        return mapAuthError(error);
    }
}
