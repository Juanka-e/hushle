import type { SystemSettings } from "@/types/system-settings";

export function isStoreAvailable(settings: SystemSettings): boolean {
    return settings.features.storeEnabled && !settings.platform.maintenanceEnabled;
}

export function isRegistrationAvailable(settings: SystemSettings): boolean {
    return settings.features.registrationsEnabled && !settings.platform.maintenanceEnabled;
}

export function getFeatureDisabledMessage(feature: "store" | "register"): string {
    if (feature === "store") {
        return "Magaza su anda kullanima kapali.";
    }

    return "Kayitlar su anda kapali.";
}

export function evaluateRoomRequestPolicy(options: {
    settings: SystemSettings;
    isAuthenticated: boolean;
    isAdmin: boolean;
    isCreateRequest: boolean;
    isReconnect: boolean;
}): { allowed: boolean; message?: string } {
    const { settings, isAuthenticated, isAdmin, isCreateRequest, isReconnect } = options;

    if (isAdmin) {
        return { allowed: true };
    }

    if (settings.platform.maintenanceEnabled && !isReconnect) {
        return {
            allowed: false,
            message: settings.platform.maintenanceMessage || "Sunucu bakim modunda. Lutfen daha sonra tekrar deneyin.",
        };
    }

    if (!isAuthenticated && !settings.features.guestGameplayEnabled) {
        return {
            allowed: false,
            message: "Misafir girisi su anda kapali.",
        };
    }

    if (isCreateRequest && !settings.features.roomCreateEnabled) {
        return {
            allowed: false,
            message: "Yeni oda olusturma su anda gecici olarak kapali.",
        };
    }

    if (!isCreateRequest && !settings.features.roomJoinEnabled && !isReconnect) {
        return {
            allowed: false,
            message: "Odalara katilim su anda gecici olarak kapali.",
        };
    }

    return { allowed: true };
}
