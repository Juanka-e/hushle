import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDashboardData } from "@/lib/economy";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { recordUserAccessSignal } from "@/lib/security/user-access-signal";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
  }

  const rateLimit = consumeRequestRateLimit({
    bucket: "user-dashboard-read",
    key: `user:${sessionUser.id}:${getRequestIp(request)}`,
    windowMs: 60_000,
    maxRequests: 120,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      playerError(PlayerErrorCode.RATE_LIMITED),
      { status: 429, headers: buildRateLimitHeaders(rateLimit) }
    );
  }

  const data = await getDashboardData(sessionUser.id);
  await recordUserAccessSignal({ userId: sessionUser.id, request });
  return NextResponse.json(data, { headers: buildRateLimitHeaders(rateLimit) });
}
