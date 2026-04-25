BEGIN;

DO $$
DECLARE
  v_customer_id INTEGER;
  v_warehouse_id INTEGER;
  v_receivable_account_id INTEGER;
  v_missing_products TEXT;
  v_missing_count INTEGER;
  v_mismatch_count INTEGER;
BEGIN
  SELECT id
  INTO v_receivable_account_id
  FROM accounts
  WHERE account_number = '411100'
    AND is_active = TRUE
    AND is_postable = TRUE
  LIMIT 1;

  SELECT id
  INTO v_customer_id
  FROM customers
  WHERE UPPER(TRIM(business_name)) = 'GG MART'
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (
      customer_type,
      business_name,
      contact_name,
      phone,
      email,
      city,
      address,
      payment_terms_days,
      credit_limit,
      notes,
      is_active,
      receivable_account_id,
      warehouse_id
    )
    VALUES (
      'retail',
      'GG MART',
      'GG MART',
      NULL,
      NULL,
      'Kinshasa',
      NULL,
      0,
      0,
      'Client cree automatiquement pour l''import historique des factures GG MART LEMBA.',
      TRUE,
      v_receivable_account_id,
      NULL
    )
    RETURNING id INTO v_customer_id;
  END IF;

  SELECT id
  INTO v_warehouse_id
  FROM warehouses
  WHERE UPPER(TRIM(city)) = 'KINSHASA'
     OR UPPER(TRIM(name)) = 'DEPOT KINSHASA'
  ORDER BY id
  LIMIT 1;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Depot KINSHASA introuvable dans warehouses.';
  END IF;

  CREATE TEMP TABLE tmp_invoice_products (
    product_key TEXT PRIMARY KEY,
    target_name TEXT NOT NULL,
    create_if_missing BOOLEAN NOT NULL DEFAULT FALSE,
    insert_sku TEXT,
    insert_price NUMERIC(14,2)
  ) ON COMMIT DROP;

  INSERT INTO tmp_invoice_products (
    product_key,
    target_name,
    create_if_missing,
    insert_sku,
    insert_price
  )
  VALUES
    ('full_detox', 'Full detox 150g', FALSE, NULL, 5.10),
    ('full_options', 'Full options 100g', FALSE, NULL, 6.30),
    ('full_energie', 'Full Eenrgie 100g', FALSE, NULL, 6.30),
    ('moringa_poudre', 'Moringa en poudre 150g', FALSE, NULL, 4.50),
    ('maca', 'Maca 100g', FALSE, NULL, 6.30),
    ('cacao', 'Cacao en poudre 180g', FALSE, NULL, 6.30),
    ('graines_moringa', 'Graines de Moringa 200g', FALSE, NULL, 6.30),
    ('graines_nigelle', 'Graines de nigelle', FALSE, NULL, 6.30),
    ('antibiotique', 'Antibiotique naturel 150g', FALSE, NULL, 6.30),
    ('chia_500', 'Graines de chia 500g', FALSE, NULL, 6.30),
    ('gingembre', 'Gingembre 150g', FALSE, NULL, 4.00),
    ('ortie', 'Ortie bio', FALSE, NULL, 6.30),
    ('lotus_bleu', 'Lotus bleu', FALSE, NULL, 6.30),
    ('bissap', 'Hibiscus "bissap"', FALSE, NULL, 4.50),
    ('aubergine', 'Aubergine sauvage', FALSE, NULL, 6.30),
    ('ginseng', 'Ginseng', FALSE, NULL, 6.30),
    ('curcuma', 'Curcuma 100g', FALSE, NULL, 4.50),
    ('roi_des_herbes', 'Roi des herbes', FALSE, NULL, 6.30),
    ('artemisia', 'Artemisia 105g', FALSE, NULL, 5.70),
    ('huile_romarin', 'Huile de romarin', FALSE, NULL, 4.50),
    ('huile_nigelle', 'Huile de nigelle', FALSE, NULL, 7.00),
    ('huile_coco', 'Huile de coco', FALSE, NULL, 6.30),
    ('stevia', 'stevia 100g', FALSE, NULL, 4.50),
    ('romarin_150', 'Romarin 150g', TRUE, 'IMP-GGMART-LEMBA-ROMARIN150', 4.00),
    ('noix_cola', 'Noix de cola 200g', FALSE, NULL, 4.00),
    ('fraicheur', 'Fraicheur bio', FALSE, NULL, 4.50),
    ('fenugrec', 'Fenugrec', FALSE, NULL, 6.30),
    ('kigelia_poudre', 'Kigelia en poudre 100g', FALSE, NULL, 6.30),
    ('huile_moringa_100ml', 'Huile de moringa', FALSE, NULL, 4.50),
    ('petit_cola', 'Petit cola 100g', FALSE, NULL, 6.30),
    ('chococafe', 'Chococafé', FALSE, NULL, 4.50),
    ('mucuna_prurien', 'Mucuna 150g', FALSE, NULL, 6.30),
    ('huile_kigelia_100ml', 'Huile kigelia 100ml', FALSE, NULL, 6.30),
    ('beurre_curcuma_200g', 'Beurre au curcuma 200g', FALSE, NULL, 6.30),
    (
      'beurre_kigelia_fenugrec_200g',
      'Beurre de kigelia au fenugrec 200g',
      TRUE,
      'IMP-GGMART-LEMBA-BKIGFENU200',
      14.00
    ),
    ('beurre_karite', 'Beurre de karité', FALSE, NULL, 6.30),
    ('huile_curcuma_100ml', 'Huile de curcuma 100ml', FALSE, NULL, 4.00),
    ('huile_ricin_100ml', 'Huile de ricin', FALSE, NULL, 6.30),
    ('huile_clous_girofle_100ml', 'Huile clous de girofle', FALSE, NULL, 4.50),
    (
      'huile_anti_vergeture',
      'Huile anti vergeture',
      TRUE,
      'IMP-GGMART-LEMBA-ANTI-VERGETURE',
      6.30
    ),
    (
      'huile_contre_hemorroides',
      'Huile contre hemorroides',
      TRUE,
      'IMP-GGMART-LEMBA-HEMORROIDES',
      6.30
    ),
    ('libido_power', 'Libido power 100g', FALSE, NULL, 6.30),
    ('argile_verte', 'Argile verte 200g', FALSE, NULL, 4.00),
    ('body_booster', 'Body booster 100g', FALSE, NULL, 6.30),
    ('baobab_poudre', 'Baobab', FALSE, NULL, 4.50),
    ('chia_250', 'Graines de chia 250g', FALSE, NULL, 3.30),
    ('respire_bio', 'Respire bio 100g', FALSE, NULL, 4.50),
    ('cannelle_100', 'Cannelle en poudre 100g', FALSE, NULL, 4.50),
    ('graines_lin', 'Graines de lin 100g', FALSE, NULL, 4.50),
    ('nepnep', 'Nepnep', FALSE, NULL, 6.30),
    ('clous_girofle_poudre', 'Clous de girofle en poudre', FALSE, NULL, 4.50);

  INSERT INTO products (
    name,
    sku,
    category,
    product_role,
    unit,
    cost_price,
    selling_price,
    alert_threshold,
    is_active,
    description
  )
  SELECT
    tip.target_name,
    tip.insert_sku,
    'Factures historiques GGMART LEMBA',
    'finished_product',
    'piece',
    0,
    tip.insert_price,
    0,
    TRUE,
    'Produit cree automatiquement pour import historique de facture PDF.'
  FROM tmp_invoice_products tip
  WHERE tip.create_if_missing = TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM products p
      WHERE UPPER(TRIM(p.name)) = UPPER(TRIM(tip.target_name))
    );

  CREATE TEMP TABLE tmp_raw_invoice_headers (
    invoice_number TEXT PRIMARY KEY,
    invoice_date DATE NOT NULL,
    expected_total NUMERIC(14,2) NOT NULL,
    source_file TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_raw_invoice_headers (
    invoice_number,
    invoice_date,
    expected_total,
    source_file
  )
  VALUES
    ('9-2/26', DATE '2026-02-26', 1827.00, 'LEMBA.pdf'),
    ('1-3/26', DATE '2026-04-01', 1162.10, 'LEMBA avril.pdf');

  CREATE TEMP TABLE tmp_raw_invoice_lines (
    invoice_number TEXT NOT NULL,
    line_no INTEGER NOT NULL,
    product_key TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL,
    PRIMARY KEY (invoice_number, line_no)
  ) ON COMMIT DROP;

  INSERT INTO tmp_raw_invoice_lines (
    invoice_number,
    line_no,
    product_key,
    quantity,
    unit_price
  )
  VALUES
    ('9-2/26', 1, 'full_detox', 12, 5.10),
    ('9-2/26', 2, 'full_options', 12, 6.30),
    ('9-2/26', 3, 'full_energie', 12, 6.30),
    ('9-2/26', 4, 'moringa_poudre', 12, 4.50),
    ('9-2/26', 5, 'maca', 6, 6.30),
    ('9-2/26', 6, 'cacao', 24, 6.30),
    ('9-2/26', 7, 'graines_moringa', 6, 6.30),
    ('9-2/26', 8, 'graines_nigelle', 6, 6.30),
    ('9-2/26', 9, 'antibiotique', 6, 6.30),
    ('9-2/26', 10, 'chia_500', 23, 6.30),
    ('9-2/26', 11, 'gingembre', 6, 4.00),
    ('9-2/26', 12, 'ortie', 6, 6.30),
    ('9-2/26', 13, 'lotus_bleu', 6, 6.30),
    ('9-2/26', 14, 'bissap', 6, 4.50),
    ('9-2/26', 15, 'aubergine', 6, 6.30),
    ('9-2/26', 16, 'ginseng', 6, 6.30),
    ('9-2/26', 17, 'curcuma', 6, 4.50),
    ('9-2/26', 18, 'roi_des_herbes', 6, 6.30),
    ('9-2/26', 19, 'artemisia', 6, 5.70),
    ('9-2/26', 20, 'huile_romarin', 5, 4.50),
    ('9-2/26', 21, 'huile_nigelle', 3, 7.00),
    ('9-2/26', 22, 'huile_coco', 3, 6.30),
    ('9-2/26', 23, 'stevia', 6, 4.50),
    ('9-2/26', 24, 'romarin_150', 6, 4.00),
    ('9-2/26', 25, 'noix_cola', 6, 4.00),
    ('9-2/26', 26, 'fraicheur', 6, 4.50),
    ('9-2/26', 27, 'fenugrec', 6, 6.30),
    ('9-2/26', 28, 'kigelia_poudre', 6, 6.30),
    ('9-2/26', 29, 'huile_moringa_100ml', 6, 4.50),
    ('9-2/26', 30, 'petit_cola', 6, 6.30),
    ('9-2/26', 31, 'chococafe', 6, 4.50),
    ('9-2/26', 32, 'mucuna_prurien', 6, 6.30),
    ('9-2/26', 33, 'huile_kigelia_100ml', 6, 6.30),
    ('9-2/26', 34, 'beurre_curcuma_200g', 6, 6.30),
    ('9-2/26', 35, 'beurre_kigelia_fenugrec_200g', 6, 14.00),
    ('9-2/26', 36, 'beurre_karite', 3, 6.30),
    ('9-2/26', 37, 'huile_curcuma_100ml', 6, 4.00),
    ('9-2/26', 38, 'huile_ricin_100ml', 6, 6.30),
    ('9-2/26', 39, 'huile_clous_girofle_100ml', 6, 4.50),
    ('9-2/26', 40, 'huile_anti_vergeture', 6, 6.30),
    ('9-2/26', 41, 'huile_contre_hemorroides', 6, 6.30),
    ('9-2/26', 42, 'libido_power', 6, 6.30),
    ('9-2/26', 43, 'argile_verte', 6, 4.00),
    ('9-2/26', 44, 'body_booster', 6, 6.30),

    ('1-3/26', 1, 'full_detox', 14, 5.10),
    ('1-3/26', 2, 'full_options', 11, 6.30),
    ('1-3/26', 3, 'full_energie', 10, 6.30),
    ('1-3/26', 4, 'bissap', 10, 4.50),
    ('1-3/26', 5, 'maca', 12, 6.30),
    ('1-3/26', 6, 'baobab_poudre', 6, 4.50),
    ('1-3/26', 7, 'artemisia', 6, 5.70),
    ('1-3/26', 8, 'chia_250', 10, 3.30),
    ('1-3/26', 9, 'antibiotique', 12, 6.30),
    ('1-3/26', 10, 'chia_500', 10, 6.30),
    ('1-3/26', 11, 'respire_bio', 6, 4.50),
    ('1-3/26', 12, 'petit_cola', 10, 6.30),
    ('1-3/26', 13, 'roi_des_herbes', 6, 6.30),
    ('1-3/26', 14, 'lotus_bleu', 6, 6.30),
    ('1-3/26', 15, 'clous_girofle_poudre', 6, 4.50),
    ('1-3/26', 16, 'aubergine', 6, 6.30),
    ('1-3/26', 17, 'ginseng', 3, 6.30),
    ('1-3/26', 18, 'curcuma', 10, 4.50),
    ('1-3/26', 19, 'cannelle_100', 10, 4.50),
    ('1-3/26', 20, 'chococafe', 10, 4.50),
    ('1-3/26', 21, 'noix_cola', 6, 4.00),
    ('1-3/26', 22, 'fenugrec', 7, 6.30),
    ('1-3/26', 23, 'kigelia_poudre', 6, 6.30),
    ('1-3/26', 24, 'graines_lin', 10, 4.50),
    ('1-3/26', 25, 'romarin_150', 8, 4.00),
    ('1-3/26', 26, 'nepnep', 6, 6.30);

  SELECT COUNT(*)
  INTO v_missing_count
  FROM tmp_raw_invoice_lines ril
  LEFT JOIN tmp_invoice_products tip ON tip.product_key = ril.product_key
  LEFT JOIN products p ON UPPER(TRIM(p.name)) = UPPER(TRIM(tip.target_name))
  WHERE p.id IS NULL;

  IF v_missing_count > 0 THEN
    SELECT STRING_AGG(DISTINCT ril.product_key, ', ' ORDER BY ril.product_key)
    INTO v_missing_products
    FROM tmp_raw_invoice_lines ril
    LEFT JOIN tmp_invoice_products tip ON tip.product_key = ril.product_key
    LEFT JOIN products p ON UPPER(TRIM(p.name)) = UPPER(TRIM(tip.target_name))
    WHERE p.id IS NULL;

    RAISE EXCEPTION 'Produits manquants apres preparation: %', v_missing_products;
  END IF;

  SELECT COUNT(*)
  INTO v_mismatch_count
  FROM (
    SELECT
      h.invoice_number,
      h.expected_total,
      ROUND(SUM(ril.quantity * ril.unit_price)::numeric, 2) AS computed_total
    FROM tmp_raw_invoice_headers h
    INNER JOIN tmp_raw_invoice_lines ril
      ON ril.invoice_number = h.invoice_number
    GROUP BY h.invoice_number, h.expected_total
  ) t
  WHERE t.expected_total <> t.computed_total;

  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION 'Au moins une facture a un total de lignes different du total PDF.';
  END IF;

  WITH header_payload AS (
    SELECT
      h.invoice_number,
      h.invoice_date,
      h.expected_total,
      h.source_file,
      v_customer_id AS customer_id,
      v_warehouse_id AS warehouse_id
    FROM tmp_raw_invoice_headers h
  ),
  inserted_invoices AS (
    INSERT INTO invoices (
      invoice_number,
      customer_id,
      warehouse_id,
      invoice_date,
      due_date,
      status,
      subtotal,
      discount_amount,
      tax_amount,
      total_amount,
      paid_amount,
      balance_due,
      notes,
      accounting_status,
      accounting_entry_id,
      accounting_message,
      created_by
    )
    SELECT
      hp.invoice_number,
      hp.customer_id,
      hp.warehouse_id,
      hp.invoice_date,
      (
        hp.invoice_date
        + COALESCE(
            (SELECT payment_terms_days FROM customers WHERE id = hp.customer_id),
            30
          ) * INTERVAL '1 day'
      )::date,
      'issued',
      hp.expected_total,
      0,
      0,
      hp.expected_total,
      0,
      hp.expected_total,
      CASE
        WHEN hp.invoice_number = '9-2/26' THEN
          'Import historique PDF GG MART - ' || hp.source_file
          || ' (attention: total imprime 1800, total detail des lignes 1827)'
        ELSE
          'Import historique PDF GG MART - ' || hp.source_file
      END,
      NULL,
      NULL,
      NULL,
      NULL
    FROM header_payload hp
    WHERE NOT EXISTS (
      SELECT 1
      FROM invoices i
      WHERE i.invoice_number = hp.invoice_number
    )
    RETURNING id, invoice_number
  ),
  target_invoices AS (
    SELECT id, invoice_number
    FROM inserted_invoices
    UNION ALL
    SELECT i.id, i.invoice_number
    FROM invoices i
    INNER JOIN header_payload hp ON hp.invoice_number = i.invoice_number
  ),
  resolved_lines AS (
    SELECT
      ti.id AS invoice_id,
      ril.line_no,
      p.id AS product_id,
      ril.quantity,
      ril.unit_price,
      ROUND((ril.quantity * ril.unit_price)::numeric, 2) AS line_total
    FROM tmp_raw_invoice_lines ril
    INNER JOIN target_invoices ti
      ON ti.invoice_number = ril.invoice_number
    INNER JOIN tmp_invoice_products tip
      ON tip.product_key = ril.product_key
    INNER JOIN products p
      ON UPPER(TRIM(p.name)) = UPPER(TRIM(tip.target_name))
  )
  INSERT INTO invoice_items (
    invoice_id,
    product_id,
    quantity,
    stock_form,
    package_size,
    package_unit,
    unit_price,
    line_total
  )
  SELECT
    rl.invoice_id,
    rl.product_id,
    rl.quantity,
    NULL,
    NULL,
    NULL,
    rl.unit_price,
    rl.line_total
  FROM resolved_lines rl
  WHERE NOT EXISTS (
    SELECT 1
    FROM invoice_items ii
    WHERE ii.invoice_id = rl.invoice_id
  )
  ORDER BY rl.invoice_id, rl.line_no;
END $$;

SELECT
  i.invoice_number,
  i.invoice_date,
  c.business_name AS customer_name,
  i.total_amount,
  i.status,
  COUNT(ii.id)::int AS lignes
FROM invoices i
INNER JOIN customers c ON c.id = i.customer_id
LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
WHERE i.invoice_number IN ('9-2/26', '1-3/26')
GROUP BY i.id, c.business_name
ORDER BY i.invoice_date ASC, i.invoice_number ASC;

COMMIT;
