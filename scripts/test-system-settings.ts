import assert from "node:assert/strict";
import {
    DEFAULT_SYSTEM_SETTINGS,
    normalizeSystemSettings,
    systemSettingsWriteSchema,
} from "../apps/web/src/lib/system-settings/schema";
import {
    evaluateRoomRequestPolicy,
    getFeatureDisabledMessage,
    isRegistrationAvailable,
    isStoreAvailable,
} from "../apps/web/src/lib/system-settings/policies";
import { getCaptchaProviderReadiness } from "../apps/web/src/lib/system-settings/service";

const defaults = normalizeSystemSettings({});
assert.deepEqual(defaults, DEFAULT_SYSTEM_SETTINGS);
assert.equal(isRegistrationAvailable(defaults), true);
assert.equal(isStoreAvailable(defaults), true);
assert.equal(getFeatureDisabledMessage("store"), "Magaza su anda kullanima kapali.");

const invalidTeamCapacity = systemSettingsWriteSchema.safeParse({
    ...defaults,
    capacity: {
        ...defaults.capacity,
        roomMaxPlayers: 20,
        teamMaxPlayers: 6,
    },
});
assert.equal(invalidTeamCapacity.success, false);

const invalidPlayableCapacity = systemSettingsWriteSchema.safeParse({
    ...defaults,
    capacity: {
        ...defaults.capacity,
        roomMaxPlayers: 2,
        teamMaxPlayers: 1,
    },
});
assert.equal(invalidPlayableCapacity.success, false);

const invalidCapacityThresholds = systemSettingsWriteSchema.safeParse({
    ...defaults,
    capacity: {
        ...defaults.capacity,
        warningThresholdPercent: 90,
        criticalThresholdPercent: 80,
    },
});
assert.equal(invalidCapacityThresholds.success, false);

const maintenanceSettings = normalizeSystemSettings({
    platform: {
        maintenanceEnabled: true,
        maintenanceMessage: "Bakim var.",
        motdEnabled: false,
        motdText: "",
    },
});

const guestDenied = evaluateRoomRequestPolicy({
    settings: normalizeSystemSettings({
        features: {
            registrationsEnabled: true,
            guestGameplayEnabled: false,
            roomCreateEnabled: true,
            roomJoinEnabled: true,
            storeEnabled: true,
        },
    }),
    isAuthenticated: false,
    isAdmin: false,
    isCreateRequest: false,
    isReconnect: false,
});
assert.equal(guestDenied.allowed, false);
assert.equal(guestDenied.message, "Misafir girisi su anda kapali.");

const maintenanceDenied = evaluateRoomRequestPolicy({
    settings: maintenanceSettings,
    isAuthenticated: true,
    isAdmin: false,
    isCreateRequest: true,
    isReconnect: false,
});
assert.equal(maintenanceDenied.allowed, false);
assert.equal(maintenanceDenied.message, "Bakim var.");

const reconnectAllowed = evaluateRoomRequestPolicy({
    settings: maintenanceSettings,
    isAuthenticated: true,
    isAdmin: false,
    isCreateRequest: false,
    isReconnect: true,
});
assert.equal(reconnectAllowed.allowed, true);

const originalTurnstileSiteKey = process.env.TURNSTILE_SITE_KEY;
const originalTurnstileSecretKey = process.env.TURNSTILE_SECRET_KEY;
process.env.TURNSTILE_SITE_KEY = "site";
process.env.TURNSTILE_SECRET_KEY = "secret";
assert.equal(getCaptchaProviderReadiness().turnstileConfigured, true);
if (originalTurnstileSiteKey === undefined) {
    delete process.env.TURNSTILE_SITE_KEY;
} else {
    process.env.TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
}
if (originalTurnstileSecretKey === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
} else {
    process.env.TURNSTILE_SECRET_KEY = originalTurnstileSecretKey;
}

console.log("system settings smoke test passed");
