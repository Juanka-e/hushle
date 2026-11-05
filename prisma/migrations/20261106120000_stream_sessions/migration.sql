-- CreateTable
CREATE TABLE `stream_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `connection_id` CHAR(36) NULL,
    `platform` ENUM('twitch', 'kick') NOT NULL,
    `status` ENUM('active', 'ended', 'interrupted') NOT NULL DEFAULT 'active',
    `settings` JSON NOT NULL,
    `view_key_hash` CHAR(64) NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `round_count` INTEGER NOT NULL DEFAULT 0,
    `summary` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `stream_sessions_user_id_status_idx`(`user_id`, `status`),
    UNIQUE INDEX `stream_sessions_view_key_hash_key`(`view_key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stream_round_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` CHAR(36) NOT NULL,
    `round` INTEGER NOT NULL,
    `word_id` INTEGER NULL,
    `outcome` ENUM('solved', 'timeout', 'passed') NOT NULL,
    `winner_platform_user_id` VARCHAR(64) NULL,
    `winner_name` VARCHAR(100) NULL,
    `solve_ms` INTEGER NULL,
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stream_round_results_session_id_round_key`(`session_id`, `round`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stream_sessions` ADD CONSTRAINT `stream_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stream_sessions` ADD CONSTRAINT `stream_sessions_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `streamer_connections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stream_round_results` ADD CONSTRAINT `stream_round_results_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `stream_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

