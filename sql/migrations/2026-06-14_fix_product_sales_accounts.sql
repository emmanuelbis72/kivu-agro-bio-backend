BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM accounts
    WHERE account_number = '701000'
      AND is_active = TRUE
      AND is_postable = TRUE
      AND (
        account_class LIKE '7%'
        OR LOWER(account_type) IN ('income', 'revenue')
      )
  ) THEN
    RAISE EXCEPTION 'Le compte de vente 701000 actif et mouvementable est requis.';
  END IF;
END
$$;

WITH default_sales_account AS (
  SELECT id
  FROM accounts
  WHERE account_number = '701000'
  LIMIT 1
)
UPDATE products p
SET
  sales_account_id = dsa.id,
  updated_at = NOW()
FROM default_sales_account dsa
WHERE p.sales_account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM accounts configured_account
    WHERE configured_account.id = p.sales_account_id
      AND configured_account.is_active = TRUE
      AND configured_account.is_postable = TRUE
      AND (
        configured_account.account_class LIKE '7%'
        OR LOWER(configured_account.account_type) IN ('income', 'revenue')
      )
  );

WITH default_sales_account AS (
  SELECT id
  FROM accounts
  WHERE account_number = '701000'
  LIMIT 1
)
UPDATE journal_entry_lines jel
SET
  account_id = dsa.id,
  description = 'Credit vente 701000'
FROM journal_entries je,
  accounts configured_account,
  default_sales_account dsa
WHERE je.id = jel.journal_entry_id
  AND configured_account.id = jel.account_id
  AND je.source_module = 'invoice'
  AND je.reference_type = 'invoice'
  AND je.status = 'posted'
  AND jel.credit > 0
  AND COALESCE(jel.description, '') ILIKE '%vente %'
  AND NOT (
    configured_account.account_class LIKE '7%'
    OR LOWER(configured_account.account_type) IN ('income', 'revenue')
  );

COMMIT;
