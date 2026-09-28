import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
    SesSnsWebhookError,
    buildSnsStringToSign,
    isValidSnsTopicArn,
    parseSesFeedbackConfig,
    verifyAndNormalizeSesSnsMessage,
} from "@hushle/platform-email";

const topicArn = "arn:aws:sns:eu-central-1:123456789012:hushle-ses-feedback";
const sourceArn = "arn:aws:ses:eu-central-1:123456789012:identity/hushle.example";
const certificateUrl = "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-test.pem";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

type MessageType = "Notification" | "SubscriptionConfirmation";

function createEnvelope(input: {
    message: Record<string, unknown> | string;
    type?: MessageType;
    signingCertUrl?: string;
    topic?: string;
}) {
    const type = input.type ?? "Notification";
    const envelope = {
        Type: type,
        MessageId: randomUUID(),
        TopicArn: input.topic ?? topicArn,
        Message: typeof input.message === "string" ? input.message : JSON.stringify(input.message),
        Timestamp: "2026-08-10T10:00:00.000Z",
        SignatureVersion: "2" as const,
        Signature: "",
        SigningCertURL: input.signingCertUrl ?? certificateUrl,
        ...(type === "SubscriptionConfirmation"
            ? {
                Token: "subscription-token",
                SubscribeURL: `https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(topicArn)}&Token=subscription-token`,
            }
            : {}),
    };
    const signer = createSign("RSA-SHA256");
    signer.update(buildSnsStringToSign(envelope), "utf8");
    signer.end();
    envelope.Signature = signer.sign(privateKey).toString("base64");
    return envelope;
}

async function verify(envelope: ReturnType<typeof createEnvelope>) {
    return verifyAndNormalizeSesSnsMessage({
        rawBody: JSON.stringify(envelope),
        headerMessageType: envelope.Type,
        headerMessageId: envelope.MessageId,
        headerTopicArn: envelope.TopicArn,
        allowedTopicArns: new Set([topicArn]),
        allowedSourceArns: new Set([sourceArn]),
        certificateLoader: async () => publicKeyPem,
    });
}

