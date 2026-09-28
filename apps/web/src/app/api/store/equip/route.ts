import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { enforceAccountCapability } from "@/lib/auth/account-capability";
import {
  equipInventoryItem,
  InventoryError,
} from "@hushle/platform-inventory";
import {
  buildRateLimitHeaders,
  consumeRequestRateLimit,
  getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getSystemSettings } from "@/lib/system-settings/service";
import {
  getFeatureDisabledMessage,
  isStoreAvailable,
} from "@/lib/system-settings/policies";

export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
  }
  const capabilityError = enforceAccountCapability(
    sessionUser,
    "store_mutation"
  );
  if (capabilityError) return capabilityError;

  const settings = await getSystemSettings();
  if (!isStoreAvailable(settings)) {
    return NextResponse.json({ error: getFeatureDisabledMessage("store") }, { status: 409 });
  }

  try {
    const rateLimit = consumeRequestRateLimit({
      bucket: "store-equip",
      key: `user:${sessionUser.id}:${getRequestIp(req)}`,
      windowMs: 60_000,
      maxRequests: 30,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Cok fazla kusanma istegi gonderdin. Biraz bekleyip tekrar dene." },
        { status: 429, headers: buildRateLimitHeaders(rateLimit) }
      );
    }

    const body = await req.json();
    const result = await equipInventoryItem({
      userId: sessionUser.id,
      request: body,
    });

    return NextResponse.json({
      profile: result.profile,
      equippedSlots: result.equippedSlots,
    });
  } catch (error) {
    if (error instanceof InventoryError) {
      if (error.code === "invalid_request") {
        return NextResponse.json({ error: error.message }, { status: 422 });
      }
      if (error.code === "item_not_found") {
        return NextResponse.json({ error: "Urun bulunamadi." }, { status: 404 });
      }
      if (error.code === "type_mismatch") {
        return NextResponse.json({ error: "Kozmetik slotu gecersiz." }, { status: 409 });
      }
      if (error.code === "not_owned") {
        return NextResponse.json({ error: "Urun envanterde degil." }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Kusanma islemi basarisiz." }, { status: 500 });
  }
}
