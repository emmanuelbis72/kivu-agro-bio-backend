CREATE TABLE IF NOT EXISTS business_rules (
  id SERIAL PRIMARY KEY,
  rule_key VARCHAR(100) NOT NULL UNIQUE,
  rule_value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO business_rules (rule_key, rule_value, description)
VALUES
(
  'strategic_products',
  '[
    "FULL DETOX",
    "FULL OPTIONS",
    "FULL ENERGIE",
    "MORINGA EN POUDRE",
    "CACAO EN POUDRE",
    "GRAINES DE CHIA",
    "LIBIDO POWER",
    "MACA"
  ]'::jsonb,
  'Produits stratégiques KIVU AGRO BIO'
),
(
  'priority_cities',
  '[
    "Kinshasa",
    "Lubumbashi",
    "Kolwezi",
    "Matadi"
  ]'::jsonb,
  'Villes prioritaires de pilotage et de croissance'
),
(
  'priority_channels',
  '[
    "CARREFOUR",
    "GG MART",
    "SWISSMART",
    "REGAL",
    "HYPER PSARO CARREFOUR",
    "SK SUPERMARCHE"
  ]'::jsonb,
  'Canaux et enseignes structurants'
),
(
  'minimum_cash_threshold_usd',
  '3000'::jsonb,
  'Seuil minimal de vigilance trésorerie'
),
(
  'target_net_margin_range',
  '{"min":25,"max":30}'::jsonb,
  'Fourchette cible de marge nette'
),
(
  'high_priority_stock_alert_count',
  '5'::jsonb,
  'Nombre d alertes stock à partir duquel la priorité devient élevée'
),
(
  'monthly_revenue_targets',
  '{
    "current_minimum_monthly_received_payments_usd": 30000,
    "target_from_july_2026_monthly_received_payments_usd": 35000,
    "target_by_december_2026_monthly_received_payments_usd": 50000
  }'::jsonb,
  'Objectifs de chiffre d affaires mensuel base sur les paiements recus'
)
ON CONFLICT (rule_key) DO NOTHING;