CREATE TABLE `payment_orders` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `provider` ENUM('shopier_v2', 'iyzico', 'paytr', 'stripe', 'lemonsqueezy') NOT NULL,
    `provider_config_version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('created', 'pending_provider', 'awaiting_payment', 'paid', 'fulfilled', 'failed', 'expired', 'refunded', 'chargeback') NOT NULL DEFAULT 'created',
    `idempotency_key` VARCHAR(128) NOT NULL,
    `request_fingerprint` CHAR(64) NOT NULL,
    `product_kind` ENUM('cosmetic_item', 'cosmetic_bundle', 'coin_pack') NOT NULL,
    `product_reference` VARCHAR(120) NOT NULL,
    `product_version` INTEGER NOT NULL,
    `product_name_snapshot` VARCHAR(160) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_amount_minor` INTEGER NOT NULL,
    `total_amount_minor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `grant_snapshot` JSON NOT NULL,
    `provider_order_reference` VARCHAR(191) NULL,
    `provider_session_reference` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `expires_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `fulfilled_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `refunded_at` DATETIME(3) NULL,
    `chargeback_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_orders_user_id_idempotency_key_key`(`user_id`, `idempotency_key`),
    UNIQUE INDEX `payment_orders_provider_provider_order_reference_key`(`provider`, `provider_order_reference`),
    UNIQUE INDEX `payment_orders_provider_provider_session_reference_key`(`provider`, `provider_session_reference`),
    INDEX `payment_orders_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `payment_orders_status_created_at_idx`(`status`, `created_at`),
    INDEX `payment_orders_provider_status_created_at_idx`(`provider`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_attempts` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `attempt_number` INTEGER NOT NULL,
    `status` ENUM('created', 'requested', 'succeeded', 'failed') NOT NULL DEFAULT 'created',
    `request_fingerprint` CHAR(64) NOT NULL,
    `provider_request_id` VARCHAR(191) NULL,
    `error_code` VARCHAR(80) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_attempts_order_id_attempt_number_key`(`order_id`, `attempt_number`),
    UNIQUE INDEX `payment_attempts_order_id_provider_request_id_key`(`order_id`, `provider_request_id`),
    INDEX `payment_attempts_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_fulfillments` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `status` ENUM('pending', 'completed', 'failed', 'reversed') NOT NULL DEFAULT 'pending',
    `fulfillment_key` VARCHAR(191) NOT NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `grant_result` JSON NULL,
    `error_code` VARCHAR(80) NULL,
    `completed_at` DATETIME(3) NULL,
    `reversed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_fulfillments_order_id_key`(`order_id`),
    UNIQUE INDEX `payment_fulfillments_fulfillment_key_key`(`fulfillment_key`),
    INDEX `payment_fulfillments_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_orders`
    ADD CONSTRAINT `payment_orders_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payment_attempts`
    ADD CONSTRAINT `payment_attempts_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `payment_fulfillments`
    ADD CONSTRAINT `payment_fulfillments_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
