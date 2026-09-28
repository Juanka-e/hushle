import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcryptjs from "bcryptjs";
import {
    checkPasswordLoginRateLimit,
    clearPasswordLoginAccountFailures,
    recordPasswordLoginFailure,
} from "@hushle/platform-auth";
import { prisma } from "@/lib/prisma";
import { sharedAuthConfig } from "@/lib/auth-shared";
import { getSystemSettings } from "@/lib/system-settings/service";
import { verifyCaptchaForAction } from "@/lib/security/captcha";
import { getRequestIp } from "@/lib/security/request-rate-limit";
import { recordUserAccessSignal } from "@/lib/security/user-access-signal";
import { clearExpiredSuspensions, isSuspensionActive } from "@/lib/moderation/service";
import { hushleOAuthAdapter } from "@/lib/auth/oauth-adapter";
import { getEnabledOAuthProviders } from "@/lib/auth/oauth-providers";
import { writeAuditLog } from "@/lib/security/audit-log";

const DUMMY_PASSWORD_HASH =
    "$2b$10$fZX8p9xEhu7surFIEeFgmectWV9l4AH.2tF2nIliwfWhnRLKK21nO";

export const { handlers, signIn, signOut, auth } = NextAuth({
    ...sharedAuthConfig,
    adapter: hushleOAuthAdapter(),
    providers: [
        Credentials({
            name: "Credentials",
            credentials: {
                username: { label: "Kullanici Adi", type: "text" },
                password: { label: "Sifre", type: "password" },
                portal: { label: "Portal", type: "text" },
                captchaToken: { label: "Captcha Token", type: "text" },
                captchaAction: { label: "Captcha Action", type: "text" },
            },
            async authorize(credentials, request) {
                const username =
                    typeof credentials?.username === "string"
                        ? credentials.username.trim()
                        : "";
                const password =
                    typeof credentials?.password === "string"
                        ? credentials.password
                        : "";
                const portal =
                    typeof credentials?.portal === "string"
                        ? credentials.portal
                        : "user";

                if (
                    !username ||
                    username.length > 50 ||
                    !password ||
                    password.length > 255
                ) {
                    return null;
                }

                const remoteIp = getRequestIp(request);
                const loginLimit = await checkPasswordLoginRateLimit({
                    remoteIp,
                    username,
                });
                if (!loginLimit.allowed) {
                    return null;
                }

                const settings = await getSystemSettings();
                const captchaResult = await verifyCaptchaForAction({
                    action: "login",
                    token: typeof credentials.captchaToken === "string" ? credentials.captchaToken : null,
                    remoteIp,
                    settings,
                });
                if (!captchaResult.ok) {
                    return null;
                }

                const user = await prisma.user.findUnique({
                    where: { username },
                    select: {
                        id: true,
                        username: true,
                        password: true,
                        role: true,
                        sessionVersion: true,
                        isSuspended: true,
                        suspendedUntil: true,
                    },
                });
                const isValid = await bcryptjs.compare(
                    password,
                    user?.password ?? DUMMY_PASSWORD_HASH
                );
                if (!user || !isValid) {
                    await recordPasswordLoginFailure({
                        remoteIp,
                        username,
                    });
                    return null;
                }

                await clearPasswordLoginAccountFailures(username);
                await clearExpiredSuspensions();
                if (isSuspensionActive(user)) {
                    return null;
                }

                if (portal === "admin" && user.role !== "admin") {
                    return null;
                }

                await recordUserAccessSignal({
                    userId: user.id,
                    request,
                });

                return {
                    id: String(user.id),
                    name: user.username,
                    role: user.role,
                    sessionVersion: user.sessionVersion,
                };
            },
        }),
        ...getEnabledOAuthProviders(),
    ],
    callbacks: {
        ...sharedAuthConfig.callbacks,
        async signIn({ user, account, profile }) {
            if (account?.provider === "google") {
                const googleProfile = profile as
                    | { email_verified?: boolean }
                    | undefined;
                if (googleProfile?.email_verified !== true) {
                    return false;
                }
            }

            const userId = Number(user.id);
            if (Number.isInteger(userId) && userId > 0) {
                await clearExpiredSuspensions();
                const record = await prisma.user.findUnique({
                    where: { id: userId },
                    select: {
                        isSuspended: true,
                        suspendedUntil: true,
                    },
                });
                if (!record || isSuspensionActive(record)) {
                    return false;
                }
            }
            return true;
        },
    },
    events: {
        async linkAccount({ user, account, profile }) {
            const userId = Number(user.id);
            if (!Number.isInteger(userId) || userId <= 0) return;
            if (account.provider === "google") {
                const googleProfile = profile as
                    | { email?: string; email_verified?: boolean }
                    | undefined;
                if (googleProfile?.email_verified && googleProfile.email) {
                    try {
                        const current = await prisma.user.findUnique({
                            where: { id: userId },
                            select: { normalizedEmail: true },
                        });
                        const providerEmail = googleProfile.email
                            .trim()
                            .toLowerCase();
                        if (current?.normalizedEmail === providerEmail) {
                            await prisma.user.update({
                                where: { id: userId },
                                data: {
                                    emailVerifiedAt: new Date(),
                                    emailVerificationRequiredAt: null,
                                    accountStatus: "active",
                                },
                            });
                        }
                    } catch (error) {
                        console.error("OAuth email verification sync failed", error);
                    }
                }
            }
            await writeAuditLog({
                actor: { id: userId, role: user.role || "user" },
                action: "user.oauth_account.link",
                resourceType: "oauth_account",
                resourceId: account.provider,
                summary: `Linked ${account.provider} sign-in account`,
                metadata: { provider: account.provider },
            }).catch((error) =>
                console.error("OAuth account link audit failed", error)
            );
        },
    },
});
