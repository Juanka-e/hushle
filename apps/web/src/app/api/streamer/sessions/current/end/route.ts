import { NextResponse } from "next/server";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { getSessionUser } from "@/lib/session";
import { createSessionServiceDeps } from "@/lib/streamer/session-deps";
import { streamerSessionErrorResponse } from "@/lib/streamer/session-http";
import { endCurrent, toSessionView } from "@/lib/streamer/session-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    try {
        const deps = createSessionServiceDeps();
        const { sessionId } = await endCurrent(deps, sessionUser.id);
        const record = await deps.sessions.findById(sessionId);
        return NextResponse.json({ ok: true, session: record ? toSessionView(record) : null }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        const mapped = streamerSessionErrorResponse(error);
        if (mapped) return mapped;
        console.error("streamer session end failed", error);
        return NextResponse.json(playerError(PlayerErrorCode.UNKNOWN_ERROR), { status: 500 });
    }
}
