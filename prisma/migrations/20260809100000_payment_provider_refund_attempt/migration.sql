ALTER TABLE `payment_reversal_requests`
    MODIFY `status` ENUM('pending', 'processing', 'provider_failed', 'provider_review', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    ADD COLUMN `execution_mode` ENUM('externally_confirmed', 'provider_api') NOT NULL DEFAULT 'externally_confirmed' AFTER `status`;

CREATE TABLE `payment_provider_refund_attempts` (
    `id` CHAR(36) NOT NULL,
    `reversal_request_id` CHAR(36) NOT NULL,
    `provider` ENUM('shopier_v2', 'iyzico', 'paytr', 'stripe', 'lemonsqueezy') NOT NULL,
    `status` ENUM('processing', 'succeeded', 'failed', 'uncertain') NOT NULL DEFAULT 'processing',
    `amount_minor` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `reference_no` VARCHAR(64) NOT NULL,
    `error_code` VARCHAR(80) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `last_checked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    CONSTRAINT `payment_provider_refund_attempts_amount_check` CHECK (`amount_minor` > 0),
    UNIQUE INDEX `payment_provider_refund_attempts_reversal_request_id_key`(`reversal_request_id`),
    UNIQUE INDEX `payment_provider_refund_attempts_provider_reference_no_key`(`provider`, `reference_no`),
    INDEX `payment_provider_refund_attempts_status_started_at_idx`(`status`, `started_at`),
    INDEX `payment_provider_refund_attempts_provider_status_created_at_idx`(`provider`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_provider_refund_attempts`
    ADD CONSTRAINT `payment_provider_refund_attempts_reversal_request_id_fkey`
        FOREIGN KEY (`reversal_request_id`) REFERENCES `payment_reversal_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
