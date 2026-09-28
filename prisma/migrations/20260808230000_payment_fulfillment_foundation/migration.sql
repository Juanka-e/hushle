-- Keep real-money grants distinct from earned and manually granted coin.
ALTER TABLE `wallet_ledger_entries`
    MODIFY `source` ENUM(
        'legacy_balance_snapshot',
        'account_opening',
        'match_reward',
        'store_item_purchase',
        'store_bundle_purchase',
        'coin_grant',
        'admin_adjustment',
        'payment_topup'
    ) NOT NULL;
