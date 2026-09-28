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
import {
  getFeatureDisabledMessage,
  isStoreAvailable,
} from "@/lib/system-settings/policies";
import { recordProductAnalyticsEvent } from "@/lib/analytics/product-events";

const purchaseSchema = z.object({
  shopItemId: z.number().int().positive(),
  couponCode: z.string().trim().min(1).max(80).optional(),
});

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
    const rateLimit = await consumeDistributedRequestRateLimit({
      bucket: "store-item-purchase",
      key: `user:${sessionUser.id}:${getRequestIp(req)}`,
      windowMs: 5 * 60_000,
      maxRequests: 25,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Cok fazla satin alma denemesi yaptin. Biraz bekleyip tekrar dene." },
        { status: 429, headers: buildRateLimitHeaders(rateLimit) }
      );
    }

    const body = await req.json();
    const { shopItemId, couponCode } = purchaseSchema.parse(body);

    const result = await purchaseStoreItem(sessionUser.id, shopItemId, couponCode, settings);
    if (!result.ok) {
      if (result.code === "not_found") {
        return NextResponse.json({ error: "Urun bulunamadi." }, { status: 404 });
      }
      if (result.code === "already_owned") {
        return NextResponse.json({ error: "Urun zaten sahiplenilmis." }, { status: 409 });
      }
      if (result.code === "coupon_disabled") {
        return NextResponse.json({ error: "Kupon kullanimi su anda gecici olarak kapali." }, { status: 409 });
      }
      if (result.code === "invalid_coupon") {
        return NextResponse.json({ error: "Kupon gecersiz veya bu urun ile kullanilamaz." }, { status: 409 });
      }
      if (result.code === "promotion_unavailable") {
        return NextResponse.json({ error: "Indirim kampanyasi limiti doldu. Fiyatlari yenileyip tekrar dene." }, { status: 409 });
      }
      return NextResponse.json({ error: "Yetersiz coin." }, { status: 409 });
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
      return NextResponse.json({ error: error.issues[0]?.message || "Gecersiz veri." }, { status: 422 });
    }
    return NextResponse.json({ error: "Satin alma basarisiz." }, { status: 500 });
  }
}
