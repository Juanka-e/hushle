INSERT INTO `system_settings` (
    `key`,
    `value`,
    `updated_by_user_id`,
    `created_at`,
    `updated_at`
)
VALUES (
    'payment_checkout_control',
    JSON_OBJECT(
        'schemaVersion', 1,
        'paused', TRUE,
        'rolloutPercent', 0,
        'revision', 0,
        'lastChangeReason', 'Checkout has not been activated by an operator.'
    ),
    NULL,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);
