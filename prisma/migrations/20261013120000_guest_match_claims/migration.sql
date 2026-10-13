-- CreateTable
CREATE TABLE `match_settlement_guest_seats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `settlement_id` INTEGER NOT NULL,
    `guest_player_id` VARCHAR(128) NOT NULL,
    `match_ended_at` DATETIME(3) NOT NULL,
    `status` ENUM('unclaimed', 'pending', 'settled', 'rejected', 'expired') NOT NULL DEFAULT 'unclaimed',
    `claim_user_id` INTEGER NULL,
    `claimed_at` DATETIME(3) NULL,
    `available_at` DATETIME(3) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(255) NULL,
    `outcome` VARCHAR(40) NULL,
    `match_result_id` INTEGER NULL,
    `coin_earned` INTEGER NULL,
    `settled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `match_settlement_guest_seats_guest_player_id_status_idx`(`guest_player_id`, `status`),
    INDEX `match_settlement_guest_seats_status_available_at_idx`(`status`, `available_at`),
    INDEX `match_settlement_guest_seats_claim_user_id_status_idx`(`claim_user_id`, `status`),
    UNIQUE INDEX `match_settlement_guest_seats_settlement_id_guest_player_id_key`(`settlement_id`, `guest_player_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `match_settlement_guest_seats` ADD CONSTRAINT `match_settlement_guest_seats_settlement_id_fkey` FOREIGN KEY (`settlement_id`) REFERENCES `match_settlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_settlement_guest_seats` ADD CONSTRAINT `match_settlement_guest_seats_claim_user_id_fkey` FOREIGN KEY (`claim_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

