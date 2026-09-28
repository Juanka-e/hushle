CREATE TABLE `announcement_translations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `announcement_id` INTEGER NOT NULL,
    `locale` VARCHAR(10) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `content` TEXT NOT NULL,
    `content_blocks` JSON NULL,

    UNIQUE INDEX `announcement_translations_announcement_id_locale_key`(`announcement_id`, `locale`),
    INDEX `announcement_translations_locale_announcement_id_idx`(`locale`, `announcement_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `announcement_translations_announcement_id_fkey`
        FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `announcement_translations` (
    `announcement_id`,
    `locale`,
    `title`,
    `content`,
    `content_blocks`
)
SELECT
    `id`,
    'tr',
    `title`,
    `content`,
    `content_blocks`
FROM `announcements`;

ALTER TABLE `words`
    DROP INDEX `words_word_text_key`,
    ADD COLUMN `locale` VARCHAR(10) NOT NULL DEFAULT 'tr' AFTER `word_text`,
    ADD UNIQUE INDEX `words_locale_word_text_key`(`locale`, `word_text`),
    ADD INDEX `words_locale_difficulty_idx`(`locale`, `difficulty`);

ALTER TABLE `categories`
    ADD COLUMN `locale` VARCHAR(10) NOT NULL DEFAULT 'tr' AFTER `is_visible`,
    ADD INDEX `categories_locale_is_visible_sort_order_idx`(`locale`, `is_visible`, `sort_order`);
