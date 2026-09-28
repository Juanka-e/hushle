import assert from "node:assert/strict";
import { UserAccountStatus } from "@hushle/platform-db";
import {
    canUseAccountCapability,
    isEmailVerificationRestrictionActive,
} from "@hushle/platform-auth";
import {
    getEmailProviderReadiness,
    hashEmailVerificationToken,
} from "@hushle/platform-email";
import {
    DEFAULT_SYSTEM_SETTINGS,
    normalizeSystemSettings,
    systemSettingsWriteSchema,
} from "../apps/web/src/lib/system-settings/schema";

const pendingAccount = {
    accountStatus: UserAccountStatus.pending_email_verification,
    emailVerifiedAt: null,
    emailVerificationRequiredAt: new Date("2026-07-31T00:00:00.000Z"),
};
assert.equal(isEmailVerificationRestrictionActive(pendingAccount), true);
assert.equal(canUseAccountCapability(pendingAccount, "session"), true);
assert.equal(canUseAccountCapability(pendingAccount, "email_verification"), true);
assert.equal(canUseAccountCapability(pendingAccount, "profile"), true);
assert.equal(canUseAccountCapability(pendingAccount, "room"), false);
assert.equal(canUseAccountCapability(pendingAccount, "store_mutation"), false);
assert.equal(canUseAccountCapability(pendingAccount, "reward"), false);

const legacyUnverifiedAccount = {
    accountStatus: UserAccountStatus.active,
    emailVerifiedAt: null,
    emailVerificationRequiredAt: null,
};
assert.equal(
    isEmailVerificationRestrictionActive(legacyUnverifiedAccount),
    false
);
assert.equal(canUseAccountCapability(legacyUnverifiedAccount, "room"), true);

const disabled = getEmailProviderReadiness({ EMAIL_PROVIDER: "disabled" });
assert.equal(disabled.configured, false);
assert.equal(disabled.provider, "disabled");

const ready = getEmailProviderReadiness({
    EMAIL_PROVIDER: "smtp",
    EMAIL_FROM: "Hushle <no-reply@example.test>",
    EMAIL_TOKEN_SECRET: "email_test_secret_with_at_least_32_chars",
    NEXT_PUBLIC_SITE_URL: "https://play.example.test",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
});
assert.deepEqual(ready, {
    provider: "smtp",
    configured: true,
    issues: [],
});
const incompleteCredentials = getEmailProviderReadiness({
    EMAIL_PROVIDER: "smtp",
    EMAIL_FROM: "Hushle <no-reply@example.test>",
    EMAIL_TOKEN_SECRET: "email_test_secret_with_at_least_32_chars",
    NEXT_PUBLIC_SITE_URL: "https://play.example.test",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "smtp-user",
});
assert.equal(incompleteCredentials.configured, false);
assert.match(incompleteCredentials.issues.join(" "), /configured together/);

const tokenHash = hashEmailVerificationToken("token-value");
assert.match(tokenHash, /^[a-f0-9]{64}$/);
assert.equal(tokenHash, hashEmailVerificationToken("token-value"));
assert.notEqual(tokenHash, hashEmailVerificationToken("different-token"));

const requiredSettings = normalizeSystemSettings({
    security: {
        emailVerification: {
            mode: "required_for_new_accounts",
        },
    },
});
assert.equal(
    requiredSettings.security.emailVerification.mode,
    "required_for_new_accounts"
);
assert.equal(systemSettingsWriteSchema.safeParse(requiredSettings).success, true);
assert.equal(
    DEFAULT_SYSTEM_SETTINGS.security.emailVerification.mode,
    "optional"
);

console.log("email verification foundation smoke test passed");
