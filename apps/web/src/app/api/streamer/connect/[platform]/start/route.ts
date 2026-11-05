import { StreamerConfigError } from "@hushle/platform-streamer";
import { NextResponse, type NextRequest } from "next/server";
import { getRequestIp } from "@/lib/security/client-ip";
import { getSessionUser } from "@/lib/session";
import { CONNECT_STATE_COOKIE, CONNECT_STATE_COOKIE_PATH } from "@/lib/streamer/connect-state";
import { startConnect } from "@/lib/streamer/connect-flow";
import { createConnectFlowDeps, resolveConnectOrigin } from "@/lib/streamer/deps";
import { settingsRedirect } from "@/lib/streamer/redirects";

export const dynamic = "force-dynamic";

// Top-level navigation from the "Bağla" button: every outcome is a redirect, never a body.
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
    const { platform } = await params;
    const base = resolveConnectOrigin(request);
    let deps;
    try {
        deps = createConnectFlowDeps(request);
    } catch (error) {
        if (error instanceof StreamerConfigError) {
            return NextResponse.redirect(new URL(settingsRedirect("error", platform, "platform_unavailable"), base), 302);
        }
        throw error;
    }
    let result;
    try {
        const sessionUser = await getSessionUser();
        result = await startConnect(deps, {
            user: sessionUser ? { id: sessionUser.id, role: sessionUser.role, accountStatus: sessionUser.accountStatus } : null,
            platform,
            requestIp: getRequestIp(request),
            origin: base,
        });
    } catch (error) {
        // A database or configuration failure must not leave the streamer on a raw 500 page.
        console.error("streamer connect start failed", error instanceof Error ? error.name : error);
        return NextResponse.redirect(new URL(settingsRedirect("error", platform, "internal_error"), base), 302);
    }
    const response = NextResponse.redirect(new URL(result.redirectTo, base), 302);
    if (result.setCookie) {
        response.cookies.set({
            name: CONNECT_STATE_COOKIE,
            value: result.setCookie.value,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: CONNECT_STATE_COOKIE_PATH,
            maxAge: result.setCookie.maxAgeSeconds,
        });
    }
    return response;
}
