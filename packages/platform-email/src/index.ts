import {
    createHash,
    createHmac,
    randomUUID,
    timingSafeEqual,
} from "node:crypto";
import nodemailer from "nodemailer";
import {
    EmailDeliveryEventType,
    EmailMessageClass,
    EmailOutboxStatus,
    EmailSuppressionReason,
    EmailSuppressionScope,
    Prisma,
    prisma,
} from "@hushle/platform-db";

export * from "./ses-sns";

export const EMAIL_VERIFICATION_MODES = [
    "off",
    "optional",
    "required_for_new_accounts",
] as const;
export type EmailVerificationMode =
    (typeof EMAIL_VERIFICATION_MODES)[number];

export const EMAIL_MESSAGE_CLASSES = [
    "transactional",
    "marketing",
] as const;

export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60_000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60_000;
export const EMAIL_CHANGE_TOKEN_TTL_MS = 24 * 60 * 60_000;
export const EMAIL_OUTBOX_MAX_ATTEMPTS = 5;
export const EMAIL_OUTBOX_CLAIM_TTL_MS = 5 * 60_000;

const EMAIL_VERIFICATION_TEMPLATE = "email_verification";
const PASSWORD_RESET_TEMPLATE = "password_reset";
const EMAIL_CHANGE_TEMPLATE = "email_change_verification";
const SECURITY_NOTICE_TEMPLATE = "security_notice";
const TOKEN_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EmailEnvironment = Record<string, string | undefined>;

class EmailVerificationConflict extends Error {}

export interface EmailProviderReadiness {
    provider: "disabled" | "smtp";
    configured: boolean;
    issues: string[];
}

export interface TransactionalEmailMessage {
    to: string;
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
}

export interface TransactionalEmailProvider {
    send(message: TransactionalEmailMessage): Promise<void>;
    close?(): void | Promise<void>;
}

function normalizeProvider(
    value: string | undefined
): EmailProviderReadiness["provider"] {
    return value?.trim().toLowerCase() === "smtp" ? "smtp" : "disabled";
}

function parsePort(value: string | undefined): number | null {
    if (!value?.trim()) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
        ? parsed
        : null;
}

function isValidBaseUrl(value: string | undefined): boolean {
    if (!value?.trim()) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

export function getEmailProviderReadiness(
    env: EmailEnvironment = process.env
): EmailProviderReadiness {
    const provider = normalizeProvider(env.EMAIL_PROVIDER);
    if (provider === "disabled") {
        return {
            provider,
            configured: false,
            issues: ["EMAIL_PROVIDER is disabled"],
        };
    }

    const issues: string[] = [];
    if (!env.SMTP_HOST?.trim()) issues.push("SMTP_HOST is missing");
    if (!parsePort(env.SMTP_PORT)) issues.push("SMTP_PORT is invalid");
    if (!env.EMAIL_FROM?.trim()) issues.push("EMAIL_FROM is missing");
    if (Boolean(env.SMTP_USER?.trim()) !== Boolean(env.SMTP_PASS)) {
        issues.push("SMTP_USER and SMTP_PASS must be configured together");
    }
    if (!isValidBaseUrl(env.NEXT_PUBLIC_SITE_URL)) {
        issues.push("NEXT_PUBLIC_SITE_URL is invalid");
    }
    if (!env.EMAIL_TOKEN_SECRET || env.EMAIL_TOKEN_SECRET.trim().length < 32) {
        issues.push("EMAIL_TOKEN_SECRET must contain at least 32 characters");
    }

    return {
        provider,
        configured: issues.length === 0,
        issues,
    };
}

function parseBoolean(value: string | undefined): boolean {
    return value?.trim().toLowerCase() === "true";
}

export function createSmtpEmailProvider(
    env: EmailEnvironment = process.env
): TransactionalEmailProvider {
    const readiness = getEmailProviderReadiness(env);
    if (!readiness.configured || readiness.provider !== "smtp") {
        throw new Error(
            `Email provider is not ready: ${readiness.issues.join(", ")}`
        );
    }

    const port = parsePort(env.SMTP_PORT);
    if (!port) throw new Error("SMTP_PORT is invalid");

    const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST?.trim(),
        port,
        secure: parseBoolean(env.SMTP_SECURE),
        auth:
            env.SMTP_USER?.trim() && env.SMTP_PASS
                ? {
                      user: env.SMTP_USER.trim(),
                      pass: env.SMTP_PASS,
                  }
                : undefined,
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
    });
    const from = env.EMAIL_FROM?.trim() ?? "";

    return {
        async send(message) {
            await transporter.sendMail({
                from,
                ...message,
            });
        },
        close() {
            transporter.close();
        },
    };
}

function requireTokenSecret(env: EmailEnvironment): string {
    const secret = env.EMAIL_TOKEN_SECRET?.trim();
    if (!secret || secret.length < 32) {
        throw new Error(
            "EMAIL_TOKEN_SECRET must contain at least 32 characters"
        );
    }
    return secret;
}

