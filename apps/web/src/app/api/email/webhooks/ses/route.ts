import { NextResponse } from "next/server";
import {
    SesSnsWebhookError,
    confirmSesSnsSubscription,
    parseSesFeedbackConfig,
    recordEmailDeliveryProviderEvent,
    verifyAndNormalizeSesSnsMessage,
} from "@hushle/platform-email";
import {
    emitObservabilityEvent,
    getOrCreateRequestId,
    reportError,
} from "@hushle/platform-observability";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 192 * 1_024;
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 600;

class BodyTooLargeError extends Error {}
class InvalidBodyEncodingError extends Error {}

function getMaxRequestsPerMinute(): number {
    const parsed = Number.parseInt(
        process.env.SES_FEEDBACK_WEBHOOK_RATE_LIMIT_PER_MINUTE ?? "",
        10
    );
    return Number.isInteger(parsed) && parsed >= 60 && parsed <= 10_000
        ? parsed
        : DEFAULT_MAX_REQUESTS_PER_MINUTE;
}

async function readBoundedBody(request: Request): Promise<string> {
    if (!request.body) return "";
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BODY_BYTES) {
                await reader.cancel();
                throw new BodyTooLargeError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
        throw new InvalidBodyEncodingError();
    }
}

export async function POST(request: Request) {
    const config = parseSesFeedbackConfig();
    if (!config.enabled) {
        return NextResponse.json({ error: "Endpoint not found." }, { status: 404 });
    }

    const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
    const respond = (body: unknown, status: number, headers?: Record<string, string>) =>
        NextResponse.json(body, {
            status,
            headers: {
                "cache-control": "no-store",
                "x-request-id": requestId,
                ...headers,
            },
        });
    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "ses-feedback-webhook",
        key: getRequestIp(request),
        windowMs: 60_000,
        maxRequests: getMaxRequestsPerMinute(),
    });
    if (!rateLimit.allowed) {
        return respond(
            { error: "Too many requests." },
            429,
            buildRateLimitHeaders(rateLimit)
        );
    }

    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return respond({ error: "Payload too large." }, 413);
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "text/plain" && contentType !== "application/json") {
        return respond({ error: "Unsupported content type." }, 415);
    }

    try {
        const rawBody = await readBoundedBody(request);
        if (!rawBody) return respond({ error: "Invalid webhook." }, 400);
        const verified = await verifyAndNormalizeSesSnsMessage({
            rawBody,
            headerMessageType: request.headers.get("x-amz-sns-message-type"),
            headerMessageId: request.headers.get("x-amz-sns-message-id"),
            headerTopicArn: request.headers.get("x-amz-sns-topic-arn"),
            allowedTopicArns: config.topicArns,
            allowedSourceArns: config.sourceArns,
        });

        if (verified.kind === "subscription_confirmation") {
            if (!config.autoConfirm) {
                await emitObservabilityEvent({
                    level: "warn",
                    service: "hushle-web",
                    event: "email.ses_subscription.pending_confirmation",
                    requestId,
                    context: { autoConfirm: false },
                });
                return respond({ accepted: true, confirmationPending: true }, 202);
            }
            await confirmSesSnsSubscription(verified.subscribeUrl, verified.topicArn);
            await emitObservabilityEvent({
                level: "info",
                service: "hushle-web",
                event: "email.ses_subscription.confirmed",
                requestId,
            });
            return respond({ accepted: true, confirmed: true }, 200);
        }

        let inserted = 0;
        let duplicates = 0;
        let suppressed = 0;
        for (const event of verified.events) {
            const result = await recordEmailDeliveryProviderEvent({
                provider: "ses",
                ...event,
            });
            if (result.duplicate) duplicates += 1;
            else inserted += 1;
            if (result.suppressed) suppressed += 1;
        }
        await emitObservabilityEvent({
            level: "info",
            service: "hushle-web",
            event: "email.ses_feedback.processed",
            requestId,
            context: {
                inserted,
                duplicates,
                suppressed,
                ignored: verified.ignoredReason ?? "none",
            },
        });
        return respond({ accepted: true }, 200);
    } catch (error) {
        if (error instanceof BodyTooLargeError) {
            return respond({ error: "Payload too large." }, 413);
        }
        if (error instanceof InvalidBodyEncodingError) {
            return respond({ error: "Invalid webhook." }, 400);
        }
        if (error instanceof SesSnsWebhookError) {
            if (error.code === "certificate_unavailable") {
                await reportError({
                    service: "hushle-web",
                    event: "email.ses_feedback.certificate_unavailable",
                    error,
                    requestId,
                });
                return respond({ error: "Webhook temporarily unavailable." }, 503);
            }
            await emitObservabilityEvent({
                level: "warn",
                service: "hushle-web",
                event: "email.ses_feedback.rejected",
                requestId,
                context: { reason: error.code },
            });
            return respond({ error: "Invalid webhook." }, 400);
        }
        await reportError({
            service: "hushle-web",
            event: "email.ses_feedback.processing_failed",
            error,
            requestId,
        });
        return respond({ error: "Webhook temporarily unavailable." }, 503);
    }
}
