export const MATCH_SETTLEMENT_MAX_ATTEMPTS = 10;
export const MATCH_SETTLEMENT_CLAIM_TTL_MS = 60_000;

const RETRY_DELAYS_MS = [
    15_000,
    30_000,
    60_000,
    120_000,
    300_000,
    600_000,
    900_000,
    1_800_000,
] as const;

/** Delay before the next attempt, given how many attempts have already run. */
export function getSettlementRetryDelayMs(attemptCount: number): number {
    const index = Math.min(
        RETRY_DELAYS_MS.length - 1,
        Math.max(0, Math.floor(attemptCount) - 1)
    );
    return RETRY_DELAYS_MS[index];
}

const MAX_ERROR_LENGTH = 255;

export function formatSettlementError(error: unknown): string {
    let text: string;
    if (error instanceof Error) {
        text = `${error.name}: ${error.message}`;
    } else if (typeof error === "string") {
        text = error;
    } else if (error === undefined || error === null) {
        text = "Unknown settlement error";
    } else {
        try {
            text = JSON.stringify(error);
        } catch {
            text = String(error);
        }
    }
    const singleLine = text.replace(/\s+/g, " ").trim() || "Unknown settlement error";
    return singleLine.slice(0, MAX_ERROR_LENGTH);
}
