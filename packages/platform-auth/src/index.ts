import { createHash, randomBytes } from "node:crypto";
import bcryptjs from "bcryptjs";
import { getRedisClient, getRedisKey } from "@hushle/platform-cache";
import {
    MobileAuthTokenKind,
    Prisma,
    UserAccountStatus,
    prisma,
} from "@hushle/platform-db";

const ACCESS_PREFIX = "hma_";
const REFRESH_PREFIX = "hmr_";
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;
const MAX_LOCAL_RATE_LIMIT_ENTRIES = 10_000;
const MAX_ACTIVE_MOBILE_SESSIONS = 10;
const PASSWORD_LOGIN_IP_LIMIT = 30;
const PASSWORD_LOGIN_IP_WINDOW_MS = 10 * 60_000;
const PASSWORD_LOGIN_ACCOUNT_LIMIT = 8;
const PASSWORD_LOGIN_ACCOUNT_WINDOW_MS = 15 * 60_000;

export interface AccountCapabilityRecord {
    accountStatus: UserAccountStatus;
    emailVerifiedAt: Date | null;
    emailVerificationRequiredAt: Date | null;
}

export type AccountCapability =
    | "session"
    | "email_verification"
    | "profile"
    | "room"
    | "store_mutation"
    | "reward";

export function isEmailVerificationRestrictionActive(
    account: AccountCapabilityRecord
): boolean {
    return (
        account.accountStatus ===
            UserAccountStatus.pending_email_verification &&
        account.emailVerificationRequiredAt !== null &&
        account.emailVerifiedAt === null
    );
}

export function canUseAccountCapability(
    account: AccountCapabilityRecord,
    capability: AccountCapability
): boolean {
    if (!isEmailVerificationRestrictionActive(account)) {
        return true;
    }
    return (
        capability === "session" ||
        capability === "email_verification" ||
        capability === "profile"
    );
}

export type MobileTokenPair = {
    accessToken: string;
    accessTokenExpiresAt: Date;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    sessionId: string;
};

export type MobileAuthUser = {
    id: number;
    username: string;
    role: string;
    accountStatus: UserAccountStatus;
    emailVerifiedAt: Date | null;
    emailVerificationRequiredAt: Date | null;
};

export type MobileAuthSessionView = {
    id: string;
    deviceName: string;
    createdAt: Date;
    lastSeenAt: Date;
    current: boolean;
};

export class MobileAuthError extends Error {
    constructor(
        public readonly code:
            | "invalid_credentials"
            | "invalid_token"
            | "token_expired"
            | "token_reuse_detected"
            | "account_suspended"
            | "session_not_found",
        message = code
    ) {
        super(message);
        this.name = "MobileAuthError";
    }
}

export type MobileAuthOptions = {
    accessTtlMs: number;
    refreshTtlMs: number;
};

type LocalRateLimitEntry = {
    count: number;
    expiresAt: number;
};

const localRateLimits = new Map<string, LocalRateLimitEntry>();

export type PasswordLoginRateLimitResult = {
    allowed: boolean;
    retryAfterSeconds: number;
    blockedBy: "ip" | "account" | null;
};

type AuthRateLimitCounterResult = {
    allowed: boolean;
    retryAfterSeconds: number;
    count: number;
};

