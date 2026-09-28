CREATE TABLE `payment_reversals` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `outcome` ENUM('refund', 'chargeback') NOT NULL,
    `status` ENUM('completed', 'manual_review') NOT NULL,
    `external_reference` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `evidence` JSON NOT NULL,
    `requested_by_user_id` INTEGER NULL,
    `notification_sent_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_reversals_order_id_key`(`order_id`),
    INDEX `payment_reversals_status_created_at_idx`(`status`, `created_at`),
    INDEX `payment_reversals_outcome_created_at_idx`(`outcome`, `created_at`),
    INDEX `payment_reversals_requested_by_user_id_created_at_idx`(`requested_by_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_reconciliation_cases` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `status` ENUM('open', 'resolved', 'ignored') NOT NULL DEFAULT 'open',
    `reason_code` VARCHAR(80) NOT NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `provider_snapshot` JSON NULL,
    `last_error_code` VARCHAR(80) NULL,
    `last_checked_at` DATETIME(3) NULL,
    `next_check_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolved_by_user_id` INTEGER NULL,
    `resolution_note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_reconciliation_cases_order_id_key`(`order_id`),
    INDEX `payment_reconciliation_cases_status_next_check_at_created_at_idx`(`status`, `next_check_at`, `created_at`),
    INDEX `payment_reconciliation_cases_reason_code_created_at_idx`(`reason_code`, `created_at`),
    INDEX `payment_reconciliation_cases_resolved_by_user_id_resolved_at_idx`(`resolved_by_user_id`, `resolved_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_reversals`
    ADD CONSTRAINT `payment_reversals_order_id_fkey`
        FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_reversals_requested_by_user_id_fkey`
        FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payment_reconciliation_cases`
    ADD CONSTRAINT `payment_reconciliation_cases_order_id_fkey`
        FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_reconciliation_cases_resolved_by_user_id_fkey`
        FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
