import type { SystemSettings } from "@/types/system-settings";
import { getPlayerErrorMessage } from "@/lib/errors/player-error";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";

export function isStoreAvailable(settings: SystemSettings): boolean {
    return settings.features.storeEnabled && !settings.platform.maintenanceEnabled;
}

export function isRegistrationAvailable(settings: SystemSettings): boolean {
    return settings.features.registrationsEnabled && !settings.platform.maintenanceEnabled;
}

export function getFeatureDisabledErrorCode(
    feature: "store" | "register"
): typeof PlayerErrorCode.STORE_DISABLED | typeof PlayerErrorCode.REGISTRATION_DISABLED {
    return feature === "store"
        ? PlayerErrorCode.STORE_DISABLED
        : PlayerErrorCode.REGISTRATION_DISABLED;
}

export function getFeatureDisabledMessage(feature: "store" | "register"): string {
    return getPlayerErrorMessage(getFeatureDisabledErrorCode(feature));
}

export interface RoomRequestPolicyDecision {
    allowed: boolean;
    code?: PlayerErrorCode;
    /** Turkish text: the operator's maintenance notice when one is set, otherwise the dictionary text. */
    message?: string;
    /** The message is the operator's own maintenance notice. */
    customMessage?: string;
}

function deny(code: PlayerErrorCode, customMessage?: string): RoomRequestPolicyDecision {
    const custom = customMessage?.trim();
    return custom
        ? { allowed: false, code, message: custom, customMessage: custom }
        : { allowed: false, code, message: getPlayerErrorMessage(code) };
}

export function evaluateRoomRequestPolicy(options: {
    settings: SystemSettings;
    isAuthenticated: boolean;
    isAdmin: boolean;
    isCreateRequest: boolean;
    isReconnect: boolean;
}): RoomRequestPolicyDecision {
    const { settings, isAuthenticated, isAdmin, isCreateRequest, isReconnect } = options;

    if (isAdmin) {
        return { allowed: true };
    }

    if (settings.platform.maintenanceEnabled && !isReconnect) {
        return deny(PlayerErrorCode.MAINTENANCE_MODE, settings.platform.maintenanceMessage);
    }

    if (!isAuthenticated && !settings.features.guestGameplayEnabled) {
        return deny(PlayerErrorCode.GUEST_PLAY_DISABLED);
    }

    if (isCreateRequest && !settings.features.roomCreateEnabled) {
        return deny(PlayerErrorCode.ROOM_CREATE_DISABLED);
    }

    if (!isCreateRequest && !settings.features.roomJoinEnabled && !isReconnect) {
        return deny(PlayerErrorCode.ROOM_JOIN_DISABLED);
    }

    return { allowed: true };
}
