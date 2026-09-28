import assert from "node:assert/strict";
import { getIntegrationHubSnapshot } from "../apps/web/src/lib/integrations/service";
import { normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";

async function main(): Promise<void> {
    process.env.DATABASE_URL = "mysql://root:@localhost:3306/tabu2";
    process.env.AUTH_SECRET = "this_is_a_long_enough_auth_secret_value_123456";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    process.env.TURNSTILE_SITE_KEY = "site";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    process.env.RECAPTCHA_SITE_KEY = "";
    process.env.RECAPTCHA_SECRET_KEY = "";
    process.env.ADMIN_ACCESS_MODE = "restricted_login";
    process.env.ADMIN_ACCESS_FAIL_CLOSED = "true";
    process.env.ADMIN_ACCESS_ALLOW_LOCAL_DEV_BYPASS = "false";
    process.env.ADMIN_ACCESS_HEADER_NAME = "x-admin-access";
    process.env.ADMIN_ACCESS_HEADER_VALUE = "approved";
    process.env.ADMIN_ACCESS_EMAIL_HEADER_NAME = "";
    process.env.ADMIN_ACCESS_ALLOWED_EMAILS = "";
    process.env.ADMIN_ACCESS_ALLOWED_EMAIL_DOMAINS = "";
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.EMAIL_FROM = "Hushle <no-reply@example.test>";
    process.env.EMAIL_TOKEN_SECRET =
        "integration_test_email_token_secret_123456";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";
    process.env.PRODUCTION_EMAIL_FEEDBACK_POLICY = "ses_sns";
    process.env.SES_FEEDBACK_WEBHOOK_ENABLED = "true";
    process.env.SES_SNS_TOPIC_ARNS = "arn:aws:sns:eu-central-1:123456789012:hushle-ses-feedback";
    process.env.SES_ALLOWED_SOURCE_ARNS = "arn:aws:ses:eu-central-1:123456789012:identity/hushle.example";
    process.env.SES_SNS_AUTO_CONFIRM = "false";
    process.env.PAYMENTS_ENABLED = "false";
    process.env.PAYMENT_ACTIVE_PROVIDER = "";

    const settings = normalizeSystemSettings({
        security: {
            captcha: {
                enabled: true,
                provider: "turnstile",
                onRegister: true,
                onGuestJoin: false,
                onRoomCreate: true,
                onLogin: true,
                failMode: "hard_fail",
                turnstileMode: "invisible",
                recaptchaScoreThreshold: 0.5,
                turnstileInteractiveFallback: true,
            },
        },
    });

    const snapshot = await getIntegrationHubSnapshot({ settings });

    const turnstile = snapshot.items.find((item) => item.id === "turnstile");
    const adminAccess = snapshot.items.find((item) => item.id === "admin-access-gateway");
    const emailOutbound = snapshot.items.find((item) => item.id === "email-outbound");
    const emailFeedback = snapshot.items.find((item) => item.id === "email-feedback");
    const redis = snapshot.items.find((item) => item.id === "redis-valkey");
    const paymentGate = snapshot.items.find((item) => item.id === "payment-checkout-gate");
    const paymentProviders = snapshot.items.filter(
        (item) => item.id.startsWith("payment-")
            && !["payment-checkout-gate", "payment-legal-gate"].includes(item.id)
    );

    assert.ok(turnstile);
    assert.equal(turnstile.status, "ready");

    assert.ok(adminAccess);
    assert.equal(adminAccess.status, "ready");

    assert.ok(emailOutbound);
    assert.equal(emailOutbound.status, "ready");

    assert.ok(emailFeedback);
    assert.equal(emailFeedback.status, "ready");
    assert.equal(emailFeedback.details.some((detail) => detail.includes("123456789012")), false);

    assert.ok(redis);
    assert.equal(redis.status, "planned");

    assert.ok(paymentGate);
    assert.equal(paymentGate.status, "planned");
    assert.equal(paymentProviders.length, 5);
    assert.equal(paymentProviders.every((item) => item.category === "commerce"), true);

    console.log("integration hub smoke test passed");
}

void main();
