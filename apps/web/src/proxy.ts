import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRequestId } from "@hushle/platform-observability";
import { sharedAuthConfig } from "@/lib/auth-shared";
import {
    evaluateAdminAccess,
    getAdminAccessFailureMessage,
} from "@/lib/admin/access-policy";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import {
    buildContentSecurityPolicy,
    generateCspNonce,
    shouldUpgradeInsecureRequests,
} from "@/lib/security/content-security-policy";

const { auth } = NextAuth(sharedAuthConfig);

function isAuthed(req: { auth?: { user?: { id?: string } } | null }): boolean {
    return Boolean(req.auth?.user?.id);
}

function shouldApplyPageCsp(req: NextRequest): boolean {
    if (req.nextUrl.pathname.startsWith("/api/")) {
        return false;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        return false;
    }

    const acceptHeader = req.headers.get("accept");
    return acceptHeader?.includes("text/html") ?? false;
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
    response.headers.set("X-Request-Id", requestId);
    return response;
}

function createPageResponse(req: NextRequest, requestId: string): NextResponse {
    const nonce = generateCspNonce();
    const isDev = process.env.NODE_ENV !== "production";
    const csp = buildContentSecurityPolicy({
        nonce,
        isDev,
        upgradeInsecureRequests: shouldUpgradeInsecureRequests(isDev),
    });
    const requestHeaders = new Headers(req.headers);

    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("x-pathname", req.nextUrl.pathname);
    requestHeaders.set("x-request-id", requestId);
    requestHeaders.set("Content-Security-Policy", csp);

    const response = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });

    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("x-nonce", nonce);
    response.headers.set("x-pathname", req.nextUrl.pathname);
    response.headers.set("X-Request-Id", requestId);

    return response;
}

export default auth((req) => {
    const requestId = getOrCreateRequestId(req.headers.get("x-request-id"));
    const respond = (response: NextResponse) => withRequestId(response, requestId);
    const { pathname } = req.nextUrl;
    const role = (req.auth?.user as { role?: string } | undefined)?.role;
    const adminAccess = evaluateAdminAccess(req);
    const requestLike = {
        headers: req.headers,
        method: req.method,
        url: req.url,
    };

    if (
        pathname.startsWith("/api/") &&
        !isTrustedStateChangeRequest(requestLike)
    ) {
        return respond(NextResponse.json(
            { error: "Origin dogrulamasi basarisiz." },
            { status: 403 }
        ));
    }

    if (pathname === "/admin" && !isAuthed(req)) {
        return respond(NextResponse.redirect(new URL("/", req.url)));
    }

    if (
        (pathname === "/admin" ||
            pathname.startsWith("/admin/") ||
            pathname.startsWith("/admin/login") ||
            pathname.startsWith("/api/admin")) &&
        !adminAccess.allowed
    ) {
        if (pathname.startsWith("/api/admin")) {
            return respond(NextResponse.json(
                { error: getAdminAccessFailureMessage(adminAccess) },
                { status: 403 }
            ));
        }

        return respond(NextResponse.redirect(new URL("/", req.url)));
    }

    if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
        if (!isAuthed(req)) {
            const loginUrl = new URL("/admin/login", req.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            return respond(NextResponse.redirect(loginUrl));
        }

        if (role !== "admin") {
            return respond(NextResponse.redirect(new URL("/dashboard", req.url)));
        }
    }

    if (pathname.startsWith("/admin/login") && isAuthed(req)) {
        if (role === "admin") {
            return respond(NextResponse.redirect(new URL("/admin", req.url)));
        }

        return respond(NextResponse.redirect(new URL("/dashboard", req.url)));
    }

    if (pathname.startsWith("/api/admin")) {
        if (!isAuthed(req) || role !== "admin") {
            return respond(NextResponse.json(
                { error: "Yetkisiz erisim." },
                { status: 401 }
            ));
        }
    }

    if (
        pathname.startsWith("/dashboard") ||
        pathname.startsWith("/profile") ||
        pathname.startsWith("/store")
        || pathname.startsWith("/checkout")
    ) {
        if (!isAuthed(req)) {
            const loginUrl = new URL("/login", req.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            return respond(NextResponse.redirect(loginUrl));
        }
    }

    if (
        pathname.startsWith("/api/user") ||
        pathname.startsWith("/api/notifications") ||
        pathname.startsWith("/api/store") ||
        pathname.startsWith("/api/game")
    ) {
        if (!isAuthed(req)) {
            return respond(NextResponse.json(
                { error: "Giris gerekli." },
                { status: 401 }
            ));
        }
    }

    if (shouldApplyPageCsp(req)) {
        return createPageResponse(req, requestId);
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-request-id", requestId);
    return respond(NextResponse.next({ request: { headers: requestHeaders } }));
});

export const config = {
    matcher: [
        {
            source: "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
            missing: [
                { type: "header", key: "next-router-prefetch" },
                { type: "header", key: "purpose", value: "prefetch" },
            ],
        },
        "/api/admin/:path*",
        "/api/support/:path*",
        "/api/coin-grants/:path*",
        "/api/notifications/:path*",
        "/api/notifications/archive-all",
        "/api/user/:path*",
        "/api/store/:path*",
        "/api/game/:path*",
        "/api/payments/offers",
        "/api/payments/checkout/:path*",
        "/api/payments/orders/:path*",
        "/api/auth/register",
        "/api/auth/email-verification/:path*",
    ],
};
