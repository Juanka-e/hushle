ALTER TABLE `users`
    MODIFY `password` VARCHAR(255) NULL;

CREATE TABLE `oauth_accounts` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `provider_account_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `oauth_accounts_provider_provider_account_id_key`(`provider`, `provider_account_id`),
    UNIQUE INDEX `oauth_accounts_user_id_provider_key`(`user_id`, `provider`),
    INDEX `oauth_accounts_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `oauth_accounts`
    ADD CONSTRAINT `oauth_accounts_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
