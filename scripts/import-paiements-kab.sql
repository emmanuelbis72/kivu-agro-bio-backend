BEGIN;

CREATE TABLE IF NOT EXISTS unallocated_payments (
  id SERIAL PRIMARY KEY,
  import_key VARCHAR(120) NOT NULL UNIQUE,
  source_file TEXT NOT NULL,
  source_sheet VARCHAR(120),
  source_row INTEGER,
  raw_customer_name TEXT NOT NULL,
  matched_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  payment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'unknown',
  reference TEXT,
  notes TEXT,
  allocation_state VARCHAR(30) NOT NULL DEFAULT 'pending',
  allocated_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  allocated_payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT unallocated_payments_amount_chk CHECK (amount > 0),
  CONSTRAINT unallocated_payments_allocation_state_chk CHECK (
    allocation_state IN ('pending', 'allocated', 'ignored')
  )
);

CREATE INDEX IF NOT EXISTS idx_unallocated_payments_state
  ON unallocated_payments (allocation_state);

CREATE INDEX IF NOT EXISTS idx_unallocated_payments_customer
  ON unallocated_payments (matched_customer_id);

CREATE INDEX IF NOT EXISTS idx_unallocated_payments_date
  ON unallocated_payments (payment_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unallocated_payments_reference_unique
  ON unallocated_payments (reference)
  WHERE reference IS NOT NULL;

WITH source_payments (
  source_sheet,
  source_row,
  raw_customer_name,
  matched_customer_name,
  payment_date,
  amount,
  reference
) AS (
  VALUES
    ('Feuil1', 3, 'SWISSMART LSHI', 'SWISSMART LSHI', DATE '2026-01-05', 1450.00, 'PAIEMENT-KAB-Feuil1-3'),
    ('Feuil1', 4, 'GG MART', 'GGMART SELECT', DATE '2026-01-03', 1850.00, 'PAIEMENT-KAB-Feuil1-4'),
    ('Feuil1', 5, 'CARREFOUR KIN', NULL, DATE '2026-01-05', 1750.00, 'PAIEMENT-KAB-Feuil1-5'),
    ('Feuil1', 6, 'CARREFOUR LSHI', 'HYPER PSARO CARREFOUR LSHI', DATE '2026-01-08', 5200.00, 'PAIEMENT-KAB-Feuil1-6'),
    ('Feuil1', 7, 'GG MART', 'GGMART SELECT', DATE '2026-01-10', 1300.00, 'PAIEMENT-KAB-Feuil1-7'),
    ('Feuil1', 8, 'SWISSMART', 'SWISSMART GB', DATE '2026-01-14', 1000.00, 'PAIEMENT-KAB-Feuil1-8'),
    ('Feuil1', 9, 'KIN MART', 'KIN MART', DATE '2026-01-14', 1200.00, 'PAIEMENT-KAB-Feuil1-9'),
    ('Feuil1', 10, 'PHARMACIES LA DIVINE', NULL, DATE '2026-01-10', 960.00, 'PAIEMENT-KAB-Feuil1-10'),
    ('Feuil1', 11, 'GG MART', 'GGMART SELECT', DATE '2026-01-16', 2276.00, 'PAIEMENT-KAB-Feuil1-11'),
    ('Feuil1', 12, 'KSC SUPERMARCHE', 'KSC SUPERMARCHE', DATE '2026-01-20', 1000.00, 'PAIEMENT-KAB-Feuil1-12'),
    ('Feuil1', 13, 'GG MART', 'GGMART SELECT', DATE '2025-01-30', 4775.00, 'PAIEMENT-KAB-Feuil1-13'),
    ('Feuil1', 14, 'KIN MARCHE', NULL, DATE '2026-01-10', 1000.00, 'PAIEMENT-KAB-Feuil1-14'),
    ('Feuil1', 15, 'GG MART', 'GGMART SELECT', DATE '2026-01-28', 3500.00, 'PAIEMENT-KAB-Feuil1-15'),
    ('Feuil1', 16, 'MONISHOP', 'MONISHOP', DATE '2026-02-05', 1500.00, 'PAIEMENT-KAB-Feuil1-16'),
    ('Feuil1', 17, 'SWISSMART', 'SWISSMART GB', DATE '2025-02-07', 500.00, 'PAIEMENT-KAB-Feuil1-17'),
    ('Feuil1', 18, 'CARREFOUR LSHI', 'HYPER PSARO CARREFOUR LSHI', DATE '2025-02-10', 1530.00, 'PAIEMENT-KAB-Feuil1-18'),
    ('Feuil1', 19, 'CARREFOUR KIN', NULL, DATE '2026-02-20', 1700.00, 'PAIEMENT-KAB-Feuil1-19'),
    ('Feuil1', 20, 'KSC SUPERMARCHE', 'KSC SUPERMARCHE', DATE '2025-03-05', 1000.00, 'PAIEMENT-KAB-Feuil1-20'),
    ('Feuil1', 21, 'KSC SUPERMARCHE', 'KSC SUPERMARCHE', DATE '2026-03-05', 500.00, 'PAIEMENT-KAB-Feuil1-21'),
    ('Feuil1', 22, 'CARREFOUR KIN', NULL, DATE '2026-03-05', 1000.00, 'PAIEMENT-KAB-Feuil1-22'),
    ('Feuil1', 23, 'SUPERMARCHES SK', 'SK', DATE '2026-03-12', 1500.00, 'PAIEMENT-KAB-Feuil1-23'),
    ('Feuil1', 24, 'PHARMACIES LA DIVINE', NULL, DATE '2026-03-12', 1360.00, 'PAIEMENT-KAB-Feuil1-24'),
    ('Feuil1', 25, 'GG MART', 'GGMART SELECT', DATE '2026-03-12', 2000.00, 'PAIEMENT-KAB-Feuil1-25'),
    ('Feuil1', 26, 'GG MART', 'GGMART SELECT', DATE '2026-03-14', 1543.00, 'PAIEMENT-KAB-Feuil1-26'),
    ('Feuil1', 27, 'GG MART', 'GGMART SELECT', DATE '2026-03-14', 1800.00, 'PAIEMENT-KAB-Feuil1-27'),
    ('Feuil1', 28, 'SWISSMART', 'SWISSMART GB', DATE '2026-03-15', 1000.00, 'PAIEMENT-KAB-Feuil1-28'),
    ('Feuil1', 29, 'PRIMA', 'PRIMA KINSHASA MALL', DATE '2026-03-18', 1000.00, 'PAIEMENT-KAB-Feuil1-29'),
    ('Feuil1', 30, 'GG MART', 'GGMART SELECT', DATE '2026-03-25', 2500.00, 'PAIEMENT-KAB-Feuil1-30'),
    ('Feuil1', 31, 'SUPERMARCHES SK', 'SK', DATE '2026-03-24', 1500.00, 'PAIEMENT-KAB-Feuil1-31'),
    ('Feuil1', 32, 'PRIMA', 'PRIMA KINSHASA MALL', DATE '2026-03-27', 700.00, 'PAIEMENT-KAB-Feuil1-32'),
    ('Feuil1', 33, 'SBN SUPERMARCHE', 'SBN SUPERMARCHÉ', DATE '2026-03-27', 400.00, 'PAIEMENT-KAB-Feuil1-33'),
    ('Feuil1', 34, 'REGAL', 'REGAL BOULEVARD', DATE '2026-03-27', 508.00, 'PAIEMENT-KAB-Feuil1-34'),
    ('Feuil1', 35, 'SWISSMART', 'SWISSMART GB', DATE '2026-03-27', 500.00, 'PAIEMENT-KAB-Feuil1-35'),
    ('Feuil1', 36, 'SWISSMART LSHI', 'SWISSMART LSHI', DATE '2026-03-28', 1850.00, 'PAIEMENT-KAB-Feuil1-36'),
    ('Feuil1', 37, 'CARREFOUR LSHI', 'HYPER PSARO CARREFOUR LSHI', DATE '2026-03-30', 2700.00, 'PAIEMENT-KAB-Feuil1-37'),
    ('Feuil1', 38, 'SUPERMARCHES SK', 'SK', DATE '2026-03-31', 2000.00, 'PAIEMENT-KAB-Feuil1-38'),
    ('Feuil1', 39, 'AMIGO GOMA', 'AMIGO Goma', DATE '2026-04-02', 540.00, 'PAIEMENT-KAB-Feuil1-39'),
    ('Feuil1', 40, 'PRIMA', 'PRIMA KINSHASA MALL', DATE '2026-04-01', 1000.00, 'PAIEMENT-KAB-Feuil1-40'),
    ('Feuil1', 41, 'GG MART', 'GGMART SELECT', DATE '2026-04-02', 3120.00, 'PAIEMENT-KAB-Feuil1-41'),
    ('Feuil1', 42, 'GG MART', 'GGMART SELECT', DATE '2026-04-05', 1086.00, 'PAIEMENT-KAB-Feuil1-42'),
    ('Feuil1', 43, 'GG MART', 'GGMART SELECT', DATE '2026-04-09', 3513.00, 'PAIEMENT-KAB-Feuil1-43'),
    ('Feuil1', 44, 'CARREFOUR LSHI', 'HYPER PSARO CARREFOUR LSHI', DATE '2026-04-20', 1650.00, 'PAIEMENT-KAB-Feuil1-44'),
    ('Feuil1', 45, 'GG MART', 'GGMART SELECT', DATE '2026-04-11', 1160.00, 'PAIEMENT-KAB-Feuil1-45'),
    ('Feuil1', 46, 'LIVRAISON A DOMICILE KINSHASA', NULL, DATE '2026-04-24', 1500.00, 'PAIEMENT-KAB-Feuil1-46'),
    ('Feuil1', 47, 'PHARMACIES LA DIVINE', NULL, DATE '2026-04-15', 485.00, 'PAIEMENT-KAB-Feuil1-47')
),
prepared_payments AS (
  SELECT
    'paiement-kab-' || source_sheet || '-' || source_row AS import_key,
    'PAIEMENT KAB.xlsx' AS source_file,
    source_sheet,
    source_row,
    raw_customer_name,
    (
      SELECT c.id
      FROM customers c
      WHERE matched_customer_name IS NOT NULL
        AND LOWER(TRIM(c.business_name)) = LOWER(TRIM(matched_customer_name))
      ORDER BY c.id ASC
      LIMIT 1
    ) AS matched_customer_id,
    payment_date,
    amount,
    reference,
    jsonb_build_object(
      'customer_name', raw_customer_name,
      'matched_customer_name', matched_customer_name,
      'payment_date', payment_date,
      'amount', amount,
      'source', 'PAIEMENT KAB.xlsx'
    ) AS raw_payload
  FROM source_payments
)
INSERT INTO unallocated_payments (
  import_key,
  source_file,
  source_sheet,
  source_row,
  raw_customer_name,
  matched_customer_id,
  payment_date,
  amount,
  payment_method,
  reference,
  notes,
  raw_payload
)
SELECT
  import_key,
  source_file,
  source_sheet,
  source_row,
  raw_customer_name,
  matched_customer_id,
  payment_date,
  amount,
  'unknown',
  reference,
  'Import SQL depuis PAIEMENT KAB.xlsx - en attente de rapprochement facture',
  raw_payload
FROM prepared_payments
ON CONFLICT (reference) WHERE reference IS NOT NULL
DO UPDATE SET
  source_file = EXCLUDED.source_file,
  source_sheet = EXCLUDED.source_sheet,
  source_row = EXCLUDED.source_row,
  raw_customer_name = EXCLUDED.raw_customer_name,
  matched_customer_id = COALESCE(unallocated_payments.matched_customer_id, EXCLUDED.matched_customer_id),
  payment_date = EXCLUDED.payment_date,
  amount = EXCLUDED.amount,
  raw_payload = EXCLUDED.raw_payload,
  updated_at = NOW();

SELECT
  COUNT(*) AS imported_or_existing_payments,
  COUNT(*) FILTER (WHERE allocation_state = 'pending') AS pending_payments,
  COALESCE(SUM(amount), 0) AS pending_total
FROM unallocated_payments
WHERE reference LIKE 'PAIEMENT-KAB-Feuil1-%';

COMMIT;
