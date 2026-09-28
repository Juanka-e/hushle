ALTER TABLE `payment_provider_refund_attempts`
    ADD COLUMN `provider_refund_reference` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `payment_provider_refund_attempts_provider_ref_key`
    ON `payment_provider_refund_attempts`(`provider`, `provider_refund_reference`);
