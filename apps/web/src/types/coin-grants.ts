export const COIN_GRANT_CLAIM_STATUSES = ["completed"] as const;

export type CoinGrantClaimStatus = (typeof COIN_GRANT_CLAIM_STATUSES)[number];

export interface CoinGrantCodeView {
    id: number;
    campaignId: number;
    code: string;
    label: string | null;
    maxClaims: number | null;
    claimCount: number;
    expiresAt: string | null;
    isActive: boolean;
    archivedAt: string | null;
    createdAt: string;
}

export interface CoinGrantCampaignView {
    id: number;
    code: string;
    name: string;
    description: string | null;
    coinAmount: number;
    totalBudgetCoin: number | null;
    totalGrantedCoin: number;
    totalClaimLimit: number | null;
    totalClaimCount: number;
    perUserClaimLimit: number;
    startsAt: string | null;
    endsAt: string | null;
    isActive: boolean;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
    codes: CoinGrantCodeView[];
}

export interface CoinGrantClaimView {
    id: number;
    campaignId: number;
    codeId: number;
    userId: number;
    status: CoinGrantClaimStatus;
    coinAmount: number;
    createdAt: string;
}

export interface CoinGrantRedeemSuccess {
    ok: true;
    campaign: {
        id: number;
        code: string;
        name: string;
    };
    code: {
        id: number;
        code: string;
        label: string | null;
    };
    coinAmount: number;
    coinBalance: number;
    claim: CoinGrantClaimView;
}

export interface CoinGrantRedeemError {
    ok: false;
    code:
        | "not_found"
        | "inactive"
        | "expired"
        | "campaign_not_started"
        | "campaign_ended"
        | "campaign_budget_exhausted"
        | "campaign_claim_limit_reached"
        | "user_claim_limit_reached"
        | "code_claim_limit_reached";
}

export type CoinGrantRedeemResult = CoinGrantRedeemSuccess | CoinGrantRedeemError;
