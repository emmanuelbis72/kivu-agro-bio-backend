INSERT INTO accounts (
  account_number,
  account_name,
  account_class,
  account_type,
  is_postable,
  is_active,
  ohada_category
)
VALUES (
  '627000',
  'Services bancaires et frais financiers',
  '6',
  'expense',
  TRUE,
  TRUE,
  'charges_externes'
)
ON CONFLICT (account_number)
DO UPDATE SET
  account_name = EXCLUDED.account_name,
  account_class = EXCLUDED.account_class,
  account_type = EXCLUDED.account_type,
  is_postable = TRUE,
  is_active = TRUE,
  ohada_category = COALESCE(accounts.ohada_category, EXCLUDED.ohada_category),
  updated_at = NOW();

WITH category_accounts AS (
  SELECT *
  FROM (
    VALUES
      ('frais_mobile_money', '627000'),
      ('frais_envoi_mobile_money', '627000'),
      ('frais_mpesa', '627000'),
      ('frais_airtel_money', '627000'),
      ('frais_orange_money', '627000'),
      ('frais_transaction', '627000')
  ) AS mapping(category, account_number)
),
resolved AS (
  SELECT
    category_accounts.category,
    accounts.id AS expense_account_id
  FROM category_accounts
  INNER JOIN accounts
    ON accounts.account_number = category_accounts.account_number
)
INSERT INTO expense_category_accounts (category, expense_account_id)
SELECT category, expense_account_id
FROM resolved
ON CONFLICT (category)
DO UPDATE SET
  expense_account_id = EXCLUDED.expense_account_id,
  updated_at = NOW();
