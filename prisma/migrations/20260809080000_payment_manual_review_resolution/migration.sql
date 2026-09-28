CREATE TABLE `payment_manual_review_cases` (
    `id` CHAR(36) NOT NULL,
    `reversal_id` CHAR(36) NOT NULL,
    `status` ENUM('open', 'resolved', 'waived') NOT NULL DEFAULT 'open',
    `reason_code` VARCHAR(80) NOT NULL,
    `unrecovered_coin` INTEGER NULL,
    `resolution_note` VARCHAR(500) NULL,
    `resolved_by_user_id` INTEGER NULL,
    `resolved_at` DATETIME(3) NULL,
    `notice_message` VARCHAR(500) NULL,
    `notice_sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    CONSTRAINT `payment_manual_review_cases_unrecovered_coin_check`
        CHECK (`unrecovered_coin` IS NULL OR `unrecovered_coin` >= 0),
    UNIQUE INDEX `payment_manual_review_cases_reversal_id_key`(`reversal_id`),
    INDEX `payment_manual_review_cases_status_created_at_idx`(`status`, `created_at`),
    INDEX `payment_manual_review_cases_reason_code_created_at_idx`(`reason_code`, `created_at`),
    INDEX `payment_manual_review_cases_resolved_by_user_id_resolved_at_idx`(`resolved_by_user_id`, `resolved_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_manual_review_cases`
    ADD CONSTRAINT `payment_manual_review_cases_reversal_id_fkey`
        FOREIGN KEY (`reversal_id`) REFERENCES `payment_reversals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `payment_manual_review_cases_resolved_by_user_id_fkey`
        FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `payment_manual_review_cases` (
    `id`,
    `reversal_id`,
    `status`,
    `reason_code`,
    `unrecovered_coin`,
    `created_at`,
    `updated_at`
)
SELECT
    UUID(),
    `id`,
    'open',
    CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(`evidence`, '$.policy')) = 'exact_payment_lot_reversal'
            THEN 'coin_spent_unrecovered'
        WHEN JSON_UNQUOTE(JSON_EXTRACT(`evidence`, '$.policy')) = 'legacy_manual_review_no_wallet_mutation'
            THEN 'legacy_coin_provenance_missing'
        ELSE 'manual_reversal_review'
    END,
    CASE
        WHEN JSON_EXTRACT(`evidence`, '$.unrecoveredCoin') IS NULL THEN NULL
        ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(`evidence`, '$.unrecoveredCoin')) AS UNSIGNED)
    END,
    `created_at`,
    CURRENT_TIMESTAMP(3)
FROM `payment_reversals`
WHERE `status` = 'manual_review';
