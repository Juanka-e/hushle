import assert from "node:assert/strict";
import bcryptjs from "bcryptjs";
import {
    authenticateAccessToken,
    listMobileSessions,
    loginWithPassword,
    MobileAuthError,
    revokeMobileSession,
    rotateRefreshToken,
} from "@hushle/platform-auth";
import { prisma } from "@hushle/platform-db";

const options = {
    accessTtlMs: 5 * 60_000,
    refreshTtlMs: 24 * 60 * 60_000,
};

async function expectAuthError(
    action: () => Promise<unknown>,
    code: MobileAuthError["code"]
): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        return error instanceof MobileAuthError && error.code === code;
    });
}

async function run(): Promise<void> {
    if (process.env.MOBILE_AUTH_INTEGRATION_TEST !== "true") {
        console.log(
            "test:mobile-auth-integration skipped (set MOBILE_AUTH_INTEGRATION_TEST=true)"
        );
        return;
    }

    const username = `mobile_auth_${Date.now()}`;
    const user = await prisma.user.create({
        data: {
            username,
            password: await bcryptjs.hash("correct-horse-battery-staple", 10),
            role: "user",
        },
    });

    try {
        await expectAuthError(
            () =>
                loginWithPassword({
                    username,
                    password: "wrong-password",
                    deviceName: "Integration test",
                    options,
                }),
            "invalid_credentials"
        );

        const first = await loginWithPassword({
            username,
            password: "correct-horse-battery-staple",
            deviceName: "Test phone",
            userAgent: "mobile-auth-integration",
            options,
        });
        const firstAccess = await authenticateAccessToken(
            first.tokens.accessToken
        );
        assert.equal(firstAccess.user.id, user.id);

        const rotated = await rotateRefreshToken({
            refreshToken: first.tokens.refreshToken,
            options,
        });
        await expectAuthError(
            () => authenticateAccessToken(first.tokens.accessToken),
            "invalid_token"
        );
        assert.equal(
            (await authenticateAccessToken(rotated.tokens.accessToken)).user.id,
            user.id
        );

        const second = await loginWithPassword({
            username,
            password: "correct-horse-battery-staple",
            deviceName: "Second phone",
            options,
        });
        const sessions = await listMobileSessions(
            user.id,
            second.tokens.sessionId
        );
        assert.equal(sessions.length, 2);
        assert.equal(
            sessions.find((session) => session.current)?.id,
            second.tokens.sessionId
        );
        assert.equal(
            await revokeMobileSession({
                userId: user.id,
                sessionId: second.tokens.sessionId,
            }),
            true
        );
        await expectAuthError(
            () => authenticateAccessToken(second.tokens.accessToken),
            "invalid_token"
        );

        await expectAuthError(
            () =>
                rotateRefreshToken({
                    refreshToken: first.tokens.refreshToken,
                    options,
                }),
            "token_reuse_detected"
        );
        const revokedFamily = await prisma.mobileAuthSession.findUniqueOrThrow({
            where: { id: first.tokens.sessionId },
            select: { revokedAt: true, revokeReason: true },
        });
        assert.ok(revokedFamily.revokedAt);
        assert.equal(revokedFamily.revokeReason, "refresh_token_reuse");
        await expectAuthError(
            () => authenticateAccessToken(rotated.tokens.accessToken),
            "invalid_token"
        );

        console.log("test:mobile-auth-integration ok");
    } finally {
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }
}

void run();
