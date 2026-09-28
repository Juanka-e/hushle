-- AlterTable
ALTER TABLE `email_outbox_messages`
    MODIFY `status` ENUM('pending', 'processing', 'sent', 'dead_letter') NOT NULL DEFAULT 'pending',
    ADD COLUMN `claim_token` CHAR(36) NULL,
    ADD COLUMN `claimed_at` DATETIME(3) NULL,
    ADD COLUMN `claim_expires_at` DATETIME(3) NULL,
    ADD COLUMN `manual_retry_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `last_manual_retry_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `email_outbox_messages_status_claim_expires_at_idx`
    ON `email_outbox_messages`(`status`, `claim_expires_at`);

-- CreateTable
CREATE TABLE `email_suppressions` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NULL,
    `normalized_email` VARCHAR(191) NOT NULL,
    `reason` ENUM('hard_bounce', 'complaint', 'manual') NOT NULL,
    `scope` ENUM('all', 'marketing') NOT NULL DEFAULT 'all',
    `source` VARCHAR(40) NOT NULL,
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_suppressions_normalized_email_key`(`normalized_email`),
    INDEX `email_suppressions_reason_created_at_idx`(`reason`, `created_at`),
    INDEX `email_suppressions_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_delivery_events` (
    `id` CHAR(36) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `provider_event_id` VARCHAR(191) NOT NULL,
    `event_type` ENUM('delivered', 'hard_bounce', 'complaint') NOT NULL,
    `normalized_email` VARCHAR(191) NOT NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_delivery_events_provider_provider_event_id_key`(`provider`, `provider_event_id`),
    INDEX `email_delivery_events_normalized_email_occurred_at_idx`(`normalized_email`, `occurred_at`),
    INDEX `email_delivery_events_event_type_occurred_at_idx`(`event_type`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `email_suppressions` ADD CONSTRAINT `email_suppressions_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
