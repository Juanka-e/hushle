export const NOTIFICATIONS_UPDATED_EVENT = "tabu:notifications-updated";

export function dispatchNotificationsUpdated(): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_UPDATED_EVENT));
}