function deriveActionToken(
    namespace: string,
    tokenId: string,
    env: EmailEnvironment
): string {
    const signature = createHmac("sha256", requireTokenSecret(env))
        .update(`${namespace}:${tokenId}`, "utf8")
        .digest("base64url");
    return `${tokenId}.${signature}`;
}

function deriveVerificationToken(tokenId: string, env: EmailEnvironment): string {
    return deriveActionToken("email-verification", tokenId, env);
}

export function hashEmailVerificationToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

function parseVerificationTokenId(token: string): string | null {
    if (token.length > 160) return null;
    const separator = token.indexOf(".");
    if (separator <= 0) return null;
    const tokenId = token.slice(0, separator);
    return TOKEN_ID_PATTERN.test(tokenId) ? tokenId : null;
}

function hashesEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    return (
        leftBuffer.length === rightBuffer.length &&
        timingSafeEqual(leftBuffer, rightBuffer)
    );
}

function enqueueSecurityNotice(
    tx: Prisma.TransactionClient,
    input: {
        userId: number;
        recipient: string;
        siteName: string;
        subject: string;
        title: string;
        message: string;
        deduplicationKey: string;
    }
) {
    return tx.emailOutboxMessage.create({
        data: {
            id: randomUUID(),
            userId: input.userId,
            deduplicationKey: input.deduplicationKey,
            messageClass: EmailMessageClass.transactional,
            template: SECURITY_NOTICE_TEMPLATE,
            recipient: input.recipient,
            subject: input.subject,
            payload: {
                siteName: input.siteName,
                title: input.title,
                message: input.message,
            },
        },
    });
}

export async function enqueueEmailVerification(
    tx: Prisma.TransactionClient,
    input: {
        userId: number;
        email: string;
        siteName: string;
        now?: Date;
        ttlMs?: number;
        env?: EmailEnvironment;
    }
): Promise<{ tokenId: string; expiresAt: Date; outboxId: string }> {
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? EMAIL_VERIFICATION_TOKEN_TTL_MS;
    const tokenId = randomUUID();
    const outboxId = randomUUID();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const rawToken = deriveVerificationToken(
        tokenId,
        input.env ?? process.env
    );

    await tx.emailVerificationToken.updateMany({
        where: {
            userId: input.userId,
            consumedAt: null,
            revokedAt: null,
        },
        data: { revokedAt: now },
    });
    await tx.emailOutboxMessage.updateMany({
        where: {
            userId: input.userId,
            template: EMAIL_VERIFICATION_TEMPLATE,
            status: EmailOutboxStatus.pending,
        },
        data: {
            status: EmailOutboxStatus.dead_letter,
            lastError: "Superseded by a newer verification request",
        },
    });
    await tx.emailVerificationToken.create({
        data: {
            id: tokenId,
            userId: input.userId,
            tokenHash: hashEmailVerificationToken(rawToken),
            emailSnapshot: input.email,
            expiresAt,
        },
    });
    await tx.emailOutboxMessage.create({
        data: {
            id: outboxId,
            userId: input.userId,
            deduplicationKey: `email-verification:${tokenId}`,
            messageClass: EmailMessageClass.transactional,
            template: EMAIL_VERIFICATION_TEMPLATE,
            recipient: input.email,
            subject: `${input.siteName} e-posta doğrulaması`,
            payload: {
                verificationTokenId: tokenId,
                siteName: input.siteName,
            },
        },
    });

    return { tokenId, expiresAt, outboxId };
}

export async function requestEmailVerification(input: {
    userId: number;
    siteName: string;
    env?: EmailEnvironment;
    now?: Date;
}): Promise<"queued" | "already_verified" | "email_missing"> {
    const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: {
            id: true,
            email: true,
            emailVerifiedAt: true,
        },
    });
    if (!user?.email) return "email_missing";
    if (user.emailVerifiedAt) return "already_verified";

    await prisma.$transaction((tx) =>
        enqueueEmailVerification(tx, {
            userId: user.id,
            email: user.email!,
            siteName: input.siteName,
            env: input.env,
            now: input.now,
        })
    );
    return "queued";
}

export async function confirmEmailVerification(input: {
    token: string;
    env?: EmailEnvironment;
    now?: Date;
}): Promise<
    | { ok: true; userId: number }
    | {
          ok: false;
          reason: "invalid" | "expired" | "used" | "email_changed";
      }