function createOpaqueToken(prefix: string): string {
    return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function hashOpaqueToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isSuspensionActive(record: {
    isSuspended: boolean;
    suspendedUntil: Date | null;
}): boolean {
    return (
        record.isSuspended &&
        (!record.suspendedUntil || record.suspendedUntil.getTime() > Date.now())
    );
}

function validateOptions(options: MobileAuthOptions): void {
    if (
        !Number.isFinite(options.accessTtlMs) ||
        options.accessTtlMs < 60_000 ||
        options.accessTtlMs > 60 * 60_000
    ) {
        throw new Error("accessTtlMs must be between 1 minute and 1 hour");
    }
    if (
        !Number.isFinite(options.refreshTtlMs) ||
        options.refreshTtlMs < 60 * 60_000 ||
        options.refreshTtlMs > 180 * 24 * 60 * 60_000
    ) {
        throw new Error("refreshTtlMs must be between 1 hour and 180 days");
    }
}

async function createTokenPair(
    tx: Prisma.TransactionClient,
    sessionId: string,
    options: MobileAuthOptions,
    rotationCounter: number,
    now: Date
): Promise<MobileTokenPair> {
    const accessToken = createOpaqueToken(ACCESS_PREFIX);
    const refreshToken = createOpaqueToken(REFRESH_PREFIX);
    const accessTokenExpiresAt = new Date(now.getTime() + options.accessTtlMs);
    const refreshTokenExpiresAt = new Date(now.getTime() + options.refreshTtlMs);

    await tx.mobileAuthToken.createMany({
        data: [
            {
                sessionId,
                kind: MobileAuthTokenKind.access,
                tokenHash: hashOpaqueToken(accessToken),
                expiresAt: accessTokenExpiresAt,
                rotationCounter,
            },
            {
                sessionId,
                kind: MobileAuthTokenKind.refresh,
                tokenHash: hashOpaqueToken(refreshToken),
                expiresAt: refreshTokenExpiresAt,
                rotationCounter,
            },
        ],
    });

    return {
        accessToken,
        accessTokenExpiresAt,
        refreshToken,
        refreshTokenExpiresAt,
        sessionId,
    };
}

async function revokeSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
    reason: string,
    now: Date
): Promise<void> {
    await tx.mobileAuthSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
    });
    await tx.mobileAuthToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
    });
}

export async function loginWithPassword(input: {
    username: string;
    password: string;
    deviceName: string;
    userAgent?: string | null;
    options: MobileAuthOptions;
}): Promise<{ user: MobileAuthUser; tokens: MobileTokenPair }> {
    validateOptions(input.options);
    const username = input.username.trim();
    const user = await prisma.user.findUnique({
        where: { username },
        select: {
            id: true,
            username: true,
            password: true,
            role: true,
            accountStatus: true,
            emailVerifiedAt: true,
            emailVerificationRequiredAt: true,
            isSuspended: true,
            suspendedUntil: true,
        },
    });

    if (
        !user ||
        !user.password ||
        !(await bcryptjs.compare(input.password, user.password))
    ) {
        throw new MobileAuthError("invalid_credentials");
    }
    if (isSuspensionActive(user)) {
        throw new MobileAuthError("account_suspended");
    }
    if (user.isSuspended && user.suspendedUntil) {
        await prisma.user.update({
            where: { id: user.id },
            data: {
                isSuspended: false,
                suspendedAt: null,
                suspendedUntil: null,
                suspensionReason: null,
            },
        });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
        const sessionsToEvict = await tx.mobileAuthSession.findMany({
            where: {
                userId: user.id,
                revokedAt: null,
                refreshExpiresAt: { gt: now },
            },
            orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
            skip: MAX_ACTIVE_MOBILE_SESSIONS - 1,
            select: { id: true },
        });
        for (const staleSession of sessionsToEvict) {
            await revokeSession(tx, staleSession.id, "session_limit", now);
        }
        const session = await tx.mobileAuthSession.create({
            data: {
                userId: user.id,
                deviceName: input.deviceName.trim().slice(0, 80),
                userAgent: input.userAgent?.trim().slice(0, 255) || null,
                refreshExpiresAt: new Date(
                    now.getTime() + input.options.refreshTtlMs
                ),
            },
        });
        const tokens = await createTokenPair(
            tx,
            session.id,
            input.options,
            0,
            now
        );
        return { session, tokens };
    });

    return {
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            accountStatus: user.accountStatus,
            emailVerifiedAt: user.emailVerifiedAt,
            emailVerificationRequiredAt:
                user.emailVerificationRequiredAt,
        },
        tokens: result.tokens,
    };
}

