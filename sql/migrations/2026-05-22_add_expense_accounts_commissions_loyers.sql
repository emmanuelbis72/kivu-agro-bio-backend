CREATE TABLE IF NOT EXISTS expense_category_accounts (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL UNIQUE,
  expense_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO accounts (
  account_number,
  account_name,
  account_class,
  account_type,
  is_postable,
  is_active,
  ohada_category
)
VALUES
  (
    '622100',
    'Loyers et charges locatives',
    '6',
    'expense',
    TRUE,
    TRUE,
    'charges_externes'
  ),
  (
    '625200',
    'Commissions commerciales',
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
      ('loyer', '622100'),
      ('loyers', '622100'),
      ('commission', '625200'),
      ('commissions', '625200'),
      ('matieres_premieres', '601000'),
      ('matières_premières', '601000')
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
