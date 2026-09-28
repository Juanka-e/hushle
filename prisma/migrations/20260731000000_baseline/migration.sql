-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(191) NULL,
    `normalized_email` VARCHAR(191) NULL,
    `email_verified_at` DATETIME(3) NULL,
    `email_verification_required_at` DATETIME(3) NULL,
    `pending_email` VARCHAR(191) NULL,
    `pending_normalized_email` VARCHAR(191) NULL,
    `pending_email_requested_at` DATETIME(3) NULL,
    `account_status` ENUM('active', 'pending_email_verification') NOT NULL DEFAULT 'active',
    `password` VARCHAR(255) NOT NULL,
    `session_version` INTEGER NOT NULL DEFAULT 0,
    `role` VARCHAR(20) NOT NULL DEFAULT 'user',
    `is_suspended` BOOLEAN NOT NULL DEFAULT false,
    `suspended_at` DATETIME(3) NULL,
    `suspended_until` DATETIME(3) NULL,
    `suspension_reason` VARCHAR(300) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `last_trusted_ip` VARCHAR(64) NULL,
    `last_user_agent` VARCHAR(255) NULL,
    `registered_trusted_ip` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_normalized_email_key`(`normalized_email`),
    UNIQUE INDEX `users_pending_normalized_email_key`(`pending_normalized_email`),
    INDEX `users_email_verified_at_idx`(`email_verified_at`),
    INDEX `users_account_status_email_verification_required_at_idx`(`account_status`, `email_verification_required_at`),
    INDEX `users_is_suspended_suspended_until_idx`(`is_suspended`, `suspended_until`),
    INDEX `users_last_seen_at_idx`(`last_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mobile_auth_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `device_name` VARCHAR(80) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `refresh_expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(64) NULL,

    INDEX `mobile_auth_sessions_user_id_revoked_at_last_seen_at_idx`(`user_id`, `revoked_at`, `last_seen_at`),
    INDEX `mobile_auth_sessions_refresh_expires_at_idx`(`refresh_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mobile_auth_tokens` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `kind` ENUM('access', 'refresh') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `rotation_counter` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `mobile_auth_tokens_token_hash_key`(`token_hash`),
    INDEX `mobile_auth_tokens_session_id_kind_revoked_at_expires_at_idx`(`session_id`, `kind`, `revoked_at`, `expires_at`),
    INDEX `mobile_auth_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_verification_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `email_snapshot` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_verification_tokens_token_hash_key`(`token_hash`),
    INDEX `email_verification_tokens_user_id_consumed_at_revoked_at_exp_idx`(`user_id`, `consumed_at`, `revoked_at`, `expires_at`),
    INDEX `email_verification_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_token_hash_key`(`token_hash`),
    INDEX `password_reset_tokens_user_id_consumed_at_revoked_at_expires_idx`(`user_id`, `consumed_at`, `revoked_at`, `expires_at`),
    INDEX `password_reset_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_change_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `email_snapshot` VARCHAR(191) NOT NULL,
    `normalized_email_snapshot` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_change_tokens_token_hash_key`(`token_hash`),
    INDEX `email_change_tokens_user_id_consumed_at_revoked_at_expires_a_idx`(`user_id`, `consumed_at`, `revoked_at`, `expires_at`),
    INDEX `email_change_tokens_normalized_email_snapshot_expires_at_idx`(`normalized_email_snapshot`, `expires_at`),
    INDEX `email_change_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_outbox_messages` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NULL,
    `deduplication_key` VARCHAR(191) NOT NULL,
    `message_class` ENUM('transactional', 'marketing') NOT NULL,
    `template` VARCHAR(80) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('pending', 'sent', 'dead_letter') NOT NULL DEFAULT 'pending',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_attempt_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `last_error` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_outbox_messages_deduplication_key_key`(`deduplication_key`),
    INDEX `email_outbox_messages_status_available_at_created_at_idx`(`status`, `available_at`, `created_at`),
    INDEX `email_outbox_messages_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `email_outbox_messages_message_class_status_created_at_idx`(`message_class`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_moderation_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `target_user_id` INTEGER NOT NULL,
    `actor_user_id` INTEGER NULL,
    `action_type` ENUM('suspend', 'reactivate', 'note') NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `suspended_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_moderation_events_target_user_id_created_at_idx`(`target_user_id`, `created_at`),
    INDEX `user_moderation_events_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `user_moderation_events_action_type_created_at_idx`(`action_type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actor_user_id` INTEGER NULL,
    `actor_role` VARCHAR(20) NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `resource_type` VARCHAR(80) NOT NULL,
    `resource_id` VARCHAR(120) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `summary` VARCHAR(255) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    INDEX `audit_logs_resource_type_created_at_idx`(`resource_type`, `created_at`),
    INDEX `audit_logs_resource_type_resource_id_idx`(`resource_type`, `resource_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log_archives` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `original_audit_log_id` INTEGER NOT NULL,
    `actor_user_id` INTEGER NULL,
    `actor_username` VARCHAR(50) NULL,
    `actor_role` VARCHAR(20) NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `resource_type` VARCHAR(80) NOT NULL,
    `resource_id` VARCHAR(120) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `summary` VARCHAR(255) NULL,
    `metadata` JSON NULL,
    `original_created_at` DATETIME(3) NOT NULL,
    `archived_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `audit_log_archives_original_audit_log_id_key`(`original_audit_log_id`),
    INDEX `audit_log_archives_actor_user_id_original_created_at_idx`(`actor_user_id`, `original_created_at`),
    INDEX `audit_log_archives_actor_role_original_created_at_idx`(`actor_role`, `original_created_at`),
    INDEX `audit_log_archives_action_original_created_at_idx`(`action`, `original_created_at`),
    INDEX `audit_log_archives_resource_type_original_created_at_idx`(`resource_type`, `original_created_at`),
    INDEX `audit_log_archives_resource_type_resource_id_idx`(`resource_type`, `resource_id`),
    INDEX `audit_log_archives_archived_at_idx`(`archived_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(80) NOT NULL,
    `value` JSON NOT NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `system_settings_updated_by_user_id_idx`(`updated_by_user_id`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `display_name` VARCHAR(60) NULL,
    `bio` VARCHAR(300) NULL,
    `avatar_item_id` INTEGER NULL,
    `frame_item_id` INTEGER NULL,
    `card_back_item_id` INTEGER NULL,
    `card_face_item_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `coin_balance` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wallets_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_ledger_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wallet_id` INTEGER NOT NULL,
    `source` ENUM('legacy_balance_snapshot', 'account_opening', 'match_reward', 'store_item_purchase', 'store_bundle_purchase', 'coin_grant', 'admin_adjustment') NOT NULL,
    `delta_coin` INTEGER NOT NULL,
    `balance_before` INTEGER NOT NULL,
    `balance_after` INTEGER NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `reference_type` VARCHAR(80) NULL,
    `reference_id` VARCHAR(120) NULL,
    `actor_user_id` INTEGER NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wallet_ledger_entries_idempotency_key_key`(`idempotency_key`),
    INDEX `wallet_ledger_entries_wallet_id_created_at_idx`(`wallet_id`, `created_at`),
    INDEX `wallet_ledger_entries_source_created_at_idx`(`source`, `created_at`),
    INDEX `wallet_ledger_entries_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    INDEX `wallet_ledger_entries_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `target_user_id` INTEGER NOT NULL,
    `actor_user_id` INTEGER NULL,
    `adjustment_type` ENUM('credit', 'debit') NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `balance_before` INTEGER NOT NULL,
    `balance_after` INTEGER NOT NULL,
    `ledger_entry_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wallet_adjustments_ledger_entry_id_key`(`ledger_entry_id`),
    INDEX `wallet_adjustments_target_user_id_created_at_idx`(`target_user_id`, `created_at`),
    INDEX `wallet_adjustments_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `wallet_adjustments_adjustment_type_created_at_idx`(`adjustment_type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coin_grant_campaigns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(300) NULL,
    `coin_amount` INTEGER NOT NULL,
    `total_budget_coin` INTEGER NULL,
    `total_granted_coin` INTEGER NOT NULL DEFAULT 0,
    `total_claim_limit` INTEGER NULL,
    `total_claim_count` INTEGER NOT NULL DEFAULT 0,
    `per_user_claim_limit` INTEGER NOT NULL DEFAULT 1,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coin_grant_campaigns_code_key`(`code`),
    INDEX `coin_grant_campaigns_is_active_archived_at_starts_at_ends_at_idx`(`is_active`, `archived_at`, `starts_at`, `ends_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coin_grant_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` INTEGER NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `label` VARCHAR(120) NULL,
    `max_claims` INTEGER NULL,
    `claim_count` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `coin_grant_codes_code_key`(`code`),
    INDEX `coin_grant_codes_campaign_id_is_active_archived_at_idx`(`campaign_id`, `is_active`, `archived_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coin_grant_campaign_users` (
    `campaign_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `claim_count` INTEGER NOT NULL DEFAULT 0,
    `granted_coin` INTEGER NOT NULL DEFAULT 0,
    `last_claim_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `coin_grant_campaign_users_user_id_last_claim_at_idx`(`user_id`, `last_claim_at`),
    PRIMARY KEY (`campaign_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coin_grant_claims` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` INTEGER NOT NULL,
    `code_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `status` ENUM('completed') NOT NULL DEFAULT 'completed',
    `coin_amount` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `coin_grant_claims_campaign_id_created_at_idx`(`campaign_id`, `created_at`),
    INDEX `coin_grant_claims_code_id_created_at_idx`(`code_id`, `created_at`),
    INDEX `coin_grant_claims_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `assigned_admin_user_id` INTEGER NULL,
    `category` ENUM('account', 'gameplay', 'store', 'rewards', 'bug', 'report', 'other') NOT NULL,
    `priority` ENUM('low', 'normal', 'high') NOT NULL DEFAULT 'normal',
    `status` ENUM('open', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    `subject` VARCHAR(160) NOT NULL,
    `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_public_reply_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `support_tickets_user_id_status_updated_at_idx`(`user_id`, `status`, `updated_at`),
    INDEX `support_tickets_assigned_admin_user_id_status_updated_at_idx`(`assigned_admin_user_id`, `status`, `updated_at`),
    INDEX `support_tickets_status_priority_last_message_at_idx`(`status`, `priority`, `last_message_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_ticket_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticket_id` INTEGER NOT NULL,
    `author_user_id` INTEGER NULL,
    `is_internal` BOOLEAN NOT NULL DEFAULT false,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_ticket_messages_ticket_id_created_at_idx`(`ticket_id`, `created_at`),
    INDEX `support_ticket_messages_author_user_id_created_at_idx`(`author_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('system', 'support_reply', 'support_status', 'economy', 'moderation') NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `resource_type` VARCHAR(80) NULL,
    `resource_id` VARCHAR(120) NULL,
    `action_label` VARCHAR(40) NULL,
    `action_href` VARCHAR(255) NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `read_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_is_read_archived_at_created_at_idx`(`user_id`, `is_read`, `archived_at`, `created_at`),
    INDEX `notifications_user_id_type_created_at_idx`(`user_id`, `type`, `created_at`),
    INDEX `notifications_resource_type_resource_id_idx`(`resource_type`, `resource_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shop_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `type` ENUM('avatar', 'frame', 'card_back', 'card_face') NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `rarity` ENUM('common', 'rare', 'epic', 'legendary') NOT NULL DEFAULT 'common',
    `render_mode` ENUM('image', 'template') NOT NULL DEFAULT 'image',
    `render_spec_version` INTEGER NOT NULL DEFAULT 1,
    `price_coin` INTEGER NOT NULL,
    `image_url` TEXT NOT NULL,
    `thumbnail_url` TEXT NULL,
    `template_key` VARCHAR(80) NULL,
    `template_config` JSON NULL,
    `badge_text` VARCHAR(24) NULL,
    `availability_mode` ENUM('always_on', 'scheduled', 'seasonal', 'limited', 'event_only') NOT NULL DEFAULT 'always_on',
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `is_featured` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shop_items_code_key`(`code`),
    INDEX `shop_items_is_active_availability_mode_starts_at_ends_at_sor_idx`(`is_active`, `availability_mode`, `starts_at`, `ends_at`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shop_bundles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(300) NULL,
    `price_coin` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shop_bundles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shop_bundle_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bundle_id` INTEGER NOT NULL,
    `shop_item_id` INTEGER NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shop_bundle_items_bundle_id_sort_order_idx`(`bundle_id`, `sort_order`),
    UNIQUE INDEX `shop_bundle_items_bundle_id_shop_item_id_key`(`bundle_id`, `shop_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `discount_campaigns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(300) NULL,
    `target_type` ENUM('global', 'shop_item', 'bundle') NOT NULL DEFAULT 'global',
    `discount_type` ENUM('percentage', 'fixed_coin') NOT NULL,
    `percentage_off` INTEGER NULL,
    `fixed_coin_off` INTEGER NULL,
    `shop_item_id` INTEGER NULL,
    `bundle_id` INTEGER NULL,
    `usage_limit` INTEGER NULL,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `stackable_with_coupon` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `discount_campaigns_code_key`(`code`),
    INDEX `discount_campaigns_target_type_is_active_idx`(`target_type`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupon_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(300) NULL,
    `target_type` ENUM('global', 'shop_item', 'bundle') NOT NULL DEFAULT 'global',
    `discount_type` ENUM('percentage', 'fixed_coin') NOT NULL,
    `percentage_off` INTEGER NULL,
    `fixed_coin_off` INTEGER NULL,
    `shop_item_id` INTEGER NULL,
    `bundle_id` INTEGER NULL,
    `usage_limit` INTEGER NULL,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupon_codes_code_key`(`code`),
    INDEX `coupon_codes_target_type_is_active_idx`(`target_type`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `shop_item_id` INTEGER NOT NULL,
    `source` ENUM('purchase', 'grant', 'migration') NOT NULL DEFAULT 'purchase',
    `render_snapshot` JSON NULL,
    `acquired_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_items_user_id_idx`(`user_id`),
    UNIQUE INDEX `inventory_items_user_id_shop_item_id_key`(`user_id`, `shop_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `shop_item_id` INTEGER NULL,
    `bundle_id` INTEGER NULL,
    `coupon_code_id` INTEGER NULL,
    `price_coin` INTEGER NOT NULL,
    `list_price_coin` INTEGER NULL,
    `discount_coin` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('completed', 'reverted') NOT NULL DEFAULT 'completed',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchases_user_id_idx`(`user_id`),
    INDEX `purchases_bundle_id_idx`(`bundle_id`),
    INDEX `purchases_coupon_code_id_idx`(`coupon_code_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `room_code` VARCHAR(12) NOT NULL,
    `match_started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `match_ended_at` DATETIME(3) NULL,
    `match_duration_seconds` INTEGER NULL,
    `match_format` VARCHAR(20) NULL,
    `match_target` INTEGER NULL,
    `game_type` VARCHAR(30) NOT NULL DEFAULT 'tabu',
    `user_id` INTEGER NOT NULL,
    `player_id` VARCHAR(64) NOT NULL,
    `team` VARCHAR(1) NULL,
    `won` BOOLEAN NOT NULL,
    `score_a` INTEGER NOT NULL,
    `score_b` INTEGER NOT NULL,
    `coin_earned` INTEGER NOT NULL DEFAULT 0,
    `lineup_key` VARCHAR(96) NULL,
    `lineup_player_count` INTEGER NOT NULL DEFAULT 0,
    `lineup_authenticated_count` INTEGER NOT NULL DEFAULT 0,
    `lineup_guest_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `match_results_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `match_results_user_id_lineup_key_created_at_idx`(`user_id`, `lineup_key`, `created_at`),
    UNIQUE INDEX `match_results_room_code_user_id_match_started_at_key`(`room_code`, `user_id`, `match_started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guest_progress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `player_id` VARCHAR(64) NOT NULL,
    `earned_coin_snapshot` INTEGER NOT NULL DEFAULT 0,
    `linked_user_id` INTEGER NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `guest_progress_player_id_key`(`player_id`),
    INDEX `guest_progress_linked_user_id_idx`(`linked_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `words` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `word_text` VARCHAR(255) NOT NULL,
    `difficulty` TINYINT NOT NULL,

    UNIQUE INDEX `words_word_text_key`(`word_text`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `taboo_words` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `word_id` INTEGER NOT NULL,
    `taboo_word_text` VARCHAR(255) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `parent_id` INTEGER NULL,
    `color` VARCHAR(7) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_visible` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `word_categories` (
    `word_id` INTEGER NOT NULL,
    `category_id` INTEGER NOT NULL,

    PRIMARY KEY (`word_id`, `category_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NOT NULL,
    `content` TEXT NOT NULL,
    `content_blocks` JSON NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'guncelleme',
    `is_visible` BOOLEAN NOT NULL DEFAULT true,
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `version` VARCHAR(50) NULL,
    `tags` TEXT NULL,
    `media_url` TEXT NULL,
    `media_type` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `mobile_auth_sessions` ADD CONSTRAINT `mobile_auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mobile_auth_tokens` ADD CONSTRAINT `mobile_auth_tokens_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `mobile_auth_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_change_tokens` ADD CONSTRAINT `email_change_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_outbox_messages` ADD CONSTRAINT `email_outbox_messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_moderation_events` ADD CONSTRAINT `user_moderation_events_target_user_id_fkey` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_moderation_events` ADD CONSTRAINT `user_moderation_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_avatar_item_id_fkey` FOREIGN KEY (`avatar_item_id`) REFERENCES `shop_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_frame_item_id_fkey` FOREIGN KEY (`frame_item_id`) REFERENCES `shop_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_card_back_item_id_fkey` FOREIGN KEY (`card_back_item_id`) REFERENCES `shop_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_card_face_item_id_fkey` FOREIGN KEY (`card_face_item_id`) REFERENCES `shop_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_ledger_entries` ADD CONSTRAINT `wallet_ledger_entries_wallet_id_fkey` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_ledger_entries` ADD CONSTRAINT `wallet_ledger_entries_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_adjustments` ADD CONSTRAINT `wallet_adjustments_target_user_id_fkey` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_adjustments` ADD CONSTRAINT `wallet_adjustments_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_adjustments` ADD CONSTRAINT `wallet_adjustments_ledger_entry_id_fkey` FOREIGN KEY (`ledger_entry_id`) REFERENCES `wallet_ledger_entries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coin_grant_codes` ADD CONSTRAINT `coin_grant_codes_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `coin_grant_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coin_grant_campaign_users` ADD CONSTRAINT `coin_grant_campaign_users_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `coin_grant_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coin_grant_campaign_users` ADD CONSTRAINT `coin_grant_campaign_users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coin_grant_claims` ADD CONSTRAINT `coin_grant_claims_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `coin_grant_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coin_grant_claims` ADD CONSTRAINT `coin_grant_claims_code_id_fkey` FOREIGN KEY (`code_id`) REFERENCES `coin_grant_codes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coin_grant_claims` ADD CONSTRAINT `coin_grant_claims_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_assigned_admin_user_id_fkey` FOREIGN KEY (`assigned_admin_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_author_user_id_fkey` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shop_bundle_items` ADD CONSTRAINT `shop_bundle_items_bundle_id_fkey` FOREIGN KEY (`bundle_id`) REFERENCES `shop_bundles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shop_bundle_items` ADD CONSTRAINT `shop_bundle_items_shop_item_id_fkey` FOREIGN KEY (`shop_item_id`) REFERENCES `shop_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discount_campaigns` ADD CONSTRAINT `discount_campaigns_shop_item_id_fkey` FOREIGN KEY (`shop_item_id`) REFERENCES `shop_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discount_campaigns` ADD CONSTRAINT `discount_campaigns_bundle_id_fkey` FOREIGN KEY (`bundle_id`) REFERENCES `shop_bundles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_codes` ADD CONSTRAINT `coupon_codes_shop_item_id_fkey` FOREIGN KEY (`shop_item_id`) REFERENCES `shop_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coupon_codes` ADD CONSTRAINT `coupon_codes_bundle_id_fkey` FOREIGN KEY (`bundle_id`) REFERENCES `shop_bundles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_shop_item_id_fkey` FOREIGN KEY (`shop_item_id`) REFERENCES `shop_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_shop_item_id_fkey` FOREIGN KEY (`shop_item_id`) REFERENCES `shop_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_bundle_id_fkey` FOREIGN KEY (`bundle_id`) REFERENCES `shop_bundles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_coupon_code_id_fkey` FOREIGN KEY (`coupon_code_id`) REFERENCES `coupon_codes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_results` ADD CONSTRAINT `match_results_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_progress` ADD CONSTRAINT `guest_progress_linked_user_id_fkey` FOREIGN KEY (`linked_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taboo_words` ADD CONSTRAINT `taboo_words_word_id_fkey` FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `word_categories` ADD CONSTRAINT `word_categories_word_id_fkey` FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `word_categories` ADD CONSTRAINT `word_categories_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