export async function rotateRefreshToken(input: {
    refreshToken: string;
    options: MobileAuthOptions;
}): Promise<{ user: MobileAuthUser; tokens: MobileTokenPair }> {
    validateOptions(input.options);
    if (!input.refreshToken.startsWith(REFRESH_PREFIX)) {
        throw new MobileAuthError("invalid_token");
    }

    const tokenHash = hashOpaqueToken(input.refreshToken);
    type RefreshOutcome =
        | {
              error:
                  | "invalid_token"
                  | "token_expired"
                  | "token_reuse_detected"
                  | "account_suspended";
          }
        | {
              error: null;
              user: MobileAuthUser;
              tokens: MobileTokenPair;
          };
    let outcome: RefreshOutcome | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            outcome = await prisma.$transaction(
                async (tx): Promise<RefreshOutcome> => {
                    const now = new Date();
                    const token = await tx.mobileAuthToken.findUnique({
                        where: { tokenHash },
                        include: {
                            session: {
                                include: {
                                    user: {
                                        select: {
                                            id: true,
                                            username: true,
                                            role: true,
                                            accountStatus: true,
                                            emailVerifiedAt: true,
                                            emailVerificationRequiredAt: true,
                                            isSuspended: true,
                                            suspendedUntil: true,
                                        },
                                    },
                                },
                            },
                        },
                    });

                    if (!token || token.kind !== MobileAuthTokenKind.refresh) {
                        throw new MobileAuthError("invalid_token");
                    }
                    if (token.consumedAt) {
                        await revokeSession(
                            tx,
                            token.sessionId,
                            "refresh_token_reuse",
                            now
                        );
                        return { error: "token_reuse_detected" as const };
                    }
                    if (token.revokedAt || token.session.revokedAt) {
                        return { error: "invalid_token" as const };
                    }
                    if (
                        token.expiresAt <= now ||
                        token.session.refreshExpiresAt <= now
                    ) {
                        await revokeSession(tx, token.sessionId, "expired", now);
                        return { error: "token_expired" as const };
                    }
                    if (isSuspensionActive(token.session.user)) {
                        await revokeSession(tx, token.sessionId, "user_suspended", now);
                        return { error: "account_suspended" as const };
                    }

                    const consumed = await tx.mobileAuthToken.updateMany({
                        where: {
                            id: token.id,
                            consumedAt: null,
                            revokedAt: null,
                        },
                        data: { consumedAt: now },
                    });
                    if (consumed.count !== 1) {
                        await revokeSession(
                            tx,
                            token.sessionId,
                            "refresh_token_reuse",
                            now
                        );
                        return { error: "token_reuse_detected" as const };
                    }

                    await tx.mobileAuthToken.deleteMany({
                        where: {
                            sessionId: token.sessionId,
                            kind: MobileAuthTokenKind.access,
                        },
                    });
                    const tokens = await createTokenPair(
                        tx,
                        token.sessionId,
                        input.options,
                        token.rotationCounter + 1,
                        now
                    );
                    await tx.mobileAuthSession.update({
                        where: { id: token.sessionId },
                        data: {
                            lastSeenAt: now,
                            refreshExpiresAt: tokens.refreshTokenExpiresAt,
                        },
                    });

                    return {
                        error: null,
                        user: {
                            id: token.session.user.id,
                            username: token.session.user.username,
                            role: token.session.user.role,
                            accountStatus:
                                token.session.user.accountStatus,
                            emailVerifiedAt:
                                token.session.user.emailVerifiedAt,
                            emailVerificationRequiredAt:
                                token.session.user
                                    .emailVerificationRequiredAt,
                        },
                        tokens,
                    };
                },
                {
                    isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                }
            );
            break;
        } catch (error) {
            const retryable =
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2034";
            if (!retryable || attempt === 2) throw error;
        }
    }
    if (!outcome) {
        throw new Error("Refresh rotation did not produce an outcome");
    }
    if (outcome.error) {
        throw new MobileAuthError(outcome.error);
    }
    return {
        user: outcome.user,
        tokens: outcome.tokens,
    };
}

