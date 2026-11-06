import { NextResponse } from "next/server";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { getSessionUser } from "@/lib/session";
import { createSessionServiceDeps } from "@/lib/streamer/session-deps";
import { streamerRouteFailure } from "@/lib/streamer/session-http";
import { endCurrent } from "@/lib/streamer/session-service";
import type { EndStreamSessionResponse } from "@/types/streamer-session";

export const dynamic = "force-dynamic";

// Checks in order (pinned by scripts/test-streamer-session-foundation.ts): origin, a signed-in
// owner, then the work. Unlike the other session routes there is no account-status, streamer-mode
// or quota gate, on purpose: ending only takes the caller's own stream off the air, so it is always
// safe, and an owner whose account stopped being active (or whose streamer mode was switched off)
// must still be able to stop a stream that is running.
export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    try {
        // Nothing live to end is the typed `not_found`: 404 STREAMER_SESSION_NOT_FOUND.
        const { session } = await endCurrent(createSessionServiceDeps(), sessionUser.id);
        const body: EndStreamSessionResponse = { ok: true, session };
        return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        return streamerRouteFailure(error, "streamer session end failed");
    }
}
