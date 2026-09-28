import { NextResponse } from "next/server";
import { z } from "zod";
import { getStoreCatalog } from "@/lib/economy";
import { getSessionUser } from "@/lib/session";
import { STORE_ITEM_TYPES } from "@/types/economy";
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

const querySchema = z.object({
  type: z.enum(STORE_ITEM_TYPES).optional(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({ type: searchParams.get("type") || undefined });

  if (!parsed.success) {
    return NextResponse.json({ error: "Gecersiz filtre." }, { status: 422 });
  }

  const sessionUser = await getSessionUser();
  const rateLimit = consumeRequestRateLimit({
    bucket: "store-items-read",
    key: sessionUser
      ? `user:${sessionUser.id}:${getRequestIp(req)}`
      : `guest:${getRequestIp(req)}`,
    windowMs: 60_000,
    maxRequests: 60,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Cok fazla magaza istegi gonderildi. Lutfen biraz bekleyin." },
      { status: 429, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  const settings = await getSystemSettings();
  if (!isStoreAvailable(settings)) {
    return NextResponse.json({ error: getFeatureDisabledMessage("store") }, { status: 409 });
  }
  const catalog = await getStoreCatalog(sessionUser?.id, settings);
  const items = parsed.data.type
    ? catalog.items.filter((item) => item.type === parsed.data.type)
    : catalog.items;

  return NextResponse.json({ items }, { headers: buildRateLimitHeaders(rateLimit) });
}
