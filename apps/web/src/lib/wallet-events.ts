export const WALLET_UPDATED_EVENT = "tabu:wallet-updated";

export interface WalletUpdatedDetail {
    coinBalance: number;
    source: "store_purchase" | "bundle_purchase" | "coin_grant";
}

export function dispatchWalletUpdated(detail: WalletUpdatedDetail): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(new CustomEvent<WalletUpdatedDetail>(WALLET_UPDATED_EVENT, { detail }));
}
