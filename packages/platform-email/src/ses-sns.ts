import { createVerify } from "node:crypto";

const SNS_CERTIFICATE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const SNS_CERTIFICATE_FETCH_TIMEOUT_MS = 4_000;
const SNS_CERTIFICATE_MAX_BYTES = 32 * 1_024;
const SNS_CERTIFICATE_CACHE_LIMIT = 8;
const SNS_TOPIC_ARN_PATTERN = /^arn:(aws|aws-us-gov|aws-cn):sns:([a-z0-9-]{3,32}):(\d{12}):([A-Za-z0-9_-]{1,256})$/;
const SES_SOURCE_ARN_PATTERN = /^arn:(aws|aws-us-gov|aws-cn):ses:([a-z0-9-]{3,32}):(\d{12}):identity\/[A-Za-z0-9._%+@=-]{1,191}$/;
const SNS_CERTIFICATE_PATH_PATTERN = /^\/SimpleNotificationService-[A-Za-z0-9_-]{1,128}\.pem$/;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SnsMessageType = "Notification" | "SubscriptionConfirmation";

interface SnsEnvelope {
    Type: SnsMessageType;
    MessageId: string;
    TopicArn: string;
    Message: string;
    Timestamp: string;
    SignatureVersion: "1" | "2";
    Signature: string;
    SigningCertURL: string;
    Subject?: string;
    SubscribeURL?: string;
    Token?: string;
}

export interface SesFeedbackEnvironment {
    SES_FEEDBACK_WEBHOOK_ENABLED?: string;
    SES_SNS_TOPIC_ARNS?: string;
    SES_ALLOWED_SOURCE_ARNS?: string;
    SES_SNS_AUTO_CONFIRM?: string;
}

export interface SesFeedbackConfig {
    enabled: boolean;
    topicArns: ReadonlySet<string>;
    sourceArns: ReadonlySet<string>;
    autoConfirm: boolean;
}

export interface NormalizedSesFeedbackEvent {
    providerEventId: string;
    type: "delivered" | "hard_bounce" | "complaint";
    recipient: string;
    providerMessageId: string;
    occurredAt: Date;
}

export type VerifiedSesSnsMessage =
    | {
        kind: "notification";
        snsMessageId: string;
        topicArn: string;
        events: NormalizedSesFeedbackEvent[];
        ignoredReason:
            | "transient_bounce"
            | "not_spam_complaint"
            | "multi_recipient_message"
            | "unsupported_event"
            | null;
    }
    | {
        kind: "subscription_confirmation";
        snsMessageId: string;
        topicArn: string;
        subscribeUrl: string;
    };

export class SesSnsWebhookError extends Error {
    constructor(
        public readonly code:
            | "invalid_envelope"
            | "topic_not_allowed"
            | "invalid_certificate_url"
            | "certificate_unavailable"
            | "invalid_signature"
            | "invalid_ses_event",
        message: string
    ) {
        super(message);
        this.name = "SesSnsWebhookError";
    }
}

interface CachedCertificate {
    pem: string;
    expiresAt: number;
}

