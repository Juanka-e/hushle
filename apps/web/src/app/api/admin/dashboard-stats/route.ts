import { getOrSetJsonCache } from "@hushle/platform-cache";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { APPLICATION_CACHE_KEYS } from "@/lib/cache/application-cache";
import { prisma } from "@/lib/prisma";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getRoomMetrics } from "@/lib/socket/room-metrics";

export const dynamic = "force-dynamic";

interface DashboardStaticStats {
    totalWords: number;
    easyCount: number;
    mediumCount: number;
    hardCount: number;
    totalCategories: number;
}

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-dashboard-stats-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla istatistik istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const staticStats = await getOrSetJsonCache<DashboardStaticStats>({
            key: APPLICATION_CACHE_KEYS.adminDashboardStaticStats,
            ttlMs: 10_000,
            loader: async () => {
                const [
                    totalWords,
                    easyCount,
                    mediumCount,
                    hardCount,
                    totalCategories,
                ] = await Promise.all([
                    prisma.word.count(),
                    prisma.word.count({ where: { difficulty: 1 } }),
                    prisma.word.count({ where: { difficulty: 2 } }),
                    prisma.word.count({ where: { difficulty: 3 } }),
                    prisma.category.count(),
                ]);
                return {
                    totalWords,
                    easyCount,
                    mediumCount,
                    hardCount,
                    totalCategories,
                };
            },
        });

        let metrics = { aktifLobiSayisi: 0, onlineKullaniciSayisi: 0 };
        try {
            metrics = getRoomMetrics();
        } catch {
            // The socket runtime may not be initialized in build workers.
        }

        return NextResponse.json(
            {
                onlineKullaniciSayisi: metrics.onlineKullaniciSayisi,
                aktifLobiSayisi: metrics.aktifLobiSayisi,
                totalWords: staticStats.value.totalWords,
                totalCategories: staticStats.value.totalCategories,
                wordsByDifficulty: {
                    easy: staticStats.value.easyCount,
                    medium: staticStats.value.mediumCount,
                    hard: staticStats.value.hardCount,
                },
            },
            {
                headers: {
                    ...buildRateLimitHeaders(rateLimit),
                    "X-Cache-Source": staticStats.source,
                },
            }
        );
    } catch (error) {
        console.error("Failed to fetch dashboard stats:", error);
        return NextResponse.json(
            { error: "Istatistikler yuklenemedi." },
            { status: 500 }
        );
    }
}
