import { NextResponse } from "next/server";
import { getStoreCatalog } from "@/lib/economy";
import { getSessionUser } from "@/lib/session";
import { getSystemSettings } from "@/lib/system-settings/service";
import { isStoreAvailable } from "@/lib/system-settings/policies";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export async function GET(request: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "store-catalog-read",
        key: `${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 60,
    });

    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    const settings = await getSystemSettings();
    if (!isStoreAvailable(settings)) {
        return NextResponse.json(
            playerError(PlayerErrorCode.STORE_DISABLED),
            { status: 409 }
        );
    }

    const catalog = await getStoreCatalog(sessionUser.id, settings);
    return NextResponse.json(catalog, {
        headers: buildRateLimitHeaders(rateLimit),
    });
}
