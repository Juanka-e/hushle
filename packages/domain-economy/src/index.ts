import { z } from "zod";

export const ECONOMY_GRANT_PLAN_SCHEMA_VERSION = 1 as const;
export const CURRENT_BALANCE_ASSET_CODES = ["COIN"] as const;
export const CURRENT_ENTITLEMENT_CATALOGS = ["shop_item"] as const;

const MAX_EFFECTS = 100;
const MAX_PLAN_BYTES = 65_536;
const MAX_EFFECT_AMOUNT = 10_000_000;
const safeCodeSchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,31}$/);
const safeReferenceSchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/);
const metadataSchema = z.record(z.string().min(1).max(80), z.unknown());

export const balanceCreditEffectSchema = z.object({
    effectId: safeReferenceSchema,
    type: z.literal("balance_credit"),
    assetCode: safeCodeSchema,
    amount: z.number().int().min(1).max(MAX_EFFECT_AMOUNT),
}).strict();

export const inventoryEntitlementEffectSchema = z.object({
    effectId: safeReferenceSchema,
    type: z.literal("inventory_entitlement"),
    catalog: safeReferenceSchema,
    itemReference: safeReferenceSchema,
    renderSnapshot: metadataSchema,
}).strict();

export const economyGrantEffectSchema = z.discriminatedUnion("type", [
    balanceCreditEffectSchema,
    inventoryEntitlementEffectSchema,
]);

export const economyGrantPlanSchema = z.object({
    schemaVersion: z.literal(ECONOMY_GRANT_PLAN_SCHEMA_VERSION),
    effects: z.array(economyGrantEffectSchema).min(1).max(MAX_EFFECTS),
}).strict().superRefine((plan, context) => {
    if (new Set(plan.effects.map((effect) => effect.effectId)).size !== plan.effects.length) {
        context.addIssue({ code: "custom", message: "effect IDs must be unique", path: ["effects"] });
    }
    const inventoryKeys = plan.effects
        .filter((effect) => effect.type === "inventory_entitlement")
        .map((effect) => `${effect.catalog}:${effect.itemReference}`);
    if (new Set(inventoryKeys).size !== inventoryKeys.length) {
        context.addIssue({ code: "custom", message: "inventory effects must be unique", path: ["effects"] });
    }
    try {
        if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > MAX_PLAN_BYTES) {
            context.addIssue({ code: "custom", message: "grant plan is too large" });
        }
    } catch {
        context.addIssue({ code: "custom", message: "grant plan must be JSON serializable" });
    }
});

export type EconomyGrantEffect = z.infer<typeof economyGrantEffectSchema>;
export type EconomyGrantPlan = z.infer<typeof economyGrantPlanSchema>;

export type EconomyRuntimeCapabilities = {
    balanceAssetCodes: readonly string[];
    entitlementCatalogs: readonly string[];
};

export const currentEconomyRuntimeCapabilities: EconomyRuntimeCapabilities = {
    balanceAssetCodes: CURRENT_BALANCE_ASSET_CODES,
    entitlementCatalogs: CURRENT_ENTITLEMENT_CATALOGS,
};

export function unsupportedEconomyEffects(
    plan: EconomyGrantPlan,
    capabilities: EconomyRuntimeCapabilities = currentEconomyRuntimeCapabilities
): EconomyGrantEffect[] {
    const assets = new Set(capabilities.balanceAssetCodes);
    const catalogs = new Set(capabilities.entitlementCatalogs);
    return plan.effects.filter((effect) => effect.type === "balance_credit"
        ? !assets.has(effect.assetCode)
        : !catalogs.has(effect.catalog));
}
