ALTER TABLE `wallet_ledger_entries`
    MODIFY `source` ENUM(
        'legacy_balance_snapshot',
        'account_opening',
        'match_reward',
        'store_item_purchase',
        'store_bundle_purchase',
        'coin_grant',
        'admin_adjustment',
        'payment_topup',
        'payment_reversal'
    ) NOT NULL;

CREATE TABLE `payment_coin_lots` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `wallet_id` INTEGER NOT NULL,
    `grant_ledger_entry_id` INTEGER NOT NULL,
    `reversal_ledger_entry_id` INTEGER NULL,
    `granted_coin` INTEGER NOT NULL,
    `remaining_coin` INTEGER NOT NULL,
    `spent_coin` INTEGER NOT NULL DEFAULT 0,
    `reversed_coin` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    CONSTRAINT `payment_coin_lots_amounts_check` CHECK (
        `granted_coin` > 0
        AND `remaining_coin` >= 0
        AND `spent_coin` >= 0
        AND `reversed_coin` >= 0
        AND `granted_coin` = `remaining_coin` + `spent_coin` + `reversed_coin`
    ),
    UNIQUE INDEX `payment_coin_lots_order_id_key`(`order_id`),
    UNIQUE INDEX `payment_coin_lots_grant_ledger_entry_id_key`(`grant_ledger_entry_id`),
    UNIQUE INDEX `payment_coin_lots_reversal_ledger_entry_id_key`(`reversal_ledger_entry_id`),
    INDEX `payment_coin_lots_wallet_id_created_at_idx`(`wallet_id`, `created_at`),
    INDEX `payment_coin_lots_wallet_id_remaining_coin_created_at_idx`(`wallet_id`, `remaining_coin`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_coin_lot_allocations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `lot_id` CHAR(36) NOT NULL,
    `ledger_entry_id` INTEGER NOT NULL,
    `amount_coin` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT `payment_coin_lot_allocations_amount_check` CHECK (`amount_coin` > 0),
    UNIQUE INDEX `payment_coin_lot_allocations_lot_id_ledger_entry_id_key`(`lot_id`, `ledger_entry_id`),
    INDEX `payment_coin_lot_allocations_ledger_entry_id_idx`(`ledger_entry_id`),
    INDEX `payment_coin_lot_allocations_lot_id_created_at_idx`(`lot_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_coin_lots`
    ADD CONSTRAINT `payment_coin_lots_order_id_fkey`
        FOREIGN KEY (`order_id`) REFERENCES `payment_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_coin_lots_wallet_id_fkey`
        FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_coin_lots_grant_ledger_entry_id_fkey`
        FOREIGN KEY (`grant_ledger_entry_id`) REFERENCES `wallet_ledger_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_coin_lots_reversal_ledger_entry_id_fkey`
        FOREIGN KEY (`reversal_ledger_entry_id`) REFERENCES `wallet_ledger_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payment_coin_lot_allocations`
    ADD CONSTRAINT `payment_coin_lot_allocations_lot_id_fkey`
        FOREIGN KEY (`lot_id`) REFERENCES `payment_coin_lots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_coin_lot_allocations_ledger_entry_id_fkey`
        FOREIGN KEY (`ledger_entry_id`) REFERENCES `wallet_ledger_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
