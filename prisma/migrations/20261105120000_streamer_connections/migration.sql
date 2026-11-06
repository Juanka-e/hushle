-- CreateTable
CREATE TABLE `streamer_connections` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `platform` ENUM('twitch', 'kick') NOT NULL,
    `platform_user_id` VARCHAR(64) NOT NULL,
    `login` VARCHAR(64) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `avatar_url` VARCHAR(500) NULL,
    `channel_url` VARCHAR(255) NOT NULL,
    `scopes` VARCHAR(255) NOT NULL,
    `access_token_enc` TEXT NULL,
    `refresh_token_enc` TEXT NULL,
    `token_key_version` INTEGER NULL,
    `access_token_expires_at` DATETIME(3) NULL,
    `status` ENUM('active', 'needs_reconnect', 'revoked') NOT NULL DEFAULT 'active',
    `status_reason` VARCHAR(32) NULL,
    `last_validated_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `connected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `streamer_connections_status_last_used_at_idx`(`status`, `last_used_at`),
    UNIQUE INDEX `streamer_connections_platform_platform_user_id_key`(`platform`, `platform_user_id`),
    UNIQUE INDEX `streamer_connections_user_id_platform_key`(`user_id`, `platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `streamer_connections` ADD CONSTRAINT `streamer_connections_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

