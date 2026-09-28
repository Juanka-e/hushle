import assert from "node:assert/strict";
import { hushleOAuthAdapter } from "../apps/web/src/lib/auth/oauth-adapter";
import { prisma } from "../apps/web/src/lib/prisma";

async function main() {
    const adapter = hushleOAuthAdapter();
    const email = `oauth-foundation-${Date.now()}@example.test`;
    let userId: number | null = null;

    try {
    const created = await adapter.createUser!({
        id: "ignored-by-hushle-adapter",
        name: "OAuth Test Oyuncusu",
        email,
        emailVerified: new Date(),
        image: null,
    });
    userId = Number(created.id);
    assert.ok(Number.isInteger(userId) && userId > 0);

    const stored = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
            password: true,
            emailVerifiedAt: true,
            wallet: { select: { id: true } },
            profile: { select: { displayName: true } },
        },
    });
    assert.equal(stored.password, null);
    assert.ok(stored.emailVerifiedAt);
    assert.ok(stored.wallet);
    assert.equal(stored.profile?.displayName, "OAuth Test Oyuncusu");

    const account = {
        userId: String(userId),
        type: "oidc" as const,
        provider: "google",
        providerAccountId: `google-sub-${Date.now()}`,
        access_token: "must-not-be-persisted",
        refresh_token: "must-not-be-persisted",
        id_token: "must-not-be-persisted",
    };
    await adapter.linkAccount!(account);
    const resolved = await adapter.getUserByAccount!({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
    });
    assert.equal(resolved?.id, String(userId));

    const persistedAccount = await prisma.oAuthAccount.findFirstOrThrow({
        where: { userId, provider: "google" },
    });
    assert.deepEqual(Object.keys(persistedAccount).sort(), [
        "createdAt",
        "id",
        "provider",
        "providerAccountId",
        "type",
        "updatedAt",
        "userId",
    ]);
    assert.equal(
        await prisma.oAuthAccount.count({
            where: { userId, provider: "google" },
        }),
        1
    );

    await adapter.unlinkAccount!({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
    });
    assert.equal(
        await prisma.oAuthAccount.count({ where: { userId } }),
        0
    );
        console.log("OAuth account foundation checks passed.");
    } finally {
        if (userId) {
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    }
}

void main();
