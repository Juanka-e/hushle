ALTER TABLE `payment_attempts`
    MODIFY COLUMN `status` ENUM('created', 'requested', 'succeeded', 'failed', 'uncertain') NOT NULL DEFAULT 'created';

ALTER TABLE `payment_orders`
    ADD COLUMN `provider_hosted_url` VARCHAR(1000) NULL AFTER `provider_session_reference`;

CREATE TABLE `payment_checkout_verifications` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `provider` ENUM('shopier_v2', 'iyzico', 'paytr', 'stripe', 'lemonsqueezy') NOT NULL,
    `provider_payment_reference` VARCHAR(191) NOT NULL,
    `amount_minor` INTEGER NOT NULL,
    `paid_amount_minor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `provider_payment_status` VARCHAR(80) NOT NULL,
    `provider_risk_status` INTEGER NULL,
    `verified_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_checkout_verifications_order_id_key`(`order_id`),
    UNIQUE INDEX `payment_checkout_verifications_provider_ref_key`(`provider`, `provider_payment_reference`),
    INDEX `payment_checkout_verifications_provider_verified_idx`(`provider`, `verified_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_checkout_verifications`
    ADD CONSTRAINT `payment_checkout_verifications_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
