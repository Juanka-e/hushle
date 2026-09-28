CREATE TABLE `payment_webhook_events` (
    `id` CHAR(36) NOT NULL,
    `provider` ENUM('shopier_v2', 'iyzico', 'paytr', 'stripe', 'lemonsqueezy') NOT NULL,
    `provider_event_id` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(120) NOT NULL,
    `outcome` ENUM('payment_succeeded', 'payment_failed', 'refund', 'chargeback', 'ignored') NOT NULL,
    `body_sha256` CHAR(64) NOT NULL,
    `signature_version` VARCHAR(32) NULL,
    `order_id` CHAR(36) NULL,
    `provider_order_reference` VARCHAR(191) NULL,
    `provider_payment_reference` VARCHAR(191) NULL,
    `amount_minor` INTEGER NULL,
    `currency` CHAR(3) NULL,
    `metadata` JSON NULL,
    `status` ENUM('pending', 'processing', 'retry', 'processed', 'dead_letter') NOT NULL DEFAULT 'pending',
    `delivery_count` INTEGER NOT NULL DEFAULT 1,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claim_token` CHAR(36) NULL,
    `claimed_at` DATETIME(3) NULL,
    `claim_expires_at` DATETIME(3) NULL,
    `last_received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_attempt_at` DATETIME(3) NULL,
    `processed_at` DATETIME(3) NULL,
    `last_error_code` VARCHAR(80) NULL,
    `occurred_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_webhook_events_provider_provider_event_id_key`(`provider`, `provider_event_id`),
    INDEX `payment_webhook_events_status_available_at_created_at_idx`(`status`, `available_at`, `created_at`),
    INDEX `payment_webhook_events_status_claim_expires_at_idx`(`status`, `claim_expires_at`),
    INDEX `payment_webhook_events_provider_provider_order_reference_idx`(`provider`, `provider_order_reference`),
    INDEX `payment_webhook_events_order_id_created_at_idx`(`order_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_webhook_events`
    ADD CONSTRAINT `payment_webhook_events_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