export async function authenticateAccessToken(
    accessToken: string
): Promise<{ user: MobileAuthUser; sessionId: string }> {
    if (!accessToken.startsWith(ACCESS_PREFIX)) {
        throw new MobileAuthError("invalid_token");
    }

    const now = new Date();
    const token = await prisma.mobileAuthToken.findUnique({
        where: { tokenHash: hashOpaqueToken(accessToken) },
        include: {
            session: {
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            role: true,
                            accountStatus: true,
                            emailVerifiedAt: true,
                            emailVerificationRequiredAt: true,
                            isSuspended: true,
                            suspendedUntil: true,
                        },
                    },
                },
            },
        },
    });

    if (
        !token ||
        token.kind !== MobileAuthTokenKind.access ||
        token.revokedAt ||
        token.consumedAt ||
        token.session.revokedAt
    ) {
        throw new MobileAuthError("invalid_token");
    }
    if (token.expiresAt <= now) {
        throw new MobileAuthError("token_expired");
    }
    if (isSuspensionActive(token.session.user)) {
        await prisma.$transaction((tx) =>
            revokeSession(tx, token.sessionId, "user_suspended", now)
        );
        throw new MobileAuthError("account_suspended");
    }

    if (
        token.session.lastSeenAt.getTime() <=
        now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS
    ) {
        void prisma.mobileAuthSession
            .updateMany({
                where: {
                    id: token.sessionId,
                    lastSeenAt: {
                        lte: new Date(
                            now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS
                        ),
                    },
                },
                data: { lastSeenAt: now },
            })
            .catch(() => undefined);
    }

    return {
        user: {
            id: token.session.user.id,
            username: token.session.user.username,
            role: token.session.user.role,
            accountStatus: token.session.user.accountStatus,
            emailVerifiedAt: token.session.user.emailVerifiedAt,
            emailVerificationRequiredAt:
                token.session.user.emailVerificationRequiredAt,
        },
        sessionId: token.sessionId,
    };
}

export async function listMobileSessions(
    userId: number,
    currentSessionId: string
): Promise<MobileAuthSessionView[]> {
    const now = new Date();
    const sessions = await prisma.mobileAuthSession.findMany({
        where: {
            userId,
            revokedAt: null,
            refreshExpiresAt: { gt: now },
        },
        orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
        select: {
            id: true,
            deviceName: true,
            createdAt: true,
            lastSeenAt: true,
        },
    });
    return sessions.map((session) => ({
        ...session,
        current: session.id === currentSessionId,
    }));
}

export async function revokeMobileSession(input: {
    userId: number;
    sessionId: string;
    reason?: string;
}): Promise<boolean> {
    const session = await prisma.mobileAuthSession.findFirst({
        where: { id: input.sessionId, userId: input.userId },
        select: { id: true },
    });
    if (!session) return false;
    await prisma.$transaction((tx) =>
        revokeSession(
            tx,
            session.id,
            input.reason ?? "user_revoked",
            new Date()
        )
    );
    return true;
}

function pruneLocalRateLimits(now: number): void {
    for (const [key, entry] of localRateLimits) {
        if (entry.expiresAt <= now) localRateLimits.delete(key);
    }
    while (localRateLimits.size > MAX_LOCAL_RATE_LIMIT_ENTRIES) {
        const firstKey = localRateLimits.keys().next().value as
            | string
            | undefined;
        if (!firstKey) break;
        localRateLimits.delete(firstKey);
    }
}

function getAuthRateLimitKey(scope: string, identifier: string): string {
    const digest = createHash("sha256")
        .update(identifier, "utf8")
        .digest("hex");
    return getRedisKey("auth", scope, digest);
}

