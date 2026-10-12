-- AlterTable
ALTER TABLE `match_results` ADD COLUMN `end_reason` ENUM('completed', 'host_ended') NOT NULL DEFAULT 'completed';

-- CreateTable
CREATE TABLE `match_settlements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `room_code` VARCHAR(12) NOT NULL,
    `match_started_at` DATETIME(3) NOT NULL,
    `match_ended_at` DATETIME(3) NOT NULL,
    `end_reason` ENUM('completed', 'host_ended') NOT NULL DEFAULT 'completed',
    `snapshot_version` INTEGER NOT NULL DEFAULT 1,
    `snapshot` JSON NOT NULL,
    `registered_participant_count` INTEGER NOT NULL DEFAULT 0,
    `guest_participant_count` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('pending', 'processing', 'settled', 'dead_letter') NOT NULL DEFAULT 'pending',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_attempt_at` DATETIME(3) NULL,
    `last_error` VARCHAR(255) NULL,
    `claim_token` CHAR(36) NULL,
    `claim_expires_at` DATETIME(3) NULL,
    `settled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `match_settlements_status_available_at_idx`(`status`, `available_at`),
    INDEX `match_settlements_status_claim_expires_at_idx`(`status`, `claim_expires_at`),
    INDEX `match_settlements_status_settled_at_idx`(`status`, `settled_at`),
    UNIQUE INDEX `match_settlements_room_code_match_started_at_key`(`room_code`, `match_started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