> {
    const tokenId = parseVerificationTokenId(input.token);
    if (!tokenId) return { ok: false, reason: "invalid" };

    const record = await prisma.emailVerificationToken.findUnique({
        where: { id: tokenId },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                },
            },
        },
    });
    if (!record) return { ok: false, reason: "invalid" };

    const candidateHash = hashEmailVerificationToken(input.token);
    if (!hashesEqual(candidateHash, record.tokenHash)) {
        return { ok: false, reason: "invalid" };
    }
    const now = input.now ?? new Date();
    if (record.consumedAt || record.revokedAt) {
        return { ok: false, reason: "used" };
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, reason: "expired" };
    }
    if (
        !record.user.email ||
        record.user.email.trim().toLowerCase() !==
            record.emailSnapshot.trim().toLowerCase()
    ) {
        return { ok: false, reason: "email_changed" };
    }

    let consumed = false;
    try {
        consumed = await prisma.$transaction(async (tx) => {
            const tokenResult = await tx.emailVerificationToken.updateMany({
                where: {
                    id: record.id,
                    tokenHash: record.tokenHash,
                    consumedAt: null,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                data: { consumedAt: now },
            });
            if (tokenResult.count !== 1) {
                throw new EmailVerificationConflict();
            }

            const userResult = await tx.user.updateMany({
                where: {
                    id: record.userId,
                    email: record.emailSnapshot,
                    emailVerifiedAt: null,
                },
                data: {
                    emailVerifiedAt: now,
                    accountStatus: "active",
                },
            });
            if (userResult.count !== 1) {
                throw new EmailVerificationConflict();
            }

            await tx.emailVerificationToken.updateMany({
                where: {
                    userId: record.userId,
                    id: { not: record.id },
                    consumedAt: null,
                    revokedAt: null,
                },
                data: { revokedAt: now },
            });
            return true;
        });
    } catch (error) {
        if (!(error instanceof EmailVerificationConflict)) throw error;
    }
    return consumed
        ? { ok: true, userId: record.userId }
        : { ok: false, reason: "used" };
}

export async function enqueuePasswordReset(
    tx: Prisma.TransactionClient,
    input: {
        userId: number;
        email: string;
        siteName: string;
        now?: Date;
        env?: EmailEnvironment;
    }
): Promise<{ tokenId: string; expiresAt: Date; outboxId: string }> {
    const now = input.now ?? new Date();
    const tokenId = randomUUID();
    const outboxId = randomUUID();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);
    const rawToken = deriveActionToken(
        "password-reset",
        tokenId,
        input.env ?? process.env
    );

    await tx.passwordResetToken.updateMany({
        where: {
            userId: input.userId,
            consumedAt: null,
            revokedAt: null,
        },
        data: { revokedAt: now },
    });
    await tx.emailOutboxMessage.updateMany({
        where: {
            userId: input.userId,
            template: PASSWORD_RESET_TEMPLATE,
            status: EmailOutboxStatus.pending,
        },
        data: {
            status: EmailOutboxStatus.dead_letter,
            lastError: "Superseded by a newer password reset request",
        },
    });
    await tx.passwordResetToken.create({
        data: {
            id: tokenId,
            userId: input.userId,
            tokenHash: hashEmailVerificationToken(rawToken),
            expiresAt,
        },
    });
    await tx.emailOutboxMessage.create({
        data: {
            id: outboxId,
            userId: input.userId,
            deduplicationKey: `password-reset:${tokenId}`,
            messageClass: EmailMessageClass.transactional,
            template: PASSWORD_RESET_TEMPLATE,
            recipient: input.email,
            subject: `${input.siteName} parola sıfırlama`,
            payload: {
                passwordResetTokenId: tokenId,
                siteName: input.siteName,
            },
        },
    });

    return { tokenId, expiresAt, outboxId };
}

export async function resetPasswordWithToken(input: {
    token: string;
    passwordHash: string;
    siteName: string;
    env?: EmailEnvironment;
    now?: Date;
}): Promise<
    | { ok: true; userId: number }
    | { ok: false; reason: "invalid" | "expired" | "used" }
