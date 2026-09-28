export const WALLET_ADJUSTMENT_TYPES = ["credit", "debit"] as const;

export type WalletAdjustmentType = (typeof WALLET_ADJUSTMENT_TYPES)[number];

export interface AdminWalletAdjustmentView {
    id: number;
    adjustmentType: WalletAdjustmentType;
    amount: number;
    reason: string;
    balanceBefore: number;
    balanceAfter: number;
    createdAt: string;
    actor: {
        id: number | null;
        username: string;
        role: string;
    } | null;
}

export interface AdminWalletAdjustmentResponse {
    ok: true;
    adjustment: AdminWalletAdjustmentView;
    coinBalance: number;
}
