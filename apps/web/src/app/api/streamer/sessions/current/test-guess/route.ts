import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PlayerErrorCode, playerError, playerErrorFromValidation } from "@/lib/errors/player-error";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import { getSessionUser } from "@/lib/session";
import { isFakeStreamerPlatformEnabled } from "@/lib/streamer/deps";
import { getStreamerSessionRuntime } from "@/lib/streamer/session-deps";
import { rateLimitedResponse, streamerRouteFailure } from "@/lib/streamer/session-http";
import { getSystemSettings } from "@/lib/system-settings/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string().min(1).max(25), text: z.string().min(1).max(200) }).strict();

// Lets a host try the screen without a live chat; only exists while the fake platform is on.
// Checks in order (pinned by scripts/test-streamer-session-foundation.ts): the fake-platform gate
// before anything else, so a production server never reveals the route (a bare 404, nothing read);
// then origin, an active account, streamer mode on, the rate limit and the work.
export async function POST(request: Request) {
    if (!isFakeStreamerPlatformEnabled()) {
        return new NextResponse(null, { status: 404 });
    }
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
            bucket: "streamer-test-guess",
            key: `user:${sessionUser.id}`,
            windowMs: 60_000,
            maxRequests: 120,
        });
        if (!limit.allowed) return rateLimitedResponse(limit);
        let raw: unknown;
        try {
            raw = await request.json();
        } catch {
            return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 400 });
        }
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json(playerErrorFromValidation(parsed.error, {}), { status: 400 });
        }
        const runtime = getStreamerSessionRuntime();
        const live = runtime.forUser(sessionUser.id);
        if (!live) {
            return NextResponse.json(playerError(PlayerErrorCode.STREAMER_SESSION_NOT_FOUND), { status: 404 });
        }
        const { name, text } = parsed.data;
        const result = await runtime.guess(live.id, {
            platform: "fake",
            platformUserId: `fake-${name.toLowerCase()}`,
            name,
            text,
            messageId: randomUUID(),
            sentAt: Date.now(),
        });
        return NextResponse.json({ result }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        return streamerRouteFailure(error, "streamer test guess failed");
    }
}
