ALTER TABLE `payment_fulfillments`
    ADD COLUMN `notification_sent_at` DATETIME(3) NULL AFTER `completed_at`;
