ALTER TABLE `payment_checkout_consents`
    ADD COLUMN `buyer_data_policy_version` VARCHAR(80) NOT NULL DEFAULT 'buyer-data-v1'
    AFTER `distance_sales_notice_version`;
