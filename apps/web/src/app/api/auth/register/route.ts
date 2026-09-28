import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { z } from "zod";
import { evaluatePasswordPolicy } from "@hushle/auth-policy";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getSystemSettings } from "@/lib/system-settings/service";
import {
    getFeatureDisabledMessage,
    isRegistrationAvailable,
} from "@/lib/system-settings/policies";
import { verifyCaptchaForAction } from "@/lib/security/captcha";
import {
    isEmailWithinLimit,
    normalizeEmail,
    sanitizeEmail,
} from "@/lib/users/email";
import { recordUserRegistrationSignal } from "@/lib/security/user-access-signal";
import { initializeWalletLedger } from "@/lib/wallet-ledger/service";
import { checkPasswordBreach } from "@/lib/security/password-breach";
import {
    enqueueEmailVerification,
    getEmailProviderReadiness,
} from "@hushle/platform-email";
import { UserAccountStatus } from "@hushle/platform-db";

const registerSchema = z.object({
    username: z.string().min(3, "Kullanici adi en az 3 karakter olmalidir."),
    email: z.email("Gecerli bir e-posta adresi girilmelidir."),
    password: z.string().max(256, "Parola çok uzun."),
    captchaToken: z.string().trim().min(1).max(2048).optional().nullable(),
});

export async function POST(req: Request) {
    try {
        const rateLimit = await consumeDistributedRequestRateLimit({
            bucket: "auth-register",
            key: `ip:${getRequestIp(req)}`,
            windowMs: 10 * 60_000,
            maxRequests: 5,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Cok fazla kayit denemesi yaptiniz. Daha sonra tekrar deneyin." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await req.json();
        const { username, email, password, captchaToken } = registerSchema.parse(body);
        const settings = await getSystemSettings();
        const passwordPolicy = evaluatePasswordPolicy(password, {
            username,
            email,
            siteName: settings.branding.siteName,
        });
        if (!passwordPolicy.accepted) {
            return NextResponse.json(
                {
                    error:
                        passwordPolicy.issues[0] ??
                        "Daha güçlü bir parola seçin.",
                },
                { status: 400 }
            );
        }

        const breachCheck = await checkPasswordBreach(password);
        if (breachCheck.status === "breached") {
            return NextResponse.json(
                {
                    error:
                        "Bu parola bilinen veri ihlallerinde kullanılmış. Lütfen farklı bir parola seçin.",
                },
                { status: 400 }
            );
        }

        const sanitizedEmail = sanitizeEmail(email);
        const normalizedEmail = normalizeEmail(email);

        if (!isEmailWithinLimit(sanitizedEmail)) {
            return NextResponse.json(
                { error: "E-posta adresi cok uzun." },
                { status: 400 }
            );
        }

        if (!isRegistrationAvailable(settings)) {
            return NextResponse.json(
                { error: getFeatureDisabledMessage("register") },
                { status: 409 }
            );
        }

        const verificationRequired =
            settings.security.emailVerification.mode ===
            "required_for_new_accounts";
        const emailReadiness = getEmailProviderReadiness();
        if (verificationRequired && !emailReadiness.configured) {
            return NextResponse.json(
                {
                    error:
                        "E-posta doğrulama servisi şu anda hazır değil. Lütfen kısa süre sonra tekrar deneyin.",
                },
                { status: 503 }
            );
        }

        const captchaResult = await verifyCaptchaForAction({
            action: "register",
            token: captchaToken ?? null,
            remoteIp: getRequestIp(req),
            settings,
        });
        if (!captchaResult.ok) {
            return NextResponse.json(
                { error: "Guvenlik dogrulamasi basarisiz. Lutfen tekrar deneyin." },
                { status: 403 }
            );
        }

        const existingUser = await prisma.user.findUnique({
            where: { username },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: "Bu kullanici adi zaten alinmis." },
                { status: 400 }
            );
        }

        const existingEmailUser = await prisma.user.findUnique({
            where: { normalizedEmail },
            select: { id: true },
        });
        if (existingEmailUser) {
            return NextResponse.json(
                { error: "Bu e-posta adresi zaten kullaniliyor." },
                { status: 400 }
            );
        }

        const hashedPassword = await bcryptjs.hash(password, 10);

        const now = new Date();
        const user = await prisma.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    username,
                    email: sanitizedEmail,
                    normalizedEmail,
                    password: hashedPassword,
                    role: "user",
                    accountStatus: verificationRequired
                        ? UserAccountStatus.pending_email_verification
                        : UserAccountStatus.active,
                    emailVerificationRequiredAt: verificationRequired
                        ? now
                        : null,
                    wallet: {
                        create: { coinBalance: settings.economy.startingCoinBalance },
                    },
                    profile: {
                        create: {},
                    },
                },
            });
            await initializeWalletLedger(tx, {
                userId: createdUser.id,
                source: "account_opening",
            });
            if (verificationRequired) {
                await enqueueEmailVerification(tx, {
                    userId: createdUser.id,
                    email: sanitizedEmail,
                    siteName: settings.branding.siteName,
                    now,
                });
            }
            return createdUser;
        });

        await recordUserRegistrationSignal({
            userId: user.id,
            request: req,
        });

        return NextResponse.json(
            {
                message: verificationRequired
                    ? "Hesabını etkinleştirmek için e-posta adresini doğrula."
                    : "Kayıt başarılı.",
                userId: user.id,
                verificationRequired,
                verificationEmailQueued: verificationRequired,
            },
            { status: 201 }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
        }
        return NextResponse.json(
            { error: "Kayit sirasinda bir hata olustu." },
            { status: 500 }
        );
    }
}