> {
    const tokenId = parseVerificationTokenId(input.token);
    if (!tokenId) return { ok: false, reason: "invalid" };

    const record = await prisma.passwordResetToken.findUnique({
        where: { id: tokenId },
        include: {
            user: {
                select: { id: true, email: true },
            },
        },
    });
    if (!record) return { ok: false, reason: "invalid" };
    if (
        !hashesEqual(
            hashEmailVerificationToken(input.token),
            record.tokenHash
        )
    ) {
        return { ok: false, reason: "invalid" };
    }

    const now = input.now ?? new Date();
    if (record.consumedAt || record.revokedAt) {
        return { ok: false, reason: "used" };
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, reason: "expired" };
    }

    try {
        await prisma.$transaction(async (tx) => {
            const consumed = await tx.passwordResetToken.updateMany({
                where: {
                    id: record.id,
                    tokenHash: record.tokenHash,
                    consumedAt: null,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                data: { consumedAt: now },
            });
            if (consumed.count !== 1) {
                throw new EmailVerificationConflict();
            }

            await tx.user.update({
                where: { id: record.userId },
                data: {
                    password: input.passwordHash,
                    sessionVersion: { increment: 1 },
                },
            });
            await tx.passwordResetToken.updateMany({
                where: {
                    userId: record.userId,
                    id: { not: record.id },
                    consumedAt: null,
                    revokedAt: null,
                },
                data: { revokedAt: now },
            });
            const mobileSessions = await tx.mobileAuthSession.findMany({
                where: { userId: record.userId, revokedAt: null },
                select: { id: true },
            });
            const sessionIds = mobileSessions.map((session) => session.id);
            if (sessionIds.length > 0) {
                await tx.mobileAuthSession.updateMany({
                    where: { id: { in: sessionIds }, revokedAt: null },
                    data: {
                        revokedAt: now,
                        revokeReason: "password_reset",
                    },
                });
                await tx.mobileAuthToken.updateMany({
                    where: { sessionId: { in: sessionIds }, revokedAt: null },
                    data: { revokedAt: now },
                });
            }
            if (record.user.email) {
                await enqueueSecurityNotice(tx, {
                    userId: record.userId,
                    recipient: record.user.email,
                    siteName: input.siteName,
                    subject: `${input.siteName} parolan değiştirildi`,
                    title: "Parolan değiştirildi",
                    message:
                        "Hesabının parolası başarıyla sıfırlandı ve açık oturumlar kapatıldı. Bu işlemi sen yapmadıysan destek ekibiyle iletişime geç.",
                    deduplicationKey: `password-reset-complete:${record.id}`,
                });
            }
        });
    } catch (error) {
        if (error instanceof EmailVerificationConflict) {
            return { ok: false, reason: "used" };
        }
        throw error;
    }
    return { ok: true, userId: record.userId };
}

export async function enqueueEmailChange(
    tx: Prisma.TransactionClient,
    input: {
        userId: number;
        currentEmail: string | null;
        newEmail: string;
        normalizedNewEmail: string;
        siteName: string;
        now?: Date;
        env?: EmailEnvironment;
    }
): Promise<{ tokenId: string; expiresAt: Date; outboxId: string }> {
    const now = input.now ?? new Date();
    const tokenId = randomUUID();
    const outboxId = randomUUID();
    const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS);
    const rawToken = deriveActionToken(
        "email-change",
        tokenId,
        input.env ?? process.env
    );

    await tx.emailChangeToken.updateMany({
        where: {
            userId: input.userId,
            consumedAt: null,
            revokedAt: null,
        },
        data: { revokedAt: now },
    });
    await tx.emailOutboxMessage.updateMany({
        where: {
            userId: input.userId,
            template: EMAIL_CHANGE_TEMPLATE,
            status: EmailOutboxStatus.pending,
        },
        data: {
            status: EmailOutboxStatus.dead_letter,
            lastError: "Superseded by a newer email change request",
        },
    });
    await tx.user.update({
        where: { id: input.userId },
        data: {
            pendingEmail: input.newEmail,
            pendingNormalizedEmail: input.normalizedNewEmail,
            pendingEmailRequestedAt: now,
        },
    });
    await tx.emailChangeToken.create({
        data: {
            id: tokenId,
            userId: input.userId,
            tokenHash: hashEmailVerificationToken(rawToken),
            emailSnapshot: input.newEmail,
            normalizedEmailSnapshot: input.normalizedNewEmail,
            expiresAt,
        },
    });
    await tx.emailOutboxMessage.create({
        data: {
            id: outboxId,
            userId: input.userId,
            deduplicationKey: `email-change:${tokenId}`,
            messageClass: EmailMessageClass.transactional,
            template: EMAIL_CHANGE_TEMPLATE,
            recipient: input.newEmail,
            subject: `${input.siteName} yeni e-posta doğrulaması`,
            payload: {
                emailChangeTokenId: tokenId,
                siteName: input.siteName,
            },
        },
    });
    if (input.currentEmail) {
        await enqueueSecurityNotice(tx, {
            userId: input.userId,
            recipient: input.currentEmail,
            siteName: input.siteName,
            subject: `${input.siteName} e-posta değişikliği istendi`,
            title: "E-posta değişikliği istendi",
            message:
                "Hesabın için yeni bir e-posta adresi doğrulama isteği oluşturuldu. Bu işlemi sen yapmadıysan Ayarlar bölümünden bekleyen isteği iptal et ve parolanı değiştir.",
            deduplicationKey: `email-change-requested:${tokenId}`,
        });
    }

    return { tokenId, expiresAt, outboxId };
}

export async function cancelPendingEmailChange(input: {
    userId: number;
    now?: Date;
}): Promise<boolean> {
    const now = input.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
            where: { id: input.userId },
            select: { pendingEmail: true },
        });
        if (!user?.pendingEmail) return false;
        await tx.user.update({
            where: { id: input.userId },
            data: {
                pendingEmail: null,
                pendingNormalizedEmail: null,
                pendingEmailRequestedAt: null,
            },
        });
        await tx.emailChangeToken.updateMany({
            where: {
                userId: input.userId,
                consumedAt: null,
                revokedAt: null,
            },
            data: { revokedAt: now },
        });
        await tx.emailOutboxMessage.updateMany({
            where: {
                userId: input.userId,
                template: EMAIL_CHANGE_TEMPLATE,
                status: EmailOutboxStatus.pending,
            },
            data: {
                status: EmailOutboxStatus.dead_letter,
                lastError: "Email change request cancelled",
            },
        });
        return true;
    });
}

