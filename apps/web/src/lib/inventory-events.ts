export const INVENTORY_UPDATED_EVENT = "tabu:inventory-updated";

export function dispatchInventoryUpdated(): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(new CustomEvent(INVENTORY_UPDATED_EVENT));
}
