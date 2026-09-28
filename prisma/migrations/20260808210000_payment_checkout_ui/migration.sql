CREATE TABLE `payment_offers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `product_kind` ENUM('cosmetic_item', 'cosmetic_bundle', 'coin_pack') NOT NULL,
    `product_reference` VARCHAR(120) NOT NULL,
    `product_version` INTEGER NOT NULL,
    `product_name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `unit_amount_minor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `grant_snapshot` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_offers_code_key`(`code`),
    INDEX `payment_offers_is_active_sort_order_idx`(`is_active`, `sort_order`),
    INDEX `payment_offers_starts_at_ends_at_idx`(`starts_at`, `ends_at`),
    CONSTRAINT `payment_offers_product_version_check` CHECK (`product_version` >= 1),
    CONSTRAINT `payment_offers_unit_amount_check` CHECK (`unit_amount_minor` > 0),
    CONSTRAINT `payment_offers_currency_check` CHECK (`currency` REGEXP '^[A-Z]{3}$'),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_checkout_consents` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `checkout_terms_version` VARCHAR(80) NOT NULL,
    `privacy_notice_version` VARCHAR(80) NOT NULL,
    `distance_sales_notice_version` VARCHAR(80) NOT NULL,
    `accepted_at` DATETIME(3) NOT NULL,
    `request_id` VARCHAR(80) NULL,
    `user_agent_hash` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_checkout_consents_order_id_key`(`order_id`),
    INDEX `payment_checkout_consents_accepted_at_idx`(`accepted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_checkout_consents`
    ADD CONSTRAINT `payment_checkout_consents_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