export async function confirmEmailChange(input: {
    token: string;
    siteName: string;
    now?: Date;
}): Promise<
    | { ok: true; userId: number }
    | {
          ok: false;
          reason:
              | "invalid"
              | "expired"
              | "used"
              | "request_changed"
              | "email_unavailable";
      }
> {
    const tokenId = parseVerificationTokenId(input.token);
    if (!tokenId) return { ok: false, reason: "invalid" };
    const record = await prisma.emailChangeToken.findUnique({
        where: { id: tokenId },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    pendingEmail: true,
                    pendingNormalizedEmail: true,
                },
            },
        },
    });
    if (!record) return { ok: false, reason: "invalid" };
    if (
        !hashesEqual(
            hashEmailVerificationToken(input.token),
            record.tokenHash
        )
    ) {
        return { ok: false, reason: "invalid" };
    }
    const now = input.now ?? new Date();
    if (record.consumedAt || record.revokedAt) {
        return { ok: false, reason: "used" };
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, reason: "expired" };
    }
    if (
        record.user.pendingEmail !== record.emailSnapshot ||
        record.user.pendingNormalizedEmail !==
            record.normalizedEmailSnapshot
    ) {
        return { ok: false, reason: "request_changed" };
    }

    try {
        await prisma.$transaction(async (tx) => {
            const owner = await tx.user.findFirst({
                where: {
                    normalizedEmail: record.normalizedEmailSnapshot,
                    id: { not: record.userId },
                },
                select: { id: true },
            });
            if (owner) throw new EmailVerificationConflict("email_unavailable");

            const consumed = await tx.emailChangeToken.updateMany({
                where: {
                    id: record.id,
                    tokenHash: record.tokenHash,
                    consumedAt: null,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                data: { consumedAt: now },
            });
            if (consumed.count !== 1) {
                throw new EmailVerificationConflict("used");
            }
            const updated = await tx.user.updateMany({
                where: {
                    id: record.userId,
                    pendingEmail: record.emailSnapshot,
                    pendingNormalizedEmail:
                        record.normalizedEmailSnapshot,
                },
                data: {
                    email: record.emailSnapshot,
                    normalizedEmail: record.normalizedEmailSnapshot,
                    emailVerifiedAt: now,
                    accountStatus: "active",
                    pendingEmail: null,
                    pendingNormalizedEmail: null,
                    pendingEmailRequestedAt: null,
                    sessionVersion: { increment: 1 },
                },
            });
            if (updated.count !== 1) {
                throw new EmailVerificationConflict("request_changed");
            }
            await tx.emailChangeToken.updateMany({
                where: {
                    userId: record.userId,
                    id: { not: record.id },
                    consumedAt: null,
                    revokedAt: null,
                },
                data: { revokedAt: now },
            });
            await tx.emailVerificationToken.updateMany({
                where: {
                    userId: record.userId,
                    consumedAt: null,
                    revokedAt: null,
                },
                data: { revokedAt: now },
            });
            const mobileSessions = await tx.mobileAuthSession.findMany({
                where: { userId: record.userId, revokedAt: null },
                select: { id: true },
            });
            const sessionIds = mobileSessions.map((session) => session.id);
            if (sessionIds.length > 0) {
                await tx.mobileAuthSession.updateMany({
                    where: { id: { in: sessionIds }, revokedAt: null },
                    data: {
                        revokedAt: now,
                        revokeReason: "email_changed",
                    },
                });
                await tx.mobileAuthToken.updateMany({
                    where: { sessionId: { in: sessionIds }, revokedAt: null },
                    data: { revokedAt: now },
                });
            }
            if (record.user.email) {
                await enqueueSecurityNotice(tx, {
                    userId: record.userId,
                    recipient: record.user.email,
                    siteName: input.siteName,
                    subject: `${input.siteName} e-posta adresin değiştirildi`,
                    title: "E-posta adresin değiştirildi",
                    message:
                        "Hesabının e-posta adresi doğrulanmış yeni adresle değiştirildi ve açık oturumlar kapatıldı. Bu işlemi sen yapmadıysan destek ekibiyle iletişime geç.",
                    deduplicationKey: `email-change-complete:${record.id}`,
                });
            }
        });
    } catch (error) {
        if (error instanceof EmailVerificationConflict) {
            const reason = error.message;
            if (
                reason === "email_unavailable" ||
                reason === "request_changed" ||
                reason === "used"
            ) {
                return { ok: false, reason };
            }
            return { ok: false, reason: "used" };
        }
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            return { ok: false, reason: "email_unavailable" };
        }
        throw error;
    }
    return { ok: true, userId: record.userId };
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function buildVerificationMessage(input: {
    recipient: string;
    subject: string;
    siteName: string;
    verificationUrl: string;
}): TransactionalEmailMessage {
    const siteName = escapeHtml(input.siteName);
    const verificationUrl = escapeHtml(input.verificationUrl);
    return {
        to: input.recipient,
        subject: input.subject,
        text: `${input.siteName} hesabını doğrulamak için bağlantıyı aç: ${input.verificationUrl}\n\nBu isteği sen yapmadıysan e-postayı yok sayabilirsin.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#172033"><h1 style="font-size:24px">${siteName}</h1><p>E-posta adresini doğrulamak için aşağıdaki bağlantıyı aç.</p><p><a href="${verificationUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">E-postamı doğrula</a></p><p style="font-size:13px;color:#64748b">Bu isteği sen yapmadıysan e-postayı yok sayabilirsin.</p></div>`,
    };
}

