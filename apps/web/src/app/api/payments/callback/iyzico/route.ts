import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
    IyzicoCheckoutError,
    verifyIyzicoSandboxCheckoutResult,
} from "@hushle/platform-payments";
import {
    buildOwnerCheckoutRedirect,
    getIyzicoOwnerSurfaceReadiness,
    getPublicPaymentOrigin,
} from "@/lib/payments/iyzico-owner-surface";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
} from "@/lib/security/request-rate-limit";

const MAX_BODY_BYTES = 4 * 1024;
const callbackQuerySchema = z.object({ order: z.string().uuid() });
const tokenSchema = z.string().min(1).max(191).regex(/^[A-Za-z0-9._~+/=-]+$/);

async function readBoundedForm(request: Request): Promise<URLSearchParams> {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") throw new Error("invalid_content_type");
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("body_too_large");
    if (!request.body) throw new Error("body_missing");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
            await reader.cancel();
            throw new Error("body_too_large");
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function genericError(status: number): NextResponse {
    return new NextResponse("Payment callback could not be processed.", {
        status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
}

export async function POST(request: Request) {
    const readiness = getIyzicoOwnerSurfaceReadiness();
    if (!readiness.callbackEnabled) return genericError(404);
    const origin = getPublicPaymentOrigin();
    if (!origin) return genericError(503);

    const url = new URL(request.url);
    const query = callbackQuerySchema.safeParse({ order: url.searchParams.get("order") });
    if (!query.success) return genericError(400);

    let token: string;
    try {
        const form = await readBoundedForm(request);
        if ([...form.keys()].some((key) => key !== "token") || form.getAll("token").length !== 1) {
            return genericError(400);
        }
        token = tokenSchema.parse(form.get("token"));
    } catch {
        return genericError(400);
    }

    const [tokenLimit, orderLimit] = await Promise.all([
        consumeDistributedRequestRateLimit({
            bucket: "payment-iyzico-callback-token",
            key: createHash("sha256").update(token).digest("hex"),
            windowMs: 5 * 60_000,
            maxRequests: 10,
        }),
        consumeDistributedRequestRateLimit({
            bucket: "payment-iyzico-callback-order",
            key: query.data.order,
            windowMs: 5 * 60_000,
            maxRequests: 20,
        }),
    ]);
    const limit = tokenLimit.allowed ? orderLimit : tokenLimit;
    if (!tokenLimit.allowed || !orderLimit.allowed) {
        return new NextResponse("Payment callback rate limit exceeded.", {
            status: 429,
            headers: {
                ...buildRateLimitHeaders(limit),
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
            },
        });
    }

    let result: "provider-return" | "provider-review" = "provider-return";
    try {
        await verifyIyzicoSandboxCheckoutResult({
            orderId: query.data.order,
            token,
            credentials: {
                apiKey: process.env.IYZICO_API_KEY ?? "",
                secretKey: process.env.IYZICO_SECRET_KEY ?? "",
            },
        });
    } catch (error) {
        if (
            error instanceof IyzicoCheckoutError
            && (error.code === "order_not_found" || error.code === "order_not_eligible" || error.code === "invalid_request")
        ) {
            return genericError(400);
        }
        result = "provider-review";
    }

    const response = NextResponse.redirect(
        buildOwnerCheckoutRedirect(origin, query.data.order, result),
        303
    );
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
}
