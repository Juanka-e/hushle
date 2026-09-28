import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
    mockBundles,
    mockCouponCodes,
    mockDiscountCampaigns,
    mockShopItems,
} from "../apps/web/src/lib/store/mock-catalog";

function sqlString(value: string | null): string {
    if (value === null) {
        return "NULL";
    }

    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function sqlNumber(value: number | null): string {
    return value === null ? "NULL" : String(value);
}

function sqlBoolean(value: boolean): string {
    return value ? "1" : "0";
}

function sqlDate(value: string | null): string {
    return value ? sqlString(value.replace("T", " ").replace(".000Z", "")) : "NULL";
}

function sqlJson(value: object | null): string {
    return value ? sqlString(JSON.stringify(value)) : "NULL";
}

function buildShopItemsSql(): string {
    const values = mockShopItems.map((item) => `(
${sqlString(item.code)},
${sqlString(item.type)},
${sqlString(item.name)},
${sqlString(item.rarity)},
${sqlString(item.renderMode)},
${item.priceCoin},
${sqlString(item.imageUrl)},
${sqlString(item.templateKey)},
${sqlJson(item.templateConfig)},
${sqlString(item.badgeText)},
${sqlString(item.availabilityMode ?? "always_on")},
${sqlDate(item.startsAt ?? null)},
${sqlDate(item.endsAt ?? null)},
${sqlBoolean(item.isFeatured)},
${sqlBoolean(item.isActive)},
${item.sortOrder},
NOW(),
NOW()
)`);

    return `
INSERT INTO shop_items (
    code,
    type,
    name,
    rarity,
    render_mode,
    price_coin,
    image_url,
    template_key,
    template_config,
    badge_text,
    availability_mode,
    starts_at,
    ends_at,
    is_featured,
    is_active,
    sort_order,
    created_at,
    updated_at
) VALUES
${values.join(",\n")}
ON DUPLICATE KEY UPDATE
    type = VALUES(type),
    name = VALUES(name),
    rarity = VALUES(rarity),
    render_mode = VALUES(render_mode),
    price_coin = VALUES(price_coin),
    image_url = VALUES(image_url),
    template_key = VALUES(template_key),
    template_config = VALUES(template_config),
    badge_text = VALUES(badge_text),
    availability_mode = VALUES(availability_mode),
    starts_at = VALUES(starts_at),
    ends_at = VALUES(ends_at),
    is_featured = VALUES(is_featured),
    is_active = VALUES(is_active),
    sort_order = VALUES(sort_order),
    updated_at = NOW();
`;
}

function buildBundlesSql(): string {
    const bundleValues = mockBundles.map((bundle) => `(
${sqlString(bundle.code)},
${sqlString(bundle.name)},
${sqlString(bundle.description)},
${bundle.priceCoin},
${sqlBoolean(bundle.isActive)},
${bundle.sortOrder},
NOW(),
NOW()
)`);

    const bundleCodes = mockBundles.map((bundle) => sqlString(bundle.code)).join(", ");
    const bundleItemStatements = mockBundles.flatMap((bundle) =>
        bundle.itemCodes.map((itemCode, index) => `
INSERT INTO shop_bundle_items (bundle_id, shop_item_id, sort_order, created_at)
SELECT
    (SELECT id FROM shop_bundles WHERE code = ${sqlString(bundle.code)}),
    (SELECT id FROM shop_items WHERE code = ${sqlString(itemCode)}),
    ${index},
    NOW();
`)
    );

    return `
INSERT INTO shop_bundles (
    code,
    name,
    description,
    price_coin,
    is_active,
    sort_order,
    created_at,
    updated_at
) VALUES
${bundleValues.join(",\n")}
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    price_coin = VALUES(price_coin),
    is_active = VALUES(is_active),
    sort_order = VALUES(sort_order),
    updated_at = NOW();

DELETE sbi
FROM shop_bundle_items sbi
INNER JOIN shop_bundles sb ON sb.id = sbi.bundle_id
WHERE sb.code IN (${bundleCodes});

${bundleItemStatements.join("\n")}
`;
}

function buildDiscountsSql(): string {
    const values = mockDiscountCampaigns.map((campaign) => `(
${sqlString(campaign.code)},
${sqlString(campaign.name)},
${sqlString(campaign.description)},
${sqlString(campaign.targetType)},
${sqlString(campaign.discountType)},
${sqlNumber(campaign.percentageOff)},
${sqlNumber(campaign.fixedCoinOff)},
${campaign.targetType === "shop_item" ? `(SELECT id FROM shop_items WHERE code = ${sqlString(campaign.targetCode)})` : "NULL"},
${campaign.targetType === "bundle" ? `(SELECT id FROM shop_bundles WHERE code = ${sqlString(campaign.targetCode)})` : "NULL"},
${sqlNumber(campaign.usageLimit)},
${sqlDate(campaign.startsAt)},
${sqlDate(campaign.endsAt)},
${sqlBoolean(campaign.isActive)},
${sqlBoolean(campaign.stackableWithCoupon)},
NOW(),
NOW()
)`);

    return `
INSERT INTO discount_campaigns (
    code,
    name,
    description,
    target_type,
    discount_type,
    percentage_off,
    fixed_coin_off,
    shop_item_id,
    bundle_id,
    usage_limit,
    starts_at,
    ends_at,
    is_active,
    stackable_with_coupon,
    created_at,
    updated_at
) VALUES
${values.join(",\n")}
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    target_type = VALUES(target_type),
    discount_type = VALUES(discount_type),
    percentage_off = VALUES(percentage_off),
    fixed_coin_off = VALUES(fixed_coin_off),
    shop_item_id = VALUES(shop_item_id),
    bundle_id = VALUES(bundle_id),
    usage_limit = VALUES(usage_limit),
    starts_at = VALUES(starts_at),
    ends_at = VALUES(ends_at),
    is_active = VALUES(is_active),
    stackable_with_coupon = VALUES(stackable_with_coupon),
    updated_at = NOW();
`;
}

function buildCouponsSql(): string {
    const values = mockCouponCodes.map((coupon) => `(
${sqlString(coupon.code)},
${sqlString(coupon.name)},
${sqlString(coupon.description)},
${sqlString(coupon.targetType)},
${sqlString(coupon.discountType)},
${sqlNumber(coupon.percentageOff)},
${sqlNumber(coupon.fixedCoinOff)},
${coupon.targetType === "shop_item" ? `(SELECT id FROM shop_items WHERE code = ${sqlString(coupon.targetCode)})` : "NULL"},
${coupon.targetType === "bundle" ? `(SELECT id FROM shop_bundles WHERE code = ${sqlString(coupon.targetCode)})` : "NULL"},
${sqlNumber(coupon.usageLimit)},
${sqlDate(coupon.startsAt)},
${sqlDate(coupon.endsAt)},
${sqlBoolean(coupon.isActive)},
NOW(),
NOW()
)`);

    return `
INSERT INTO coupon_codes (
    code,
    name,
    description,
    target_type,
    discount_type,
    percentage_off,
    fixed_coin_off,
    shop_item_id,
    bundle_id,
    usage_limit,
    starts_at,
    ends_at,
    is_active,
    created_at,
    updated_at
) VALUES
${values.join(",\n")}
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    target_type = VALUES(target_type),
    discount_type = VALUES(discount_type),
    percentage_off = VALUES(percentage_off),
    fixed_coin_off = VALUES(fixed_coin_off),
    shop_item_id = VALUES(shop_item_id),
    bundle_id = VALUES(bundle_id),
    usage_limit = VALUES(usage_limit),
    starts_at = VALUES(starts_at),
    ends_at = VALUES(ends_at),
    is_active = VALUES(is_active),
    updated_at = NOW();
`;
}

function buildSeedSql(): string {
    return `
START TRANSACTION;
${buildShopItemsSql()}
${buildBundlesSql()}
${buildDiscountsSql()}
${buildCouponsSql()}
COMMIT;
`;
}

function main() {
    const sqlFilePath = path.join(process.cwd(), "scripts", ".tmp-seed-store-catalog.sql");
    fs.writeFileSync(sqlFilePath, buildSeedSql(), "utf8");

    const result = process.platform === "win32"
        ? spawnSync(
            "cmd.exe",
            ["/c", "npx", "prisma", "db", "execute", "--file", sqlFilePath, "--schema", "prisma/schema.prisma"],
            {
                cwd: process.cwd(),
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }
        )
        : spawnSync(
            "npx",
            ["prisma", "db", "execute", "--file", sqlFilePath, "--schema", "prisma/schema.prisma"],
            {
                cwd: process.cwd(),
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }
        );

    fs.rmSync(sqlFilePath, { force: true });

    if (result.status !== 0) {
        console.error("store catalog seed failed");
        if (result.error) {
            console.error(result.error.message);
        }
        if (result.stdout) {
            console.error("stdout:");
            console.error(result.stdout);
        }
        if (result.stderr) {
            console.error("stderr:");
            console.error(result.stderr);
        }
        process.exitCode = 1;
        return;
    }

    console.log("store catalog seed completed");
}

main();