const certificateCache = new Map<string, CachedCertificate>();
const certificateRequests = new Map<string, Promise<string>>();

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error("response is too large");
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
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function isTruthy(value: string | undefined): boolean {
    return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export function parseSesFeedbackConfig(
    env: SesFeedbackEnvironment = process.env as SesFeedbackEnvironment
): SesFeedbackConfig {
    const topicArns = new Set(
        (env.SES_SNS_TOPIC_ARNS ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
    );
    const sourceArns = new Set(
        (env.SES_ALLOWED_SOURCE_ARNS ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
    );
    return {
        enabled: isTruthy(env.SES_FEEDBACK_WEBHOOK_ENABLED),
        topicArns,
        sourceArns,
        autoConfirm: isTruthy(env.SES_SNS_AUTO_CONFIRM),
    };
}

export function isValidSnsTopicArn(value: string): boolean {
    return SNS_TOPIC_ARN_PATTERN.test(value);
}

export function isValidSesSourceArn(value: string): boolean {
    return SES_SOURCE_ARN_PATTERN.test(value);
}

function readRequiredString(
    value: unknown,
    field: string,
    maxLength: number
): string {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
        throw new SesSnsWebhookError("invalid_envelope", `Invalid SNS ${field}`);
    }
    return value;
}

function parseEnvelope(rawBody: string): SnsEnvelope {
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        throw new SesSnsWebhookError("invalid_envelope", "SNS body is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SesSnsWebhookError("invalid_envelope", "SNS envelope is invalid");
    }
    const value = parsed as Record<string, unknown>;
    const type = readRequiredString(value.Type, "Type", 32);
    if (type !== "Notification" && type !== "SubscriptionConfirmation") {
        throw new SesSnsWebhookError("invalid_envelope", "SNS message type is unsupported");
    }
    const signatureVersion = readRequiredString(value.SignatureVersion, "SignatureVersion", 4);
    if (signatureVersion !== "1" && signatureVersion !== "2") {
        throw new SesSnsWebhookError("invalid_envelope", "SNS signature version is unsupported");
    }

    const envelope: SnsEnvelope = {
        Type: type,
        MessageId: readRequiredString(value.MessageId, "MessageId", 128),
        TopicArn: readRequiredString(value.TopicArn, "TopicArn", 512),
        Message: readRequiredString(value.Message, "Message", 128 * 1_024),
        Timestamp: readRequiredString(value.Timestamp, "Timestamp", 64),
        SignatureVersion: signatureVersion,
        Signature: readRequiredString(value.Signature, "Signature", 2_048),
        SigningCertURL: readRequiredString(value.SigningCertURL, "SigningCertURL", 1_024),
    };
    if (value.Subject !== undefined) {
        envelope.Subject = readRequiredString(value.Subject, "Subject", 1_024);
    }
    if (type === "SubscriptionConfirmation") {
        envelope.SubscribeURL = readRequiredString(value.SubscribeURL, "SubscribeURL", 4_096);
        envelope.Token = readRequiredString(value.Token, "Token", 4_096);
    }
    if (Number.isNaN(Date.parse(envelope.Timestamp))) {
        throw new SesSnsWebhookError("invalid_envelope", "SNS timestamp is invalid");
    }
    return envelope;
}

function parseTopicArn(topicArn: string) {
    const match = SNS_TOPIC_ARN_PATTERN.exec(topicArn);
    if (!match) {
        throw new SesSnsWebhookError("invalid_envelope", "SNS topic ARN is invalid");
    }
    return { partition: match[1], region: match[2] };
}

function readSesSourceIdentity(message: string): {
    sourceArn: string;
    partition: string;
    region: string;
} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(message);
    } catch {
        throw new SesSnsWebhookError("invalid_ses_event", "SES message is not valid JSON");
    }
    const mail = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).mail
        : null;
    const sourceArn = mail && typeof mail === "object" && !Array.isArray(mail)
        ? (mail as Record<string, unknown>).sourceArn
        : null;
    if (typeof sourceArn !== "string") {
        throw new SesSnsWebhookError("invalid_ses_event", "SES source identity is invalid");
    }
    const match = SES_SOURCE_ARN_PATTERN.exec(sourceArn);
    if (!match) {
        throw new SesSnsWebhookError("invalid_ses_event", "SES source identity is invalid");
    }
    return { sourceArn, partition: match[1], region: match[2] };
}

function expectedSnsHostname(partition: string, region: string): string {
    return partition === "aws-cn"
        ? `sns.${region}.amazonaws.com.cn`
        : `sns.${region}.amazonaws.com`;
}

