import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";

export const SHOPIER_ACCEPTANCE_CONFIRMATION = "I_CONFIRM_A_REAL_LOW_VALUE_SHOPIER_TRANSACTION";
export const SHOPIER_ACCEPTANCE_CHECKPOINT_SCHEMA = "shopier-live-acceptance-checkpoint-v1";
export const SHOPIER_ACCEPTANCE_DEFAULT_MAX_AMOUNT_MINOR = 5_000;
export const SHOPIER_ACCEPTANCE_HARD_MAX_AMOUNT_MINOR = 10_000;

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commonCheckpointSchema = z.object({
    schema: z.literal(SHOPIER_ACCEPTANCE_CHECKPOINT_SCHEMA),
    capturedAt: z.string().datetime(),
    orderId: z.string().uuid(),
    ownerUserId: z.number().int().positive(),
    amountMinor: z.number().int().positive().max(SHOPIER_ACCEPTANCE_HARD_MAX_AMOUNT_MINOR),
    currency: z.literal("TRY"),
    accountIdHash: digestSchema,
    providerOrderReferenceHash: digestSchema,
}).strict();

export const shopierPaymentCheckpointSchema = commonCheckpointSchema.extend({
    phase: z.literal("payment_verified"),
    checks: z.object({
        checkoutPaid: z.literal(true),
        fulfillmentCompleted: z.literal(true),
        signedWebhookProcessed: z.literal(true),
        reconciliationSettled: z.literal(true),
    }).strict(),
}).strict();

export const shopierRefundCheckpointSchema = commonCheckpointSchema.extend({
    phase: z.literal("refund_requested"),
    reversalRequestId: z.string().uuid(),
    providerRefundReferenceHash: digestSchema,
    refundPendingObserved: z.literal(true),
}).strict();

export type ShopierPaymentCheckpoint = z.infer<typeof shopierPaymentCheckpointSchema>;
export type ShopierRefundCheckpoint = z.infer<typeof shopierRefundCheckpointSchema>;

export function hashShopierAcceptanceReference(value: string): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function readShopierAcceptanceMaxAmount(environment: NodeJS.ProcessEnv): number {
    const raw = environment.SHOPIER_ACCEPTANCE_MAX_AMOUNT_MINOR?.trim();
    if (!raw) return SHOPIER_ACCEPTANCE_DEFAULT_MAX_AMOUNT_MINOR;
    if (!/^\d+$/.test(raw)) throw new Error("shopier_acceptance_max_amount_invalid");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 100 || value > SHOPIER_ACCEPTANCE_HARD_MAX_AMOUNT_MINOR) {
        throw new Error("shopier_acceptance_max_amount_invalid");
    }
    return value;
}

export function assertShopierAcceptanceEnvironment(
    environment: NodeJS.ProcessEnv,
    options: { providerMutation: boolean }
): void {
    if (environment.PAYMENTS_ENABLED?.trim().toLowerCase() !== "false") {
        throw new Error("shopier_acceptance_public_payments_must_be_disabled");
    }
    if (environment.SHOPIER_LIVE_ACCEPTANCE_RECORDED?.trim().toLowerCase() === "true") {
        throw new Error("shopier_acceptance_already_recorded");
    }
    if (environment.SHOPIER_CHECKOUT_MODE?.trim().toLowerCase() !== "live"
        || environment.SHOPIER_WEBHOOK_MODE?.trim().toLowerCase() !== "live"
        || environment.SHOPIER_RECONCILIATION_MODE?.trim().toLowerCase() !== "live") {
        throw new Error("shopier_acceptance_observation_modes_must_be_live");
    }
    if ((environment.SHOPIER_REFUND_MODE?.trim().toLowerCase() || "disabled") !== "disabled") {
        throw new Error("shopier_acceptance_public_refund_must_be_disabled");
    }
    if (!/^\d{1,64}$/.test(environment.SHOPIER_ACCOUNT_ID?.trim() ?? "")) {
        throw new Error("shopier_acceptance_account_id_invalid");
    }
    readShopierAcceptanceMaxAmount(environment);
    if (!options.providerMutation) return;
    if (environment.SHOPIER_ACCEPTANCE_CONFIRM !== SHOPIER_ACCEPTANCE_CONFIRMATION) {
        throw new Error("shopier_acceptance_confirmation_required");
    }
    if (!/^[\x21-\x7e]{20,2048}$/.test(environment.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "")) {
        throw new Error("shopier_acceptance_personal_access_token_invalid");
    }
}

export function assertShopierAcceptanceAmount(input: {
    amountMinor: number;
    currency: string;
    environment: NodeJS.ProcessEnv;
}): void {
    if (input.currency !== "TRY") throw new Error("shopier_acceptance_currency_must_be_try");
    if (input.amountMinor <= 0 || input.amountMinor > readShopierAcceptanceMaxAmount(input.environment)) {
        throw new Error("shopier_acceptance_amount_exceeds_limit");
    }
}

export function readShopierAcceptanceCheckpoint<T>(path: string, schema: z.ZodType<T>): T {
    if (!path || !isAbsolute(path)) throw new Error("shopier_acceptance_checkpoint_path_invalid");
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
        throw new Error("shopier_acceptance_checkpoint_unreadable");
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error("shopier_acceptance_checkpoint_invalid");
    return parsed.data;
}

export function writeShopierAcceptanceArtifact(path: string, value: unknown): string {
    if (!path || !isAbsolute(path)) throw new Error("shopier_acceptance_output_path_invalid");
    mkdirSync(dirname(path), { recursive: true });
    const content = `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return hashShopierAcceptanceReference(content);
}

export function assertSafeShopierAcceptanceOutput(value: unknown, secrets: readonly string[]): void {
    const serialized = JSON.stringify(value);
    for (const secret of secrets) {
        if (secret && serialized.includes(secret)) throw new Error("shopier_acceptance_output_contains_secret");
    }
    if (/authorization|personalAccessToken|webhookToken|buyerEmail/i.test(serialized)) {
        throw new Error("shopier_acceptance_output_contains_sensitive_key");
    }
}
