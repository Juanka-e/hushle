import {
    economyGrantPlanSchema,
    unsupportedEconomyEffects,
    type EconomyGrantPlan,
} from "@hushle/domain-economy";
import { z } from "zod";
import type { PaymentProductKind } from "./contracts";

const MAX_COIN_GRANT = 10_000_000;
const MAX_RENDER_SNAPSHOT_BYTES = 16_384;

const renderSnapshotSchema = z.record(z.string().min(1).max(80), z.unknown())
    .refine((value) => {
        try {
            return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_RENDER_SNAPSHOT_BYTES;
        } catch {
            return false;
        }
    });

const cosmeticGrantItemSchema = z.object({
    shopItemId: z.number().int().positive(),
    renderSnapshot: renderSnapshotSchema,
}).strict();
const legacyCoinPackSchema = z.object({
    schemaVersion: z.literal(1),
    coinAmount: z.number().int().min(1).max(MAX_COIN_GRANT),
}).strict();
const legacyCosmeticSchema = z.object({
    schemaVersion: z.literal(1),
    items: z.array(cosmeticGrantItemSchema).min(1).max(100),
}).strict().refine((value) => new Set(value.items.map((item) => item.shopItemId)).size === value.items.length);
const paymentGrantV2Schema = z.object({
    schemaVersion: z.literal(2),
    plan: economyGrantPlanSchema,
}).strict();

export type NormalizedPaymentGrant =
    | { kind: "coin_pack"; coinAmount: number }
    | {
        kind: "cosmetic_item" | "cosmetic_bundle";
        items: z.infer<typeof cosmeticGrantItemSchema>[];
    };

export class PaymentGrantContractError extends Error {
    constructor(public readonly code: "invalid_grant_snapshot" | "unsupported_grant_effect" | "grant_balance_overflow") {
        super(code);
        this.name = "PaymentGrantContractError";
    }
}

function legacyPlan(productKind: PaymentProductKind, value: unknown): EconomyGrantPlan {
    if (productKind === "coin_pack") {
        const parsed = legacyCoinPackSchema.safeParse(value);
        if (!parsed.success) throw new PaymentGrantContractError("invalid_grant_snapshot");
        return {
            schemaVersion: 1,
            effects: [{ effectId: "coin", type: "balance_credit", assetCode: "COIN", amount: parsed.data.coinAmount }],
        };
    }
    const parsed = legacyCosmeticSchema.safeParse(value);
    if (!parsed.success) throw new PaymentGrantContractError("invalid_grant_snapshot");
    return {
        schemaVersion: 1,
        effects: parsed.data.items.map((item, index) => ({
            effectId: `item-${index + 1}`,
            type: "inventory_entitlement" as const,
            catalog: "shop_item",
            itemReference: String(item.shopItemId),
            renderSnapshot: item.renderSnapshot,
        })),
    };
}

export function normalizePaymentGrantContract(input: {
    productKind: PaymentProductKind;
    quantity: number;
    grantSnapshot: unknown;
}): NormalizedPaymentGrant {
    const v2 = paymentGrantV2Schema.safeParse(input.grantSnapshot);
    const plan = v2.success ? v2.data.plan : legacyPlan(input.productKind, input.grantSnapshot);
    if (unsupportedEconomyEffects(plan).length > 0) {
        throw new PaymentGrantContractError("unsupported_grant_effect");
    }

    if (input.productKind === "coin_pack") {
        if (plan.effects.length !== 1 || plan.effects[0].type !== "balance_credit" || plan.effects[0].assetCode !== "COIN") {
            throw new PaymentGrantContractError("invalid_grant_snapshot");
        }
        const coinAmount = plan.effects[0].amount * input.quantity;
        if (!Number.isSafeInteger(coinAmount) || coinAmount > 2_147_483_647) {
            throw new PaymentGrantContractError("grant_balance_overflow");
        }
        return { kind: "coin_pack", coinAmount };
    }

    if (input.quantity !== 1 || plan.effects.some((effect) => effect.type !== "inventory_entitlement")) {
        throw new PaymentGrantContractError("invalid_grant_snapshot");
    }
    if ((input.productKind === "cosmetic_item" && plan.effects.length !== 1) || plan.effects.length > 100) {
        throw new PaymentGrantContractError("invalid_grant_snapshot");
    }
    const items = plan.effects.map((effect) => {
        if (effect.type !== "inventory_entitlement" || effect.catalog !== "shop_item" || !/^\d+$/.test(effect.itemReference)) {
            throw new PaymentGrantContractError("invalid_grant_snapshot");
        }
        const shopItemId = Number(effect.itemReference);
        if (!Number.isSafeInteger(shopItemId) || shopItemId <= 0) {
            throw new PaymentGrantContractError("invalid_grant_snapshot");
        }
        return { shopItemId, renderSnapshot: effect.renderSnapshot };
    });
    return { kind: input.productKind, items };
}

export function isPaymentGrantSnapshotSupported(input: {
    productKind: PaymentProductKind;
    quantity: number;
    grantSnapshot: unknown;
}): boolean {
    try {
        normalizePaymentGrantContract(input);
        return true;
    } catch {
        return false;
    }
}