function validateSnsUrl(rawUrl: string, topicArn: string, purpose: "certificate" | "subscribe"): URL {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new SesSnsWebhookError("invalid_certificate_url", `Invalid SNS ${purpose} URL`);
    }
    const topic = parseTopicArn(topicArn);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        url.hostname !== expectedSnsHostname(topic.partition, topic.region)
    ) {
        throw new SesSnsWebhookError("invalid_certificate_url", `Untrusted SNS ${purpose} URL`);
    }
    if (purpose === "certificate") {
        if (url.search || !SNS_CERTIFICATE_PATH_PATTERN.test(url.pathname)) {
            throw new SesSnsWebhookError("invalid_certificate_url", "Untrusted SNS certificate path");
        }
    } else {
        if (url.pathname !== "/" || url.searchParams.get("Action") !== "ConfirmSubscription") {
            throw new SesSnsWebhookError("invalid_certificate_url", "Invalid SNS subscription URL");
        }
        if (url.searchParams.get("TopicArn") !== topicArn || !url.searchParams.get("Token")) {
            throw new SesSnsWebhookError("invalid_certificate_url", "SNS subscription identity mismatch");
        }
    }
    return url;
}

export function buildSnsStringToSign(envelope: Pick<
    SnsEnvelope,
    "Type" | "Message" | "MessageId" | "Subject" | "SubscribeURL" | "Timestamp" | "Token" | "TopicArn"
>): string {
    const fields: Array<keyof typeof envelope> = envelope.Type === "Notification"
        ? ["Message", "MessageId", ...(envelope.Subject === undefined ? [] : ["Subject"] as const), "Timestamp", "TopicArn", "Type"]
        : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
    return fields.map((field) => `${field}\n${envelope[field]}`).join("\n");
}

async function fetchCertificate(url: URL): Promise<string> {
    const cached = certificateCache.get(url.href);
    if (cached && cached.expiresAt > Date.now()) return cached.pem;
    certificateCache.delete(url.href);

    const existing = certificateRequests.get(url.href);
    if (existing) return existing;

    const request = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SNS_CERTIFICATE_FETCH_TIMEOUT_MS);
        timeout.unref?.();
        try {
            const response = await fetch(url, {
                method: "GET",
                redirect: "error",
                signal: controller.signal,
                headers: { accept: "application/x-pem-file,text/plain" },
            });
            if (!response.ok) throw new Error(`certificate HTTP ${response.status}`);
            const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
            if (Number.isFinite(contentLength) && contentLength > SNS_CERTIFICATE_MAX_BYTES) {
                throw new Error("certificate is too large");
            }
            const pem = await readBoundedResponseText(response, SNS_CERTIFICATE_MAX_BYTES);
            if (!pem.includes("BEGIN CERTIFICATE") && !pem.includes("BEGIN PUBLIC KEY")) {
                throw new Error("certificate payload is invalid");
            }
            if (certificateCache.size >= SNS_CERTIFICATE_CACHE_LIMIT) {
                certificateCache.delete(certificateCache.keys().next().value as string);
            }
            certificateCache.set(url.href, {
                pem,
                expiresAt: Date.now() + SNS_CERTIFICATE_CACHE_TTL_MS,
            });
            return pem;
        } catch (error) {
            throw new SesSnsWebhookError(
                "certificate_unavailable",
                error instanceof Error ? error.message : "SNS certificate unavailable"
            );
        } finally {
            clearTimeout(timeout);
            certificateRequests.delete(url.href);
        }
    })();
    certificateRequests.set(url.href, request);
    return request;
}

function normalizeRecipient(value: unknown): string {
    if (typeof value !== "string") {
        throw new SesSnsWebhookError("invalid_ses_event", "SES recipient is invalid");
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 191 || !EMAIL_ADDRESS_PATTERN.test(normalized)) {
        throw new SesSnsWebhookError("invalid_ses_event", "SES recipient is invalid");
    }
    return normalized;
}

function parseDate(value: unknown, fallback: string): Date {
    const parsed = new Date(typeof value === "string" ? value : fallback);
    if (Number.isNaN(parsed.getTime())) {
        throw new SesSnsWebhookError("invalid_ses_event", "SES event timestamp is invalid");
    }
    return parsed;
}

