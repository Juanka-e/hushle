import { isStreamerConfigError } from "@hushle/platform-streamer";
import { NextResponse } from "next/server";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";
import { getSessionUser } from "@/lib/session";
import { listConnectionsView } from "@/lib/streamer/connections-view";
import { createConnectFlowDeps } from "@/lib/streamer/deps";
import type { StreamerConnectionsResponse } from "@/types/streamer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }
    try {
        const view: StreamerConnectionsResponse = await listConnectionsView(createConnectFlowDeps(request), sessionUser.id);
        return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        if (isStreamerConfigError(error)) {
            // Not configured on this deployment: the section simply stays hidden.
            const empty: StreamerConnectionsResponse = { enabled: false, platforms: [] };
            return NextResponse.json(empty, { headers: { "cache-control": "no-store" } });
        }
        console.error("streamer connections view failed", error);
        return NextResponse.json(playerError(PlayerErrorCode.UNKNOWN_ERROR), { status: 500 });
    }
}
