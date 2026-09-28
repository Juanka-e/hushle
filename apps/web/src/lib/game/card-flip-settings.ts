export interface CardFlipSettingsState {
    enabled: boolean;
}

export const defaultCardFlipSettings: CardFlipSettingsState = {
    enabled: false,
};

const CARD_FLIP_SETTINGS_STORAGE_KEY = "hushle_card_flip_settings_v1";
const CARD_FLIP_SETTINGS_CHANGE_EVENT = "hushle:card-flip-settings-change";

export function parseCardFlipSettings(raw: string | null): CardFlipSettingsState {
    if (!raw) {
        return defaultCardFlipSettings;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<CardFlipSettingsState>;
        return {
            enabled:
                typeof parsed.enabled === "boolean"
                    ? parsed.enabled
                    : defaultCardFlipSettings.enabled,
        };
    } catch {
        return defaultCardFlipSettings;
    }
}

export function readCardFlipSettings(): CardFlipSettingsState {
    if (typeof window === "undefined") {
        return defaultCardFlipSettings;
    }

    return parseCardFlipSettings(
        window.localStorage.getItem(CARD_FLIP_SETTINGS_STORAGE_KEY)
    );
}

export function writeCardFlipSettings(
    settings: CardFlipSettingsState
): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(
        CARD_FLIP_SETTINGS_STORAGE_KEY,
        JSON.stringify(settings)
    );
    window.dispatchEvent(new Event(CARD_FLIP_SETTINGS_CHANGE_EVENT));
}

export function subscribeCardFlipSettings(
    listener: () => void
): () => void {
    if (typeof window === "undefined") {
        return () => undefined;
    }

    const handleStorage = (event: StorageEvent) => {
        if (event.key === CARD_FLIP_SETTINGS_STORAGE_KEY) {
            listener();
        }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(CARD_FLIP_SETTINGS_CHANGE_EVENT, listener);

    return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(CARD_FLIP_SETTINGS_CHANGE_EVENT, listener);
    };
}
