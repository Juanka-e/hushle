import { getOrSetJsonCache, getRedisKey } from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";
import type { StoreCatalogPolicy } from "@hushle/platform-store";

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

type MobileStorePolicy = {
    available: boolean;
    catalog: StoreCatalogPolicy;
};

function numberSetting(
    record: Record<string, unknown> | null | undefined,
    key: string,
    fallback: number
): number {
    const value = record?.[key];
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : fallback;
}

function isWeekend(date: Date): boolean {
    const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Istanbul",
        weekday: "short",
    }).format(date);
    return weekday === "Sat" || weekday === "Sun";
}

export async function getMobileStorePolicy(): Promise<MobileStorePolicy> {
    const result = await getOrSetJsonCache<MobileStorePolicy>({
        key: getRedisKey("mobile-api", "store-policy", "v2"),
        ttlMs: 15_000,
        loader: async () => {
            const rows = await prisma.systemSetting.findMany({
                where: { key: { in: ["features", "platform", "economy"] } },
                select: { key: true, value: true },
            });
            const values = new Map(rows.map((row) => [row.key, asRecord(row.value)]));
            const features = values.get("features");
            const platform = values.get("platform");
            const economy = values.get("economy");
            const weekendBoostApplied =
                economy?.weekendCoinMultiplierEnabled === true &&
                isWeekend(new Date());
            const matchMultiplier = numberSetting(
                economy,
                "matchCoinMultiplier",
                1
            );
            const weekendMultiplier = numberSetting(
                economy,
                "weekendCoinMultiplier",
                1.5
            );
            return {
                available:
                    features?.storeEnabled !== false &&
                    platform?.maintenanceEnabled !== true,
                catalog: {
                    storePriceMultiplier: numberSetting(
                        economy,
                        "storePriceMultiplier",
                        1
                    ),
                    bundlesEnabled: economy?.bundlesEnabled !== false,
                    couponsEnabled: economy?.couponsEnabled !== false,
                    discountCampaignsEnabled:
                        economy?.discountCampaignsEnabled !== false,
                    activeMatchCoinMultiplier: weekendBoostApplied
                        ? matchMultiplier * weekendMultiplier
                        : matchMultiplier,
                    weekendBoostApplied,
                },
            };
        },
    });
    return result.value;
}

export async function isMobileStoreAvailable(): Promise<boolean> {
    return (await getMobileStorePolicy()).available;
}
