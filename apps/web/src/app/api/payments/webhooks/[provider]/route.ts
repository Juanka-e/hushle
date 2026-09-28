import { NextResponse } from "next/server";
import {
    PAYMENT_PROVIDER_IDS,
    PaymentWebhookError,
    getPaymentWebhookVerifier,
    ingestVerifiedPaymentWebhook,
    type PaymentProviderId,
} from "@hushle/platform-payments";
import {
    getOrCreateRequestId,
    reportError,
} from "@hushle/platform-observability";

export const runtime = "nodejs";

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

class WebhookBodyTooLargeError extends Error {}

function getMaxBodyBytes(): number {
    const parsed = Number.parseInt(process.env.PAYMENT_WEBHOOK_MAX_BODY_BYTES ?? "", 10);
    return Number.isInteger(parsed) && parsed >= 1_024 && parsed <= 1_048_576
        ? parsed
        : DEFAULT_MAX_BODY_BYTES;
}

function collectVerifierHeaders(headers: Headers): Record<string, string> {
    const collected: Record<string, string> = {};
    let count = 0;
    for (const [name, value] of headers.entries()) {
        const normalized = name.toLowerCase();
        if (normalized === "cookie" || normalized === "authorization") continue;
        if (name.length > 128 || value.length > 4_096 || count >= 64) continue;
        collected[normalized] = value;
        count += 1;
    }
    return collected;
}

async function readBoundedRawBody(
    request: Request,
    maxBodyBytes: number
): Promise<Uint8Array> {
    if (!request.body) return new Uint8Array();
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBodyBytes) {
                await reader.cancel();
                throw new WebhookBodyTooLargeError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

export async function POST(
    request: Request,
    context: { params: Promise<{ provider: string }> }
) {
    const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
    const respond = (response: NextResponse) => {
        response.headers.set("x-request-id", requestId);
        response.headers.set("cache-control", "no-store");
        return response;
    };
    const { provider: providerValue } = await context.params;
    if (!PAYMENT_PROVIDER_IDS.includes(providerValue as PaymentProviderId)) {
        return respond(NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 }));
    }
    const provider = providerValue as PaymentProviderId;
    const verifier = getPaymentWebhookVerifier(provider);
    if (!verifier) {
        return respond(NextResponse.json({ error: "Webhook endpoint not found." }, { status: 404 }));
    }

    const maxBodyBytes = getMaxBodyBytes();
    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
        return respond(NextResponse.json({ error: "Payload too large." }, { status: 413 }));
    }

    let rawBody: Uint8Array;
    try {
        rawBody = await readBoundedRawBody(request, maxBodyBytes);
    } catch (error) {
        if (error instanceof WebhookBodyTooLargeError) {
            return respond(NextResponse.json({ error: "Payload too large." }, { status: 413 }));
        }
        throw error;
    }
    if (rawBody.byteLength === 0) {
        return respond(NextResponse.json({ error: "Invalid webhook." }, { status: 400 }));
    }
    try {
        await ingestVerifiedPaymentWebhook({
            provider,
            rawBody,
            headers: collectVerifierHeaders(request.headers),
            verifier,
        });
        return respond(new NextResponse(verifier.acknowledgement.body, {
            status: verifier.acknowledgement.status,
            headers: {
                "content-type": verifier.acknowledgement.contentType,
                "cache-control": "no-store",
            },
        }));
    } catch (error) {
        if (error instanceof PaymentWebhookError) {
            return respond(NextResponse.json({ error: "Invalid webhook." }, { status: 400 }));
        }
        await reportError({
            service: "hushle-web",
            event: "payment.webhook.ingest_failed",
            error,
            requestId,
            context: { provider },
        });
        return respond(NextResponse.json({ error: "Webhook temporarily unavailable." }, { status: 500 }));
    }
}
