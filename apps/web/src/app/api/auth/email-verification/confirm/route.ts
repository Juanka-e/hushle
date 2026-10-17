import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmEmailVerification } from "@hushle/platform-email";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { isTrustedStateChangeRequest } from "@/lib/security/request-origin";
import { processGuestClaimsForUser } from "@/lib/match-settlement/guest-claim";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

const confirmSchema = z.object({
    token: z.string().trim().min(40).max(160),
});

export async function POST(request: Request) {
    if (!isTrustedStateChangeRequest(request)) {
        return NextResponse.json(playerError(PlayerErrorCode.ORIGIN_REJECTED), { status: 403 });
    }
    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "email-verification-confirm",
        key: `ip:${getRequestIp(request)}`,
        windowMs: 10 * 60_000,
        maxRequests: 20,
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

    try {
        const input = confirmSchema.parse(await request.json());
        const result = await confirmEmailVerification({
            token: input.token,
        });
        if (!result.ok) {
            return NextResponse.json(
                playerError(PlayerErrorCode.VERIFICATION_LINK_INVALID),
                {
                    status: 400,
                    headers: buildRateLimitHeaders(rateLimit),
                }
            );
        }

        try {
            await writeAuditLog({
                actor: { id: result.userId, role: "user" },
                action: "user.email.verify",
                resourceType: "user",
                resourceId: result.userId,
                summary: "Verified account email address",
                metadata: {
                    verificationMethod: "email_link",
                },
                request,
            });
        } catch (error) {
            console.error("Email verification audit could not be written", error);
        }
        // Guest matches claimed at signup were waiting for this; the worker retries failures.
        try {
            await processGuestClaimsForUser(result.userId);
        } catch (error) {
            console.error("Guest match claims could not be settled after verification", error);
        }
        return NextResponse.json(
            { ok: true },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json(
                playerError(PlayerErrorCode.INVALID_REQUEST),
                {
                    status: 400,
                    headers: buildRateLimitHeaders(rateLimit),
                }
            );
        }
        return NextResponse.json(
            playerError(PlayerErrorCode.EMAIL_VERIFICATION_FAILED),
            {
                status: 500,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }
}
