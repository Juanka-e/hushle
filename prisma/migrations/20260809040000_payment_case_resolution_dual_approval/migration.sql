CREATE TABLE `payment_reversal_requests` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `outcome` ENUM('refund', 'chargeback') NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `external_reference` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `requested_by_user_id` INTEGER NOT NULL,
    `reviewed_by_user_id` INTEGER NULL,
    `review_note` VARCHAR(500) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payment_reversal_requests_order_id_status_created_at_idx`(`order_id`, `status`, `created_at`),
    INDEX `payment_reversal_requests_status_created_at_idx`(`status`, `created_at`),
    INDEX `payment_reversal_requests_requested_by_user_id_created_at_idx`(`requested_by_user_id`, `created_at`),
    INDEX `payment_reversal_requests_reviewed_by_user_id_reviewed_at_idx`(`reviewed_by_user_id`, `reviewed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_reversal_requests`
    ADD CONSTRAINT `payment_reversal_requests_order_id_fkey`
        FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_reversal_requests_requested_by_user_id_fkey`
        FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_reversal_requests_reviewed_by_user_id_fkey`
        FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
