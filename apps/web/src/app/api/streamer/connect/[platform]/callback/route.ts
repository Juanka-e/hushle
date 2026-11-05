import { StreamerConfigError } from "@hushle/platform-streamer";
import { NextResponse, type NextRequest } from "next/server";
import { getRequestIp } from "@/lib/security/client-ip";
import { getSessionUser } from "@/lib/session";
import { CONNECT_STATE_COOKIE, CONNECT_STATE_COOKIE_PATH } from "@/lib/streamer/connect-state";
import { completeConnect } from "@/lib/streamer/connect-flow";
import { createConnectFlowDeps, resolveConnectOrigin } from "@/lib/streamer/deps";
import { settingsRedirect } from "@/lib/streamer/redirects";

export const dynamic = "force-dynamic";

// The platform sends the browser here. The state cookie is consumed whatever happens.
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
    const { platform } = await params;
    const base = request.nextUrl.origin;
    const clearCookie = (response: NextResponse) => {
        response.cookies.set({ name: CONNECT_STATE_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: CONNECT_STATE_COOKIE_PATH, maxAge: 0 });
        return response;
    };
    let deps;
    try {
        deps = createConnectFlowDeps(request);
    } catch (error) {
        if (error instanceof StreamerConfigError) {
            return clearCookie(NextResponse.redirect(new URL(settingsRedirect("error", platform, "platform_unavailable"), base), 302));
        }
        throw error;
    }
    const sessionUser = await getSessionUser();
    const result = await completeConnect(deps, {
        user: sessionUser ? { id: sessionUser.id, role: sessionUser.role } : null,
        platform,
        query: request.nextUrl.searchParams,
        cookieValue: request.cookies.get(CONNECT_STATE_COOKIE)?.value,
        requestIp: getRequestIp(request),
        origin: resolveConnectOrigin(request),
    });
    return clearCookie(NextResponse.redirect(new URL(result.redirectTo, base), 302));
}
