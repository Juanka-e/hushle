import { randomUUID } from "node:crypto";
import type {
    Adapter,
    AdapterAccount,
    AdapterUser,
} from "next-auth/adapters";
import { UserAccountStatus } from "@hushle/platform-db";
import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/system-settings/service";
import { initializeWalletLedger } from "@/lib/wallet-ledger/service";
import { normalizeEmail, sanitizeEmail } from "@/lib/users/email";

type DatabaseUser = Awaited<ReturnType<typeof findUserById>>;

function parseUserId(value: string): number | null {
    const userId = Number(value);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function toAdapterUser(user: NonNullable<DatabaseUser>): AdapterUser {
    return {
        id: String(user.id),
        name: user.username,
        email: user.email ?? "",
        emailVerified: user.emailVerifiedAt,
        image: null,
        role: user.role,
        sessionVersion: user.sessionVersion,
    };
}

function findUserById(id: number) {
    return prisma.user.findUnique({
        where: { id },
        select: {
            id: true,
            username: true,
            email: true,
            emailVerifiedAt: true,
            role: true,
            sessionVersion: true,
        },
    });
}

function buildOAuthUsername(name: string | null | undefined): string {
    const base = (name || "oyuncu")
        .toLocaleLowerCase("tr-TR")
        .replaceAll("ı", "i")
        .replaceAll("ğ", "g")
        .replaceAll("ü", "u")
        .replaceAll("ş", "s")
        .replaceAll("ö", "o")
        .replaceAll("ç", "c")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 38) || "oyuncu";
    return `${base}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

export function hushleOAuthAdapter(): Adapter {
    return {
        async createUser(input) {
            const email = sanitizeEmail(input.email);
            const normalizedEmail = normalizeEmail(email);
            const settings = await getSystemSettings();
            const created = await prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        username: buildOAuthUsername(input.name),
                        email,
                        normalizedEmail,
                        emailVerifiedAt: input.emailVerified ?? new Date(),
                        password: null,
                        role: "user",
                        accountStatus: UserAccountStatus.active,
                        wallet: {
                            create: {
                                coinBalance: settings.economy.startingCoinBalance,
                            },
                        },
                        profile: {
                            create: {
                                displayName: input.name?.trim().slice(0, 60) || null,
                            },
                        },
                    },
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        emailVerifiedAt: true,
                        role: true,
                        sessionVersion: true,
                    },
                });
                await initializeWalletLedger(tx, {
                    userId: user.id,
                    source: "account_opening",
                });
                return user;
            });
            return toAdapterUser(created);
        },

        async getUser(id) {
            const userId = parseUserId(id);
            if (!userId) return null;
            const user = await findUserById(userId);
            return user ? toAdapterUser(user) : null;
        },

        async getUserByEmail(email) {
            const normalizedEmail = normalizeEmail(sanitizeEmail(email));
            const user = await prisma.user.findUnique({
                where: { normalizedEmail },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    emailVerifiedAt: true,
                    role: true,
                    sessionVersion: true,
                },
            });
            return user ? toAdapterUser(user) : null;
        },

        async getUserByAccount({ provider, providerAccountId }) {
            const account = await prisma.oAuthAccount.findUnique({
                where: {
                    provider_providerAccountId: { provider, providerAccountId },
                },
                select: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                            emailVerifiedAt: true,
                            role: true,
                            sessionVersion: true,
                        },
                    },
                },
            });
            return account ? toAdapterUser(account.user) : null;
        },

        async updateUser(input) {
            const userId = parseUserId(input.id);
            if (!userId) throw new Error("Invalid OAuth adapter user id");
            const email = input.email ? sanitizeEmail(input.email) : undefined;
            const user = await prisma.user.update({
                where: { id: userId },
                data: {
                    email,
                    normalizedEmail: email ? normalizeEmail(email) : undefined,
                    emailVerifiedAt: input.emailVerified,
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    emailVerifiedAt: true,
                    role: true,
                    sessionVersion: true,
                },
            });
            return toAdapterUser(user);
        },

        async linkAccount(account) {
            const userId = parseUserId(account.userId);
            if (!userId) throw new Error("Invalid OAuth adapter user id");
            const created = await prisma.oAuthAccount.create({
                data: {
                    userId,
                    type: account.type,
                    provider: account.provider,
                    providerAccountId: account.providerAccountId,
                },
            });
            return {
                userId: String(created.userId),
                type: created.type as AdapterAccount["type"],
                provider: created.provider,
                providerAccountId: created.providerAccountId,
            };
        },

        async unlinkAccount({ provider, providerAccountId }) {
            const deleted = await prisma.oAuthAccount.delete({
                where: {
                    provider_providerAccountId: { provider, providerAccountId },
                },
            });
            return {
                userId: String(deleted.userId),
                type: deleted.type as AdapterAccount["type"],
                provider: deleted.provider,
                providerAccountId: deleted.providerAccountId,
            };
        },

        async getAccount(providerAccountId, provider) {
            const account = await prisma.oAuthAccount.findUnique({
                where: {
                    provider_providerAccountId: { provider, providerAccountId },
                },
            });
            return account
                ? {
                      userId: String(account.userId),
                      type: account.type as AdapterAccount["type"],
                      provider: account.provider,
                      providerAccountId: account.providerAccountId,
                  }
                : null;
        },
    };
}
