import { NextResponse, type NextRequest } from "next/server";
import { PlayerErrorCode, playerError, playerErrorFromValidation } from "@/lib/errors/player-error";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";
import { listCardBacksForUser } from "@/lib/streamer/card-backs";
import { publicOriginFor } from "@/lib/streamer/redirects";
import { createSessionServiceDeps } from "@/lib/streamer/session-deps";
import { buildStreamUrls, rateLimitedResponse, streamerRouteFailure } from "@/lib/streamer/session-http";
import { createSession, createSessionInputSchema, currentSession, lastSettings } from "@/lib/streamer/session-service";
import { getSystemSettings } from "@/lib/system-settings/service";
import type { CreateStreamSessionResponse, StreamSessionResponse } from "@/types/streamer-session";

export const dynamic = "force-dynamic";

export async function GET() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    try {
        const settings = await getSystemSettings();
        if (!settings.features.streamerModeEnabled) {
            const off: StreamSessionResponse = { enabled: false, session: null, lastSettings: null, cardBacks: [] };
            return NextResponse.json(off, { headers: { "cache-control": "no-store" } });
        }
        const deps = createSessionServiceDeps();
        const [session, last, cardBacks] = await Promise.all([
            currentSession(deps, sessionUser.id),
            lastSettings(deps, sessionUser.id),
            listCardBacksForUser(sessionUser.id, { streamerShowcaseAllCosmetics: settings.features.streamerShowcaseAllCosmetics }),
        ]);
        const body: StreamSessionResponse = { enabled: true, session, lastSettings: last, cardBacks };
        return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        return streamerRouteFailure(error, "streamer session view failed");
    }
}

// Checks in order (pinned by scripts/test-streamer-session-foundation.ts): origin, an active
// account, streamer mode on, the rate limit, then the work. The quota is spent only on a request
// that may open a session.
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
            bucket: "streamer-session-create",
            key: `user:${sessionUser.id}`,
            windowMs: 15 * 60_000,
            maxRequests: 10,
        });
        if (!limit.allowed) return rateLimitedResponse(limit);
        let raw: unknown;
        try {
            raw = await request.json();
        } catch {
            return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 400 });
        }
        const parsed = createSessionInputSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json(playerErrorFromValidation(parsed.error, {}), { status: 400 });
        }
        const { session, viewKey } = await createSession(createSessionServiceDeps(), { userId: sessionUser.id, settings: parsed.data });
        const origin = publicOriginFor(process.env, request.nextUrl.origin);
        const body: CreateStreamSessionResponse = { session, viewKey, urls: buildStreamUrls(origin, viewKey) };
        return NextResponse.json(body, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
        return streamerRouteFailure(error, "streamer session create failed");
    }
}
