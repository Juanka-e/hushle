export type AdminWalletLedgerSource =
    | "legacy_balance_snapshot"
    | "account_opening"
    | "match_reward"
    | "store_item_purchase"
    | "store_bundle_purchase"
    | "coin_grant"
    | "admin_adjustment"
    | "payment_topup"
    | "payment_reversal";

export interface AdminWalletLedgerEntry {
    id: number;
    source: AdminWalletLedgerSource;
    deltaCoin: number;
    balanceBefore: number;
    balanceAfter: number;
    referenceType: string | null;
    referenceId: string | null;
    createdAt: string;
    actor: {
        id: number;
        username: string;
    } | null;
    adjustmentReason: string | null;
}

export interface AdminWalletLedgerResponse {
    userId: number;
    username: string;
    coinBalance: number;
    reconciliationStatus: "reconciled" | "mismatch" | "not_initialized";
    latestLedgerBalance: number | null;
    entries: AdminWalletLedgerEntry[];
    page: number;
    pages: number;
    total: number;
}