async function readAuthRateLimit(input: {
    scope: string;
    identifier: string;
    limit: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const key = getAuthRateLimitKey(input.scope, input.identifier);
    const client = await getRedisClient();
    if (client) {
        try {
            const [rawCount, ttlMs] = await Promise.all([
                client.get(key),
                client.pTTL(key),
            ]);
            const count = Number.parseInt(rawCount ?? "0", 10);
            return {
                allowed: !Number.isFinite(count) || count < input.limit,
                retryAfterSeconds:
                    count >= input.limit
                        ? Math.max(1, Math.ceil(Math.max(ttlMs, 0) / 1000))
                        : 0,
            };
        } catch {
            // Preserve protection with the bounded process-local fallback below.
        }
    }

    const now = Date.now();
    pruneLocalRateLimits(now);
    const entry = localRateLimits.get(key);
    if (!entry || entry.expiresAt <= now || entry.count < input.limit) {
        return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
        allowed: false,
        retryAfterSeconds: Math.max(
            1,
            Math.ceil((entry.expiresAt - now) / 1000)
        ),
    };
}

function normalizePasswordLoginAccount(username: string): string {
    return username.trim().toLocaleLowerCase("en-US");
}

export async function checkPasswordLoginRateLimit(input: {
    remoteIp: string;
    username: string;
}): Promise<PasswordLoginRateLimitResult> {
    const [ip, account] = await Promise.all([
        readAuthRateLimit({
            scope: "password-login-ip",
            identifier: input.remoteIp,
            limit: PASSWORD_LOGIN_IP_LIMIT,
        }),
        readAuthRateLimit({
            scope: "password-login-account",
            identifier: normalizePasswordLoginAccount(input.username),
            limit: PASSWORD_LOGIN_ACCOUNT_LIMIT,
        }),
    ]);

    if (!account.allowed) {
        return {
            allowed: false,
            retryAfterSeconds: account.retryAfterSeconds,
            blockedBy: "account",
        };
    }
    if (!ip.allowed) {
        return {
            allowed: false,
            retryAfterSeconds: ip.retryAfterSeconds,
            blockedBy: "ip",
        };
    }
    return { allowed: true, retryAfterSeconds: 0, blockedBy: null };
}

export async function recordPasswordLoginFailure(input: {
    remoteIp: string;
    username: string;
}): Promise<PasswordLoginRateLimitResult> {
    const [ip, account] = await Promise.all([
        consumeAuthRateLimit({
            scope: "password-login-ip",
            identifier: input.remoteIp,
            limit: PASSWORD_LOGIN_IP_LIMIT,
            windowMs: PASSWORD_LOGIN_IP_WINDOW_MS,
        }),
        consumeAuthRateLimit({
            scope: "password-login-account",
            identifier: normalizePasswordLoginAccount(input.username),
            limit: PASSWORD_LOGIN_ACCOUNT_LIMIT,
            windowMs: PASSWORD_LOGIN_ACCOUNT_WINDOW_MS,
        }),
    ]);

    const penaltyDelayMs = Math.min(
        1_500,
        Math.max(0, account.count - 2) * 250
    );
    if (penaltyDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, penaltyDelayMs));
    }

    if (!account.allowed) {
        return {
            allowed: false,
            retryAfterSeconds: account.retryAfterSeconds,
            blockedBy: "account",
        };
    }
    if (!ip.allowed) {
        return {
            allowed: false,
            retryAfterSeconds: ip.retryAfterSeconds,
            blockedBy: "ip",
        };
    }
    return { allowed: true, retryAfterSeconds: 0, blockedBy: null };
}

export async function clearPasswordLoginAccountFailures(
    username: string
): Promise<void> {
    const key = getAuthRateLimitKey(
        "password-login-account",
        normalizePasswordLoginAccount(username)
    );
    localRateLimits.delete(key);

    const client = await getRedisClient();
    if (!client) return;
    try {
        await client.del(key);
    } catch {
        // A successful login must not fail because cleanup telemetry is unavailable.
    }
}

export async function consumeAuthRateLimit(input: {
    scope: string;
    identifier: string;
    limit: number;
    windowMs: number;
}): Promise<AuthRateLimitCounterResult> {
    const key = getAuthRateLimitKey(input.scope, input.identifier);
    const client = await getRedisClient();
    if (client) {
        try {
            const result = (await client.eval(
                "local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {c,redis.call('PTTL',KEYS[1])}",
                {
                    keys: [key],
                    arguments: [String(input.windowMs)],
                }
            )) as [number, number];
            return {
                allowed: Number(result[0]) <= input.limit,
                retryAfterSeconds: Math.max(
                    1,
                    Math.ceil(Number(result[1]) / 1000)
                ),
                count: Number(result[0]),
            };
        } catch {
            // Preserve protection with a bounded process-local fallback.
        }
    }

    const now = Date.now();
    pruneLocalRateLimits(now);
    const existing = localRateLimits.get(key);
    const entry =
        existing && existing.expiresAt > now
            ? existing
            : { count: 0, expiresAt: now + input.windowMs };
    entry.count += 1;
    localRateLimits.set(key, entry);
    return {
        allowed: entry.count <= input.limit,
        retryAfterSeconds: Math.max(
            1,
            Math.ceil((entry.expiresAt - now) / 1000)
        ),
        count: entry.count,
    };
}
