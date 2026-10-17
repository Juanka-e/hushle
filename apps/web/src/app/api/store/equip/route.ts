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
import { isStoreAvailable } from "@/lib/system-settings/policies";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
  }
  const capabilityError = enforceAccountCapability(
    sessionUser,
    "store_mutation"
  );
  if (capabilityError) return capabilityError;

  const settings = await getSystemSettings();
  if (!isStoreAvailable(settings)) {
    return NextResponse.json(playerError(PlayerErrorCode.STORE_DISABLED), { status: 409 });
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
        playerError(PlayerErrorCode.RATE_LIMITED),
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
        return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 422 });
      }
      if (error.code === "item_not_found") {
        return NextResponse.json(playerError(PlayerErrorCode.ITEM_NOT_FOUND), { status: 404 });
      }
      if (error.code === "type_mismatch") {
        return NextResponse.json(playerError(PlayerErrorCode.EQUIP_SLOT_INVALID), { status: 409 });
      }
      if (error.code === "not_owned") {
        return NextResponse.json(playerError(PlayerErrorCode.ITEM_NOT_OWNED), { status: 409 });
      }
    }
    return NextResponse.json(playerError(PlayerErrorCode.EQUIP_FAILED), { status: 500 });
  }
}
