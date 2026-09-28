import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { closeRedisClient } from "@hushle/platform-cache";
import { invalidateAdminDashboardStatsCache } from "../apps/web/src/lib/cache/application-cache";
import { prisma } from "@hushle/platform-db";

const serverUrl = process.env.CACHE_TEST_URL ?? "http://127.0.0.1:3000";

function assertSafeTarget(): void {
    assert.equal(
        process.env.ADMIN_DASHBOARD_CACHE_MUTATION_TEST,
        "true",
        "ADMIN_DASHBOARD_CACHE_MUTATION_TEST=true is required"
    );
    const url = new URL(serverUrl);
    assert.ok(
        url.hostname === "127.0.0.1" || url.hostname === "localhost",
        "Admin dashboard cache test only supports a loopback server"
    );
}

function cookieHeaderFrom(setCookies: string[]): string {
    return setCookies
        .map((cookie) => cookie.split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
}

async function loginAdmin(
    username: string,
    password: string
): Promise<string> {
    const csrfResponse = await fetch(`${serverUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.ok, true);
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const csrfCookies = csrfResponse.headers.getSetCookie();
    const callbackResponse = await fetch(
        `${serverUrl}/api/auth/callback/credentials`,
        {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                cookie: cookieHeaderFrom(csrfCookies),
            },
            body: new URLSearchParams({
                csrfToken: csrf.csrfToken,
                username,
                password,
                portal: "admin",
                callbackUrl: `${serverUrl}/admin`,
            }),
            redirect: "manual",
        }
    );
    assert.ok(
        callbackResponse.status === 200 ||
            callbackResponse.status === 302 ||
            callbackResponse.status === 303
    );
    return cookieHeaderFrom([
        ...csrfCookies,
        ...callbackResponse.headers.getSetCookie(),
    ]);
}

async function readDashboard(cookie: string): Promise<{
    source: string | null;
    totalWords: number;
}> {
    const response = await fetch(`${serverUrl}/api/admin/dashboard-stats`, {
        headers: { cookie },
    });
    const payload = (await response.json()) as {
        totalWords?: number;
        error?: string;
    };
    assert.equal(response.ok, true, payload.error);
    assert.equal(typeof payload.totalWords, "number");
    return {
        source: response.headers.get("x-cache-source"),
        totalWords: payload.totalWords as number,
    };
}

async function run(): Promise<void> {
    assertSafeTarget();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `cache_admin_${suffix}`;
    const password = `CacheAdmin-${suffix}!`;
    let adminId: number | null = null;
    let wordId: number | null = null;

    try {
        const admin = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                role: "admin",
            },
        });
        adminId = admin.id;
        const cookie = await loginAdmin(username, password);

        await invalidateAdminDashboardStatsCache();
        const first = await readDashboard(cookie);
        const second = await readDashboard(cookie);
        assert.equal(first.source, "loader");
        assert.equal(second.source, "redis");
        assert.equal(second.totalWords, first.totalWords);

        const word = await prisma.word.create({
            data: {
                wordText: `dashboard-cache-${suffix}`,
                difficulty: 2,
                tabooWords: {
                    create: [{ tabooWordText: "cache" }],
                },
            },
        });
        wordId = word.id;
        const stale = await readDashboard(cookie);
        assert.equal(stale.source, "redis");
        assert.equal(stale.totalWords, first.totalWords);

        await invalidateAdminDashboardStatsCache();
        const refreshed = await readDashboard(cookie);
        assert.equal(refreshed.source, "loader");
        assert.equal(refreshed.totalWords, first.totalWords + 1);

        const healthResponse = await fetch(
            `${serverUrl}/api/admin/capacity-health`,
            { headers: { cookie } }
        );
        const health = (await healthResponse.json()) as {
            cache?: { redisHits?: number; loads?: number };
            error?: string;
        };
        assert.equal(healthResponse.ok, true, health.error);
        assert.ok((health.cache?.redisHits ?? 0) >= 2);
        assert.ok((health.cache?.loads ?? 0) >= 2);

        console.log("admin dashboard cache integration test passed");
    } finally {
        if (wordId !== null) {
            await prisma.word.deleteMany({ where: { id: wordId } });
        }
        if (adminId !== null) {
            await prisma.auditLog.deleteMany({
                where: { actorUserId: adminId },
            });
            await prisma.user.deleteMany({ where: { id: adminId } });
        }
        await invalidateAdminDashboardStatsCache();
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run();
