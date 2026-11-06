import { NextResponse, type NextRequest } from "next/server";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";
import { publicOriginFor } from "@/lib/streamer/redirects";
import { createSessionServiceDeps } from "@/lib/streamer/session-deps";
import { buildStreamUrls, rateLimitedResponse, streamerRouteFailure } from "@/lib/streamer/session-http";
import { rotateViewKey } from "@/lib/streamer/session-service";
import { getSystemSettings } from "@/lib/system-settings/service";
import { STREAMER_VIEW_KEY_LIMIT } from "@/lib/streamer/view-key";
import type { RotateViewKeyResponse } from "@/types/streamer-session";

export const dynamic = "force-dynamic";

// Checks in order (pinned by scripts/test-streamer-session-foundation.ts): origin, an active
// account (as for creating a session), streamer mode on, the shared view-key limit, then the work.
export async function POST(request: NextRequest) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser || sessionUser.accountStatus !== "active") {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    try {
        if (!(await getSystemSettings()).features.streamerModeEnabled) {
            return NextResponse.json(playerError(PlayerErrorCode.STREAMER_MODE_DISABLED), { status: 403 });
        }
        const limit = await consumeDistributedRequestRateLimit({
            ...STREAMER_VIEW_KEY_LIMIT,
            key: `user:${sessionUser.id}`,
        });
        if (!limit.allowed) return rateLimitedResponse(limit);
        const { viewKey } = await rotateViewKey(createSessionServiceDeps(), sessionUser.id);
        const origin = publicOriginFor(process.env, request.nextUrl.origin);
        const body: RotateViewKeyResponse = { viewKey, urls: buildStreamUrls(origin, viewKey) };
        return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        return streamerRouteFailure(error, "streamer view key rotation failed");
    }
}
