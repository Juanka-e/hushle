import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import {
    buildSnsStringToSign,
    resetSesSnsCertificateCache,
} from "@hushle/platform-email";
import { resetRequestRateLimitBuckets } from "../apps/web/src/lib/security/request-rate-limit";

const topicArn = "arn:aws:sns:eu-central-1:123456789012:hushle-ses-feedback";
const sourceArn = "arn:aws:ses:eu-central-1:123456789012:identity/hushle.example";
const certificateUrl = "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-route-test.pem";

async function main() {
    process.env.REDIS_URL = "";
    process.env.TRUST_PROXY = "false";
    process.env.SES_FEEDBACK_WEBHOOK_ENABLED = "true";
    process.env.SES_SNS_TOPIC_ARNS = topicArn;
    process.env.SES_ALLOWED_SOURCE_ARNS = sourceArn;
    process.env.SES_SNS_AUTO_CONFIRM = "false";

    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const originalFetch = globalThis.fetch;
    let certificateFetches = 0;
    globalThis.fetch = async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        assert.equal(url, certificateUrl);
        certificateFetches += 1;
        return new Response(publicKeyPem, {
            status: 200,
            headers: { "content-type": "application/x-pem-file" },
        });
    };

    const createEnvelope = () => {
        const envelope = {
            Type: "Notification" as const,
            MessageId: randomUUID(),
            TopicArn: topicArn,
            Message: JSON.stringify({
                eventType: "Bounce",
                mail: {
                    messageId: "ses-route-message",
                    sourceArn,
                    destination: ["player@example.com"],
                },
                bounce: {
                    bounceType: "Transient",
                    timestamp: "2026-08-10T10:00:00.000Z",
                    bouncedRecipients: [{ emailAddress: "player@example.com" }],
                },
            }),
            Timestamp: "2026-08-10T10:00:00.000Z",
            SignatureVersion: "2" as const,
            Signature: "",
            SigningCertURL: certificateUrl,
        };
        const signer = createSign("RSA-SHA256");
        signer.update(buildSnsStringToSign(envelope), "utf8");
        signer.end();
        envelope.Signature = signer.sign(privateKey).toString("base64");
        return envelope;
    };

    const { POST } = await import("../apps/web/src/app/api/email/webhooks/ses/route");
    const envelope = createEnvelope();
    const makeRequest = (body = JSON.stringify(envelope), overrides: Record<string, string> = {}) =>
        new Request("http://localhost/api/email/webhooks/ses", {
            method: "POST",
            headers: {
                "content-type": "text/plain; charset=UTF-8",
                "x-amz-sns-message-type": envelope.Type,
                "x-amz-sns-message-id": envelope.MessageId,
                "x-amz-sns-topic-arn": envelope.TopicArn,
                ...overrides,
            },
            body,
        });

    try {
        const accepted = await POST(makeRequest());
        assert.equal(accepted.status, 200);
        assert.deepEqual(await accepted.json(), { accepted: true });
        assert.equal(certificateFetches, 1);

        const cached = await POST(makeRequest());
        assert.equal(cached.status, 200);
        assert.equal(certificateFetches, 1, "verified certificate should use bounded process cache");

        const headerMismatch = await POST(makeRequest(undefined, {
            "x-amz-sns-message-id": "different-message-id",
        }));
        assert.equal(headerMismatch.status, 400);

        const oversized = await POST(makeRequest("{}", {
            "content-length": String(193 * 1_024),
        }));
        assert.equal(oversized.status, 413);

        process.env.SES_FEEDBACK_WEBHOOK_ENABLED = "false";
        const disabled = await POST(makeRequest());
        assert.equal(disabled.status, 404);
    } finally {
        globalThis.fetch = originalFetch;
        resetSesSnsCertificateCache();
        resetRequestRateLimitBuckets();
    }

    console.log("SES feedback route checks passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
