import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { claimGuestMatches } from "@/lib/match-settlement/guest-claim";
import { summarizeGuestClaim } from "@/lib/match-settlement/guest-claim-rules";
import {
  buildRateLimitHeaders,
  consumeDistributedRequestRateLimit,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";

const claimSchema = z.object({
  guestToken: z.string().trim().min(20).max(512),
});

/**
 * Moves the matches a guest played in this browser tab to the signed-in account.
 * Accounts waiting for email verification keep the claim until they verify.
 */
export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
  }

  const rateLimit = await consumeDistributedRequestRateLimit({
    bucket: "match-guest-claim",
    // Per account, so rotating addresses does not buy extra attempts.
    key: `user:${sessionUser.id}`,
    windowMs: 10 * 60_000,
    maxRequests: 10,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Cok fazla deneme yaptin. Biraz bekleyip tekrar dene.", code: "RATE_LIMITED" },
      { status: 429, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  let guestToken: string;
  try {
    guestToken = claimSchema.parse(await req.json()).guestToken;
  } catch {
    return NextResponse.json(
      { error: "Gecersiz istek.", code: "GUEST_CLAIM_INVALID" },
      { status: 400 }
    );
  }

  try {
    const summary = summarizeGuestClaim(
      await claimGuestMatches({ userId: sessionUser.id, guestToken })
    );
    if (summary.status !== "invalid_token") {
      await writeAuditLog({
        actor: sessionUser,
        action: "game.match.guest_claim",
        resourceType: "match_guest_claim",
        resourceId: sessionUser.id,
        summary: `Guest match claim: ${summary.status}`,
        metadata: { ...summary },
        request: req,
      }).catch((error) => console.error("Guest claim audit could not be written", error));
    }

    if (summary.status === "invalid_token") {
      return NextResponse.json(
        { error: "Misafir oturumunun suresi dolmus.", code: "GUEST_CLAIM_INVALID" },
        { status: 400 }
      );
    }
    if (summary.status === "linked_elsewhere") {
      return NextResponse.json(
        {
          error: "Bu misafir maclari baska bir hesaba aktarilmis.",
          code: "GUEST_CLAIM_LINKED_ELSEWHERE",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(summary, { headers: buildRateLimitHeaders(rateLimit) });
  } catch (error) {
    console.error("Guest match claim failed", error);
    return NextResponse.json(
      { error: "Maclar su anda aktarilamadi. Lutfen tekrar dene." },
      { status: 500 }
    );
  }
}