async function main() {
const permanentBounce = createEnvelope({
    message: {
        notificationType: "Bounce",
        mail: { messageId: "ses-message-1", sourceArn, destination: ["PLAYER@Example.COM"] },
        bounce: {
            bounceType: "Permanent",
            timestamp: "2026-08-10T09:59:00.000Z",
            bouncedRecipients: [{ emailAddress: "PLAYER@Example.COM" }],
        },
    },
});
const permanentResult = await verify(permanentBounce);
assert.equal(permanentResult.kind, "notification");
if (permanentResult.kind === "notification") {
    assert.equal(permanentResult.events.length, 1);
    assert.deepEqual(permanentResult.events[0], {
        providerEventId: `${permanentBounce.MessageId}:0`,
        type: "hard_bounce",
        recipient: "player@example.com",
        providerMessageId: "ses-message-1",
        occurredAt: new Date("2026-08-10T09:59:00.000Z"),
    });
}

const transientResult = await verify(createEnvelope({
    message: {
        eventType: "Bounce",
        mail: { messageId: "ses-message-2", sourceArn, destination: ["player@example.com"] },
        bounce: {
            bounceType: "Transient",
            timestamp: "2026-08-10T09:59:00.000Z",
            bouncedRecipients: [{ emailAddress: "player@example.com" }],
        },
    },
}));
assert.equal(transientResult.kind, "notification");
if (transientResult.kind === "notification") {
    assert.equal(transientResult.events.length, 0);
    assert.equal(transientResult.ignoredReason, "transient_bounce");
}

const complaintResult = await verify(createEnvelope({
    message: {
        eventType: "Complaint",
        mail: { messageId: "ses-message-3", sourceArn, destination: ["first@example.com"] },
        complaint: {
            timestamp: "2026-08-10T09:58:00.000Z",
            complainedRecipients: [{ emailAddress: "first@example.com" }],
        },
    },
}));
assert.equal(complaintResult.kind, "notification");
if (complaintResult.kind === "notification") {
    assert.equal(complaintResult.events.length, 1);
    assert.equal(complaintResult.events[0].type, "complaint");
}

const multiRecipientResult = await verify(createEnvelope({
    message: {
        eventType: "Complaint",
        mail: {
            messageId: "ses-message-multi",
            sourceArn,
            destination: ["first@example.com", "second@example.com"],
        },
        complaint: {
            timestamp: "2026-08-10T09:58:00.000Z",
            complainedRecipients: [
                { emailAddress: "first@example.com" },
                { emailAddress: "second@example.com" },
            ],
        },
    },
}));
assert.equal(multiRecipientResult.kind, "notification");
if (multiRecipientResult.kind === "notification") {
    assert.equal(multiRecipientResult.events.length, 0);
    assert.equal(multiRecipientResult.ignoredReason, "multi_recipient_message");
}

const notSpamResult = await verify(createEnvelope({
    message: {
        eventType: "Complaint",
        mail: { messageId: "ses-message-not-spam", sourceArn, destination: ["player@example.com"] },
        complaint: {
            timestamp: "2026-08-10T09:58:00.000Z",
            complaintFeedbackType: "not-spam",
            complainedRecipients: [{ emailAddress: "player@example.com" }],
        },
    },
}));
assert.equal(notSpamResult.kind, "notification");
if (notSpamResult.kind === "notification") {
    assert.equal(notSpamResult.events.length, 0);
    assert.equal(notSpamResult.ignoredReason, "not_spam_complaint");
}

const deliveryResult = await verify(createEnvelope({
    message: {
        eventType: "Delivery",
        mail: { messageId: "ses-message-4", sourceArn, destination: ["player@example.com"] },
        delivery: {
            timestamp: "2026-08-10T09:57:00.000Z",
            recipients: ["player@example.com"],
        },
    },
}));
assert.equal(deliveryResult.kind, "notification");
if (deliveryResult.kind === "notification") {
    assert.equal(deliveryResult.events[0].type, "delivered");
}

const subscription = createEnvelope({
    message: "You have chosen to subscribe.",
    type: "SubscriptionConfirmation",
});
const subscriptionResult = await verify(subscription);
assert.equal(subscriptionResult.kind, "subscription_confirmation");

const tampered = { ...permanentBounce, Message: `${permanentBounce.Message} ` };
await assert.rejects(
    () => verify(tampered),
    (error: unknown) => error instanceof SesSnsWebhookError && error.code === "invalid_signature"
);

await assert.rejects(
    () => verifyAndNormalizeSesSnsMessage({
        rawBody: JSON.stringify(permanentBounce),
        headerMessageType: "SubscriptionConfirmation",
        headerMessageId: permanentBounce.MessageId,
        headerTopicArn: permanentBounce.TopicArn,
        allowedTopicArns: new Set([topicArn]),
        allowedSourceArns: new Set([sourceArn]),
        certificateLoader: async () => publicKeyPem,
    }),
    (error: unknown) => error instanceof SesSnsWebhookError && error.code === "invalid_envelope"
);

await assert.rejects(
    () => verifyAndNormalizeSesSnsMessage({
        rawBody: JSON.stringify(permanentBounce),
        headerMessageType: "Notification",
        headerMessageId: "different-message-id",
        headerTopicArn: topicArn,
        allowedTopicArns: new Set([topicArn]),
        allowedSourceArns: new Set([sourceArn]),
        certificateLoader: async () => publicKeyPem,
    }),
    (error: unknown) => error instanceof SesSnsWebhookError && error.code === "invalid_envelope"
);

let loaderCalled = false;
const maliciousCertificate = createEnvelope({
    message: JSON.parse(permanentBounce.Message) as Record<string, unknown>,
    signingCertUrl: "https://127.0.0.1/latest/meta-data/SimpleNotificationService-test.pem",
});
await assert.rejects(
    () => verifyAndNormalizeSesSnsMessage({
        rawBody: JSON.stringify(maliciousCertificate),
        headerMessageType: "Notification",
        headerMessageId: maliciousCertificate.MessageId,
        headerTopicArn: maliciousCertificate.TopicArn,
        allowedTopicArns: new Set([topicArn]),
        allowedSourceArns: new Set([sourceArn]),
        certificateLoader: async () => {
            loaderCalled = true;
            return publicKeyPem;
        },
    }),
    (error: unknown) => error instanceof SesSnsWebhookError && error.code === "invalid_certificate_url"
);
assert.equal(loaderCalled, false, "SSRF URL must be rejected before certificate fetch");

let disallowedSourceLoaderCalled = false;
const disallowedSource = createEnvelope({
    message: {
        notificationType: "Bounce",
        mail: {
            messageId: "ses-message-disallowed-source",
            sourceArn: "arn:aws:ses:eu-central-1:123456789012:identity/other.example",
            destination: ["player@example.com"],
        },
        bounce: {
            bounceType: "Permanent",
            timestamp: "2026-08-10T09:59:00.000Z",
            bouncedRecipients: [{ emailAddress: "player@example.com" }],
        },
    },
});
await assert.rejects(
    () => verifyAndNormalizeSesSnsMessage({
        rawBody: JSON.stringify(disallowedSource),
        headerMessageType: "Notification",
        headerMessageId: disallowedSource.MessageId,
        headerTopicArn: disallowedSource.TopicArn,
        allowedTopicArns: new Set([topicArn]),
        allowedSourceArns: new Set([sourceArn]),
        certificateLoader: async () => {
            disallowedSourceLoaderCalled = true;
            return publicKeyPem;
        },
    }),
    (error: unknown) => error instanceof SesSnsWebhookError && error.code === "topic_not_allowed"
);
assert.equal(disallowedSourceLoaderCalled, false, "disallowed identity must fail before certificate fetch");

assert.equal(isValidSnsTopicArn(topicArn), true);
assert.equal(isValidSnsTopicArn("https://example.com/topic"), false);
assert.deepEqual(parseSesFeedbackConfig({
    SES_FEEDBACK_WEBHOOK_ENABLED: "true",
    SES_SNS_TOPIC_ARNS: `${topicArn}, arn:aws:sns:eu-west-1:123456789012:second`,
    SES_ALLOWED_SOURCE_ARNS: sourceArn,
    SES_SNS_AUTO_CONFIRM: "false",
}), {
    enabled: true,
    topicArns: new Set([topicArn, "arn:aws:sns:eu-west-1:123456789012:second"]),
    sourceArns: new Set([sourceArn]),
    autoConfirm: false,
});

const route = readFileSync("apps/web/src/app/api/email/webhooks/ses/route.ts", "utf8");
assert.match(route, /readBoundedBody/);
assert.match(route, /consumeDistributedRequestRateLimit/);
assert.match(route, /verifyAndNormalizeSesSnsMessage/);
assert.match(route, /recordEmailDeliveryProviderEvent/);
assert.doesNotMatch(route, /request\.json\(\)/);

console.log("SES feedback webhook checks passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
