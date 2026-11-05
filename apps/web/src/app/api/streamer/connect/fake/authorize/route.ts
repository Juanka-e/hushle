import { NextResponse, type NextRequest } from "next/server";
import { isFakeStreamerPlatformEnabled, resolveConnectOrigin } from "@/lib/streamer/deps";

export const dynamic = "force-dynamic";

// Stands in for the platform's consent page when STREAMER_FAKE_PLATFORM=1 (never in
// production): it only ever redirects back to this site's own connect callbacks.
export async function GET(request: NextRequest) {
    if (!isFakeStreamerPlatformEnabled()) {
        return new NextResponse(null, { status: 404 });
    }
    const params = request.nextUrl.searchParams;
    const redirectUri = params.get("redirect_uri") ?? "";
    const state = params.get("state") ?? "";
    const login = /^[a-z0-9_-]{1,25}$/.test(params.get("login") ?? "") ? (params.get("login") as string) : "denizoynuyor";
    const allowedPrefix = `${resolveConnectOrigin(request)}/api/streamer/connect/`;
    if (!redirectUri.startsWith(allowedPrefix) || !redirectUri.endsWith("/callback") || !state) {
        return NextResponse.json({ error: "redirect_uri or state rejected" }, { status: 400 });
    }
    const target = new URL(redirectUri);
    if (params.get("deny") === "1") target.searchParams.set("error", "access_denied");
    else target.searchParams.set("code", `fake-code-${login}`);
    target.searchParams.set("state", state);
    return NextResponse.redirect(target, 302);
}
