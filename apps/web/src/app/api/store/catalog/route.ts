import { NextResponse } from "next/server";
import { getStoreCatalog } from "@/lib/economy";
import { getSessionUser } from "@/lib/session";
import { getSystemSettings } from "@/lib/system-settings/service";
import {
    getFeatureDisabledMessage,
    isStoreAvailable,
} from "@/lib/system-settings/policies";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export async function GET(request: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "store-catalog-read",
        key: `${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 60,
    });

    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla katalog istegi gonderildi. Lutfen bekleyin." },
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    const settings = await getSystemSettings();
    if (!isStoreAvailable(settings)) {
        return NextResponse.json(
            { error: getFeatureDisabledMessage("store") },
            { status: 409 }
        );
    }

    const catalog = await getStoreCatalog(sessionUser.id, settings);
    return NextResponse.json(catalog, {
        headers: buildRateLimitHeaders(rateLimit),
    });
}