function recipientList(value: unknown, key: string): string[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
        throw new SesSnsWebhookError("invalid_ses_event", "SES recipient list is invalid");
    }
    return value.map((entry) => {
        if (key === "direct") return normalizeRecipient(entry);
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new SesSnsWebhookError("invalid_ses_event", "SES recipient entry is invalid");
        }
        return normalizeRecipient((entry as Record<string, unknown>)[key]);
    });
}

function normalizeSesEvents(envelope: SnsEnvelope): Pick<
    Extract<VerifiedSesSnsMessage, { kind: "notification" }>,
    "events" | "ignoredReason"
> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(envelope.Message);
    } catch {
        throw new SesSnsWebhookError("invalid_ses_event", "SES message is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SesSnsWebhookError("invalid_ses_event", "SES message is invalid");
    }
    const value = parsed as Record<string, unknown>;
    const eventType = value.eventType ?? value.notificationType;
    const mail = value.mail;
    if (!mail || typeof mail !== "object" || Array.isArray(mail)) {
        throw new SesSnsWebhookError("invalid_ses_event", "SES mail identity is invalid");
    }
    const providerMessageId = readRequiredString(
        (mail as Record<string, unknown>).messageId,
        "mail.messageId",
        191
    );
    readRequiredString(
        (mail as Record<string, unknown>).sourceArn,
        "mail.sourceArn",
        512
    );
    const destinations = recipientList(
        (mail as Record<string, unknown>).destination,
        "direct"
    );
    if (destinations.length !== 1) {
        return { events: [], ignoredReason: "multi_recipient_message" };
    }

    let type: NormalizedSesFeedbackEvent["type"];
    let recipients: string[];
    let occurredAt: Date;
    if (eventType === "Bounce") {
        const bounce = value.bounce;
        if (!bounce || typeof bounce !== "object" || Array.isArray(bounce)) {
            throw new SesSnsWebhookError("invalid_ses_event", "SES bounce is invalid");
        }
        const bounceValue = bounce as Record<string, unknown>;
        if (bounceValue.bounceType !== "Permanent") {
            return { events: [], ignoredReason: "transient_bounce" };
        }
        type = "hard_bounce";
        recipients = recipientList(bounceValue.bouncedRecipients, "emailAddress");
        occurredAt = parseDate(bounceValue.timestamp, envelope.Timestamp);
    } else if (eventType === "Complaint") {
        const complaint = value.complaint;
        if (!complaint || typeof complaint !== "object" || Array.isArray(complaint)) {
            throw new SesSnsWebhookError("invalid_ses_event", "SES complaint is invalid");
        }
        const complaintValue = complaint as Record<string, unknown>;
        if (complaintValue.complaintFeedbackType === "not-spam") {
            return { events: [], ignoredReason: "not_spam_complaint" };
        }
        type = "complaint";
        recipients = recipientList(complaintValue.complainedRecipients, "emailAddress");
        occurredAt = parseDate(complaintValue.timestamp, envelope.Timestamp);
    } else if (eventType === "Delivery") {
        const delivery = value.delivery;
        if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
            throw new SesSnsWebhookError("invalid_ses_event", "SES delivery is invalid");
        }
        const deliveryValue = delivery as Record<string, unknown>;
        type = "delivered";
        recipients = recipientList(deliveryValue.recipients, "direct");
        occurredAt = parseDate(deliveryValue.timestamp, envelope.Timestamp);
    } else {
        return { events: [], ignoredReason: "unsupported_event" };
    }
    if (recipients.some((recipient) => recipient !== destinations[0])) {
        throw new SesSnsWebhookError("invalid_ses_event", "SES recipient does not match destination");
    }

    return {
        events: recipients.map((recipient, index) => ({
            providerEventId: `${envelope.MessageId}:${index}`,
            type,
            recipient,
            providerMessageId,
            occurredAt,
        })),
        ignoredReason: null,
    };
}

