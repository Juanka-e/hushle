import { NextRequest, NextResponse } from "next/server";
import {
    getJsonCacheMetrics,
    getRedisHealth,
} from "@hushle/platform-cache";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getSystemSettings } from "@/lib/system-settings/service";
import { getCapacityClusterSnapshot } from "@/lib/socket/room-capacity";
import { evaluateCapacityAdmission } from "@/lib/socket/room-capacity-policy";
import { getRoomMetrics } from "@/lib/socket/room-metrics";
import {
    getObservabilityStatus,
    reportError,
} from "@hushle/platform-observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-capacity-health-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Kapasite durumu çok sık yenilendi. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const local = getRoomMetrics();
        const [settings, redis, cluster] = await Promise.all([
            getSystemSettings(),
            getRedisHealth(),
            getCapacityClusterSnapshot({
                activeRooms: local.aktifLobiSayisi,
                activeMatches: local.aktifMacSayisi,
                onlinePlayers: local.onlineKullaniciSayisi,
                spectators: local.izleyiciSayisi,
                connectedSockets: local.bagliSocketSayisi,
            }),
        ]);
        const admission = evaluateCapacityAdmission(
            {
                activeRooms: cluster.activeRooms,
                onlinePlayers: cluster.onlinePlayers,
            },
            settings.capacity
        );

        return NextResponse.json(
            {
                checkedAt: new Date().toISOString(),
                redis,
                cache: getJsonCacheMetrics(),
                observability: getObservabilityStatus(),
                cluster,
                admission,
                limits: {
                    maxActiveRooms: settings.capacity.maxActiveRooms,
                    maxOnlinePlayers: settings.capacity.maxOnlinePlayers,
                    roomMaxPlayers: settings.capacity.roomMaxPlayers,
                    teamMaxPlayers: settings.capacity.teamMaxPlayers,
                    warningThresholdPercent:
                        settings.capacity.warningThresholdPercent,
                    criticalThresholdPercent:
                        settings.capacity.criticalThresholdPercent,
                    admissionMode: settings.capacity.admissionMode,
                },
            },
            {
                headers: {
                    ...buildRateLimitHeaders(rateLimit),
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (error) {
        await reportError({
            service: "hushle-web",
            event: "admin.capacity_health.failed",
            requestId: request.headers.get("x-request-id"),
            error,
        });
        return NextResponse.json(
            { error: "Kapasite durumu okunamadı." },
            { status: 500 }
        );
    }
}
