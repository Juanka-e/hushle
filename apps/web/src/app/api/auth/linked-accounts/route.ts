import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import {
    getOAuthProviderDescriptors,
    isKnownOAuthProvider,
} from "@/lib/auth/oauth-providers";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";

export async function GET() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
    }
    const accounts = await prisma.oAuthAccount.findMany({
        where: { userId: sessionUser.id },
        select: { provider: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: sessionUser.id },
        select: { password: true },
    });
    const linked = new Map(accounts.map((account) => [account.provider, account]));

    return NextResponse.json({
        hasPassword: Boolean(user.password),
        providers: getOAuthProviderDescriptors()
            .filter((provider) => provider.enabled || linked.has(provider.id))
            .map((provider) => ({
                id: provider.id,
                label: provider.label,
                enabled: provider.enabled,
                linked: linked.has(provider.id),
                linkedAt: linked.get(provider.id)?.createdAt.toISOString() ?? null,
            })),
    });
}

export async function DELETE(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
    }
    const limit = await consumeDistributedRequestRateLimit({
        bucket: "oauth-account-unlink",
        key: `user:${sessionUser.id}:ip:${getRequestIp(request)}`,
        windowMs: 15 * 60_000,
        maxRequests: 5,
    });
    if (!limit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla hesap bağlantısı isteği yapıldı." },
            { status: 429, headers: buildRateLimitHeaders(limit) }
        );
    }

    const payload = (await request.json().catch(() => null)) as
        | { provider?: string }
        | null;
    const provider = payload?.provider?.trim().toLowerCase() ?? "";
    if (!isKnownOAuthProvider(provider)) {
        return NextResponse.json({ error: "Geçersiz sağlayıcı." }, { status: 400 });
    }

    const outcome = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
            where: { id: sessionUser.id },
            select: {
                password: true,
                oauthAccounts: {
                    select: { id: true, provider: true },
                },
            },
        });
        if (!user) return "missing_user" as const;
        const account = user.oauthAccounts.find(
            (candidate) => candidate.provider === provider
        );
        if (!account) return "missing_account" as const;
        if (!user.password && user.oauthAccounts.length <= 1) {
            return "last_method" as const;
        }
        await tx.oAuthAccount.delete({ where: { id: account.id } });
        return "deleted" as const;
    });

    if (outcome === "last_method") {
        return NextResponse.json(
            {
                error:
                    "Bu hesap tek giriş yöntemin. Önce parola oluşturmalısın.",
            },
            { status: 409, headers: buildRateLimitHeaders(limit) }
        );
    }
    if (outcome !== "deleted") {
        return NextResponse.json(
            { error: "Bağlı hesap bulunamadı." },
            { status: 404, headers: buildRateLimitHeaders(limit) }
        );
    }

    await writeAuditLog({
        actor: { id: sessionUser.id, role: sessionUser.role },
        action: "user.oauth_account.unlink",
        resourceType: "oauth_account",
        resourceId: provider,
        summary: `Unlinked ${provider} sign-in account`,
        metadata: { provider },
        request,
    }).catch((error) =>
        console.error("OAuth account unlink audit failed", error)
    );
    return NextResponse.json(
        { status: "unlinked", provider },
        { headers: buildRateLimitHeaders(limit) }
    );
}