function buildActionMessage(input: {
    recipient: string;
    subject: string;
    siteName: string;
    title: string;
    message: string;
    actionLabel: string;
    actionUrl: string;
}): TransactionalEmailMessage {
    const siteName = escapeHtml(input.siteName);
    const title = escapeHtml(input.title);
    const message = escapeHtml(input.message);
    const actionLabel = escapeHtml(input.actionLabel);
    const actionUrl = escapeHtml(input.actionUrl);
    return {
        to: input.recipient,
        subject: input.subject,
        text: `${input.title}\n\n${input.message}\n\n${input.actionUrl}\n\nBu isteği sen yapmadıysan e-postayı yok sayabilirsin.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#172033"><h1 style="font-size:24px">${siteName}</h1><h2 style="font-size:20px">${title}</h2><p>${message}</p><p><a href="${actionUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">${actionLabel}</a></p><p style="font-size:13px;color:#64748b">Bu isteği sen yapmadıysan e-postayı yok sayabilirsin.</p></div>`,
    };
}

function buildSecurityNoticeMessage(input: {
    recipient: string;
    subject: string;
    siteName: string;
    title: string;
    message: string;
}): TransactionalEmailMessage {
    const siteName = escapeHtml(input.siteName);
    const title = escapeHtml(input.title);
    const message = escapeHtml(input.message);
    return {
        to: input.recipient,
        subject: input.subject,
        text: `${input.title}\n\n${input.message}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#172033"><h1 style="font-size:24px">${siteName}</h1><h2 style="font-size:20px">${title}</h2><p>${message}</p></div>`,
    };
}

function retryDelayMs(attemptCount: number): number {
    return Math.min(6 * 60 * 60_000, 60_000 * 2 ** attemptCount);
}

function deliveryErrorLabel(error: unknown): string {
    const name =
        error instanceof Error && error.name.trim()
            ? error.name.trim().slice(0, 80)
            : "UnknownError";
    return `Delivery failed (${name})`;
}

function normalizeEmailAddress(value: string): string {
    return value.trim().toLowerCase();
}

export interface EmailDeliveryProviderEventInput {
    provider: string;
    providerEventId: string;
    type: "delivered" | "hard_bounce" | "complaint";
    recipient: string;
    providerMessageId?: string | null;
    occurredAt: Date;
}

export async function recordEmailDeliveryProviderEvent(
    input: EmailDeliveryProviderEventInput
): Promise<{ duplicate: boolean; suppressed: boolean }> {
    if (
        !(["delivered", "hard_bounce", "complaint"] as const).includes(
            input.type
        )
    ) {
        throw new TypeError("Provider event type is invalid");
    }
    if (
        !(input.occurredAt instanceof Date) ||
        Number.isNaN(input.occurredAt.getTime())
    ) {
        throw new TypeError("Provider event timestamp is invalid");
    }
    const provider = input.provider.trim().toLowerCase().slice(0, 40);
    const providerEventId = input.providerEventId.trim().slice(0, 191);
    const normalizedEmail = normalizeEmailAddress(input.recipient).slice(0, 191);
    if (!provider || !providerEventId || !normalizedEmail) {
        throw new TypeError("Provider event identity is invalid");
    }

    return prisma.$transaction(async (tx) => {
        const inserted = await tx.emailDeliveryEvent.createMany({
            data: {
                provider,
                providerEventId,
                eventType: input.type as EmailDeliveryEventType,
                normalizedEmail,
                providerMessageId:
                    input.providerMessageId?.trim().slice(0, 191) || null,
                occurredAt: input.occurredAt,
            },
            skipDuplicates: true,
        });
        if (inserted.count === 0) {
            return { duplicate: true, suppressed: false };
        }

        if (input.type === "delivered") {
            return { duplicate: false, suppressed: false };
        }

        const user = await tx.user.findUnique({
            where: { normalizedEmail },
            select: { id: true },
        });
        await tx.emailSuppression.upsert({
            where: { normalizedEmail },
            create: {
                normalizedEmail,
                userId: user?.id ?? null,
                reason:
                    input.type === "complaint"
                        ? EmailSuppressionReason.complaint
                        : EmailSuppressionReason.hard_bounce,
                scope: EmailSuppressionScope.all,
                source: provider,
            },
            update: {
                userId: user?.id ?? undefined,
                reason:
                    input.type === "complaint"
                        ? EmailSuppressionReason.complaint
                        : EmailSuppressionReason.hard_bounce,
                scope: EmailSuppressionScope.all,
                source: provider,
            },
        });
        return { duplicate: false, suppressed: true };
    });
}