export async function verifyAndNormalizeSesSnsMessage(input: {
    rawBody: string;
    headerMessageType: string | null;
    headerMessageId?: string | null;
    headerTopicArn?: string | null;
    allowedTopicArns: ReadonlySet<string>;
    allowedSourceArns: ReadonlySet<string>;
    certificateLoader?: (url: URL) => Promise<string>;
}): Promise<VerifiedSesSnsMessage> {
    const envelope = parseEnvelope(input.rawBody);
    if (input.headerMessageType !== envelope.Type) {
        throw new SesSnsWebhookError("invalid_envelope", "SNS message type header mismatch");
    }
    if (
        (input.headerMessageId !== undefined && input.headerMessageId !== envelope.MessageId) ||
        (input.headerTopicArn !== undefined && input.headerTopicArn !== envelope.TopicArn)
    ) {
        throw new SesSnsWebhookError("invalid_envelope", "SNS identity header mismatch");
    }
    if (!input.allowedTopicArns.has(envelope.TopicArn)) {
        throw new SesSnsWebhookError("topic_not_allowed", "SNS topic is not allowed");
    }
    if (envelope.Type === "Notification") {
        const source = readSesSourceIdentity(envelope.Message);
        const topic = parseTopicArn(envelope.TopicArn);
        if (
            !input.allowedSourceArns.has(source.sourceArn) ||
            source.partition !== topic.partition ||
            source.region !== topic.region
        ) {
            throw new SesSnsWebhookError("topic_not_allowed", "SES source identity is not allowed");
        }
    }
    const certificateUrl = validateSnsUrl(envelope.SigningCertURL, envelope.TopicArn, "certificate");
    const certificate = await (input.certificateLoader ?? fetchCertificate)(certificateUrl);
    let valid = false;
    try {
        const verifier = createVerify(envelope.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
        verifier.update(buildSnsStringToSign(envelope), "utf8");
        verifier.end();
        valid = verifier.verify(certificate, Buffer.from(envelope.Signature, "base64"));
    } catch {
        valid = false;
    }
    if (!valid) {
        throw new SesSnsWebhookError("invalid_signature", "SNS signature is invalid");
    }

    if (envelope.Type === "SubscriptionConfirmation") {
        const subscribeUrl = validateSnsUrl(envelope.SubscribeURL!, envelope.TopicArn, "subscribe");
        if (subscribeUrl.searchParams.get("Token") !== envelope.Token) {
            throw new SesSnsWebhookError("invalid_envelope", "SNS subscription token mismatch");
        }
        return {
            kind: "subscription_confirmation",
            snsMessageId: envelope.MessageId,
            topicArn: envelope.TopicArn,
            subscribeUrl: subscribeUrl.href,
        };
    }

    const normalized = normalizeSesEvents(envelope);
    return {
        kind: "notification",
        snsMessageId: envelope.MessageId,
        topicArn: envelope.TopicArn,
        ...normalized,
    };
}

export async function confirmSesSnsSubscription(
    subscribeUrl: string,
    topicArn: string
): Promise<void> {
    const validatedUrl = validateSnsUrl(subscribeUrl, topicArn, "subscribe");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SNS_CERTIFICATE_FETCH_TIMEOUT_MS);
    timeout.unref?.();
    try {
        const response = await fetch(validatedUrl, {
            method: "GET",
            redirect: "error",
            signal: controller.signal,
            headers: { accept: "application/xml,text/xml" },
        });
        if (!response.ok) throw new Error(`SNS confirmation HTTP ${response.status}`);
        await readBoundedResponseText(response, SNS_CERTIFICATE_MAX_BYTES);
    } finally {
        clearTimeout(timeout);
    }
}

export function resetSesSnsCertificateCache(): void {
    certificateCache.clear();
    certificateRequests.clear();
}
