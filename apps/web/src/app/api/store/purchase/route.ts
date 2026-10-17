import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { enforceAccountCapability } from "@/lib/auth/account-capability";
import { purchaseStoreItem } from "@/lib/economy";
import {
  buildRateLimitHeaders,
  consumeDistributedRequestRateLimit,
  getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { getSystemSettings } from "@/lib/system-settings/service";
import { isStoreAvailable } from "@/lib/system-settings/policies";
import { recordProductAnalyticsEvent } from "@/lib/analytics/product-events";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

const purchaseSchema = z.object({
  shopItemId: z.number().int().positive(),
  couponCode: z.string().trim().min(1).max(80).optional(),
});

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
    const rateLimit = await consumeDistributedRequestRateLimit({
      bucket: "store-item-purchase",
      key: `user:${sessionUser.id}:${getRequestIp(req)}`,
      windowMs: 5 * 60_000,
      maxRequests: 25,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        playerError(PlayerErrorCode.RATE_LIMITED),
        { status: 429, headers: buildRateLimitHeaders(rateLimit) }
      );
    }

    const body = await req.json();
    const { shopItemId, couponCode } = purchaseSchema.parse(body);

    const result = await purchaseStoreItem(sessionUser.id, shopItemId, couponCode, settings);
    if (!result.ok) {
      if (result.code === "not_found") {
        return NextResponse.json(playerError(PlayerErrorCode.ITEM_NOT_FOUND), { status: 404 });
      }
      if (result.code === "already_owned") {
        return NextResponse.json(playerError(PlayerErrorCode.ITEM_ALREADY_OWNED), { status: 409 });
      }
      if (result.code === "coupon_disabled") {
        return NextResponse.json(playerError(PlayerErrorCode.COUPONS_DISABLED), { status: 409 });
      }
      if (result.code === "invalid_coupon") {
        return NextResponse.json(playerError(PlayerErrorCode.COUPON_INVALID_FOR_ITEM), { status: 409 });
      }
      if (result.code === "promotion_unavailable") {
        return NextResponse.json(playerError(PlayerErrorCode.PROMOTION_LIMIT_REACHED), { status: 409 });
      }
      return NextResponse.json(playerError(PlayerErrorCode.INSUFFICIENT_COINS), { status: 409 });
    }

    await writeAuditLog({
      actor: sessionUser,
      action: "store.purchase.item",
      resourceType: "shop_item",
      resourceId: result.item.id,
      summary: `Purchased shop item ${result.item.code}`,
      metadata: {
        code: result.item.code,
        finalPriceCoin: result.finalPriceCoin,
      },
      request: req,
    });
    await recordProductAnalyticsEvent({
      name: "store.item_purchased",
      version: 1,
      trust: "server_verified",
      occurredAt: new Date(),
      itemType: result.item.type,
      rarity: result.item.rarity,
      finalPriceCoin: result.finalPriceCoin,
      couponApplied: Boolean(couponCode),
    });

    return NextResponse.json({
      item: result.item,
      awardedItems: [result.item],
      coinBalance: result.coinBalance,
      finalPriceCoin: result.finalPriceCoin,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 422 });
    }
    return NextResponse.json(playerError(PlayerErrorCode.PURCHASE_FAILED), { status: 500 });
  }
}