async function claimEmailOutboxMessage(input: {
    now: Date;
    claimToken: string;
}) {
    const claimExpiresAt = new Date(input.now.getTime() + EMAIL_OUTBOX_CLAIM_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = await prisma.emailOutboxMessage.findFirst({
            where: {
                OR: [
                    { status: EmailOutboxStatus.pending, availableAt: { lte: input.now } },
                    { status: EmailOutboxStatus.processing, claimExpiresAt: { lte: input.now } },
                ],
            },
            orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        });
        if (!candidate) return null;

        const claimed = await prisma.emailOutboxMessage.updateMany({
            where: {
                id: candidate.id,
                OR: [
                    { status: EmailOutboxStatus.pending, availableAt: { lte: input.now } },
                    { status: EmailOutboxStatus.processing, claimExpiresAt: { lte: input.now } },
                ],
            },
            data: {
                status: EmailOutboxStatus.processing,
                claimToken: input.claimToken,
                claimedAt: input.now,
                claimExpiresAt,
            },
        });
        if (claimed.count === 1) {
            return prisma.emailOutboxMessage.findUnique({ where: { id: candidate.id } });
        }
    }
    return null;
}

export interface EmailDeliveryResult {
    selected: number;
    sent: number;
    retried: number;
    deadLettered: number;
}

export async function processEmailOutbox(input: {
    provider: TransactionalEmailProvider;
    env?: EmailEnvironment;
    now?: Date;
    batchSize?: number;
}): Promise<EmailDeliveryResult> {
    const env = input.env ?? process.env;
    const now = input.now ?? new Date();
    const batchSize = Math.max(1, Math.min(100, input.batchSize ?? 25));
    const result: EmailDeliveryResult = {
        selected: 0,
        sent: 0,
        retried: 0,
        deadLettered: 0,
    };

    for (let index = 0; index < batchSize; index += 1) {
        const claimToken = randomUUID();
        const message = await claimEmailOutboxMessage({ now, claimToken });
        if (!message) break;
        result.selected += 1;

        const suppression = await prisma.emailSuppression.findUnique({
            where: { normalizedEmail: normalizeEmailAddress(message.recipient) },
            select: { scope: true, reason: true },
        });
        if (
            suppression &&
            (suppression.scope === EmailSuppressionScope.all ||
                message.messageClass === EmailMessageClass.marketing)
        ) {
            await prisma.emailOutboxMessage.updateMany({
                where: { id: message.id, status: EmailOutboxStatus.processing, claimToken },
                data: {
                    status: EmailOutboxStatus.dead_letter,
                    lastAttemptAt: now,
                    lastError: `Delivery suppressed (${suppression.reason})`,
                    claimToken: null,
                    claimedAt: null,
                    claimExpiresAt: null,
                },
            });
            result.deadLettered += 1;
            continue;
        }

        if (message.messageClass !== EmailMessageClass.transactional) {
            await prisma.emailOutboxMessage.updateMany({
                where: { id: message.id, status: EmailOutboxStatus.processing, claimToken },
                data: {
                    status: EmailOutboxStatus.dead_letter,
                    lastAttemptAt: now,
                    lastError:
                        "Marketing delivery is disabled until consent enforcement exists",
                    claimToken: null,
                    claimedAt: null,
                    claimExpiresAt: null,
                },
            });
            result.deadLettered += 1;
            continue;
        }

        try {
            const baseUrl = env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
            if (!baseUrl) throw new TypeError("Public site URL is unavailable");
            const payload = message.payload as Record<string, unknown>;
            if (typeof payload.siteName !== "string") {
                throw new TypeError("Email payload site name is invalid");
            }

            if (message.template === EMAIL_VERIFICATION_TEMPLATE) {
                if (typeof payload.verificationTokenId !== "string") {
                    throw new TypeError("Invalid email verification payload");
                }
                const tokenRecord =
                    await prisma.emailVerificationToken.findUnique({
                        where: { id: payload.verificationTokenId },
                    });
                if (
                    !tokenRecord ||
                    tokenRecord.consumedAt ||
                    tokenRecord.revokedAt ||
                    tokenRecord.expiresAt.getTime() <= now.getTime() ||
                    tokenRecord.emailSnapshot !== message.recipient
                ) {
                    throw new TypeError(
                        "Email verification token is unavailable"
                    );
                }
                const token = deriveVerificationToken(tokenRecord.id, env);
                await input.provider.send(
                    buildVerificationMessage({
                        recipient: message.recipient,
                        subject: message.subject,
                        siteName: payload.siteName,
                        verificationUrl: `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`,
                    })
                );
            } else if (message.template === PASSWORD_RESET_TEMPLATE) {
                if (typeof payload.passwordResetTokenId !== "string") {
                    throw new TypeError("Invalid password reset payload");
                }
                const tokenRecord = await prisma.passwordResetToken.findUnique({
                    where: { id: payload.passwordResetTokenId },
                });
                if (
                    !tokenRecord ||
                    tokenRecord.consumedAt ||
                    tokenRecord.revokedAt ||
                    tokenRecord.expiresAt.getTime() <= now.getTime()
                ) {
                    throw new TypeError("Password reset token is unavailable");
                }
                const token = deriveActionToken(
                    "password-reset",
                    tokenRecord.id,
                    env
                );
                await input.provider.send(
                    buildActionMessage({
                        recipient: message.recipient,
                        subject: message.subject,
                        siteName: payload.siteName,
                        title: "Parolanı sıfırla",
                        message:
                            "Hesabın için parola sıfırlama isteği alındı. Bağlantı bir saat geçerlidir.",
                        actionLabel: "Parolamı sıfırla",
                        actionUrl: `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`,
                    })
                );
            } else if (message.template === EMAIL_CHANGE_TEMPLATE) {
                if (typeof payload.emailChangeTokenId !== "string") {
                    throw new TypeError("Invalid email change payload");
                }
                const tokenRecord = await prisma.emailChangeToken.findUnique({
                    where: { id: payload.emailChangeTokenId },
                });
                if (
                    !tokenRecord ||
                    tokenRecord.consumedAt ||
                    tokenRecord.revokedAt ||
                    tokenRecord.expiresAt.getTime() <= now.getTime() ||
                    tokenRecord.emailSnapshot !== message.recipient
                ) {
                    throw new TypeError("Email change token is unavailable");
                }
                const token = deriveActionToken(
                    "email-change",
                    tokenRecord.id,
                    env
                );
                await input.provider.send(
                    buildActionMessage({
                        recipient: message.recipient,
                        subject: message.subject,
                        siteName: payload.siteName,
                        title: "Yeni e-posta adresini doğrula",
                        message:
                            "Bu adres doğrulandıktan sonra hesabının e-posta adresi değiştirilecek.",
                        actionLabel: "Yeni adresi doğrula",
                        actionUrl: `${baseUrl}/verify-email-change?token=${encodeURIComponent(token)}`,
                    })
                );
            } else if (message.template === SECURITY_NOTICE_TEMPLATE) {
                if (
                    typeof payload.title !== "string" ||
                    typeof payload.message !== "string"
                ) {
                    throw new TypeError("Invalid security notice payload");
                }
                await input.provider.send(
                    buildSecurityNoticeMessage({
                        recipient: message.recipient,
                        subject: message.subject,
                        siteName: payload.siteName,
                        title: payload.title,
                        message: payload.message,
                    })
                );
            } else {
                throw new TypeError("Unsupported transactional template");
            }
            const transitioned = await prisma.emailOutboxMessage.updateMany({
                where: { id: message.id, status: EmailOutboxStatus.processing, claimToken },
                data: {
                    status: EmailOutboxStatus.sent,
                    sentAt: now,
                    lastAttemptAt: now,
                    attemptCount: { increment: 1 },
                    lastError: null,
                    claimToken: null,
                    claimedAt: null,
                    claimExpiresAt: null,
                },
            });
            if (transitioned.count === 1) result.sent += 1;
        } catch (error) {
            const nextAttemptCount = message.attemptCount + 1;
            const deadLetter =
                nextAttemptCount >= EMAIL_OUTBOX_MAX_ATTEMPTS ||
                error instanceof TypeError;
            const transitioned = await prisma.emailOutboxMessage.updateMany({
                where: { id: message.id, status: EmailOutboxStatus.processing, claimToken },
                data: {
                    status: deadLetter
                        ? EmailOutboxStatus.dead_letter
                        : EmailOutboxStatus.pending,
                    attemptCount: nextAttemptCount,
                    lastAttemptAt: now,
                    availableAt: deadLetter
                        ? message.availableAt
                        : new Date(
                              now.getTime() +
                                  retryDelayMs(nextAttemptCount - 1)
                          ),
                    lastError: deliveryErrorLabel(error),
                    claimToken: null,
                    claimedAt: null,
                    claimExpiresAt: null,
                },
            });
            if (transitioned.count === 1) {
                if (deadLetter) result.deadLettered += 1;
                else result.retried += 1;
            }
        }
    }

    return result;
}
