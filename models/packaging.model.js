import { pool } from "../config/db.js";
import {
  ensureTableSchema,
  queryWithSchemaOrColumnRetry
} from "../utils/schemaSelfHealing.util.js";
import { performStockEntry, performStockExit } from "./stock.model.js";

export const PACKAGING_TYPES = [
  "oil_bottle",
  "butter_bottle",
  "kraft_paper",
  "essential_oil_bottle"
];

export const PACKAGING_CONSUMER_TYPES = [
  "commercial",
  "production",
  "logistics",
  "administration",
  "client",
  "other"
];

export const PACKAGING_PURPOSES = [
  "conditioning",
  "delivery",
  "sampling",
  "internal_use",
  "loss",
  "other"
];

function normalizePackagingType(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function buildConsumptionFilters(filters = {}) {
  const conditions = [`pc.status = 'active'`];
  const values = [];
  let index = 1;

  if (filters.start_date) {
    conditions.push(`pc.consumption_date >= $${index++}`);
    values.push(filters.start_date);
  }

  if (filters.end_date) {
    conditions.push(`pc.consumption_date <= $${index++}`);
    values.push(filters.end_date);
  }

  if (filters.warehouse_id) {
    conditions.push(`pc.warehouse_id = $${index++}`);
    values.push(Number(filters.warehouse_id));
  }

  if (filters.product_id) {
    conditions.push(`pc.product_id = $${index++}`);
    values.push(Number(filters.product_id));
  }

  if (filters.packaging_type) {
    conditions.push(`pc.packaging_type = $${index++}`);
    values.push(filters.packaging_type);
  }

  if (filters.consumer_name) {
    conditions.push(`pc.consumer_name ILIKE $${index++}`);
    values.push(`%${filters.consumer_name}%`);
  }

  if (filters.consumer_type) {
    conditions.push(`pc.consumer_type = $${index++}`);
    values.push(filters.consumer_type);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
    nextIndex: index
  };
}

function buildReplenishmentFilters(filters = {}) {
  const conditions = [`pr.status = 'active'`];
  const values = [];
  let index = 1;

  if (filters.start_date) {
    conditions.push(`pr.replenishment_date >= $${index++}`);
    values.push(filters.start_date);
  }

  if (filters.end_date) {
    conditions.push(`pr.replenishment_date <= $${index++}`);
    values.push(filters.end_date);
  }

  if (filters.warehouse_id) {
    conditions.push(`pr.warehouse_id = $${index++}`);
    values.push(Number(filters.warehouse_id));
  }

  if (filters.product_id) {
    conditions.push(`pr.product_id = $${index++}`);
    values.push(Number(filters.product_id));
  }

  if (filters.packaging_type) {
    conditions.push(`pr.packaging_type = $${index++}`);
    values.push(filters.packaging_type);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
    nextIndex: index
  };
}

async function ensurePackagingSchema(executor = pool) {
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS packaging_type VARCHAR(40);
  `);
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS packaging_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
  `);
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS packaging_quantity_per_unit NUMERIC(14,2);
  `);

  await ensureTableSchema({
    executor: (sql) => executor.query(sql),
    relationName: "packaging_consumptions",
    createSql: `
      CREATE TABLE IF NOT EXISTS packaging_consumptions (
        id SERIAL PRIMARY KEY,
        consumption_number VARCHAR(40) NOT NULL UNIQUE,
        consumption_date DATE NOT NULL DEFAULT CURRENT_DATE,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        packaging_type VARCHAR(40) NOT NULL,
        quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
        consumer_name VARCHAR(160) NOT NULL,
        consumer_type VARCHAR(40),
        purpose VARCHAR(40),
        notes TEXT,
        stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
        source_type VARCHAR(40),
        source_id INTEGER,
        trigger_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `
  });

  await executor.query(`
    ALTER TABLE packaging_consumptions
    ADD COLUMN IF NOT EXISTS stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL;
  `);
  await executor.query(`
    ALTER TABLE packaging_consumptions
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(40);
  `);
  await executor.query(`
    ALTER TABLE packaging_consumptions
    ADD COLUMN IF NOT EXISTS source_id INTEGER;
  `);
  await executor.query(`
    ALTER TABLE packaging_consumptions
    ADD COLUMN IF NOT EXISTS trigger_mode VARCHAR(20) NOT NULL DEFAULT 'manual';
  `);
  await executor.query(`
    ALTER TABLE packaging_consumptions
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
  `);

  await ensureTableSchema({
    executor: (sql) => executor.query(sql),
    relationName: "packaging_replenishments",
    createSql: `
      CREATE TABLE IF NOT EXISTS packaging_replenishments (
        id SERIAL PRIMARY KEY,
        replenishment_number VARCHAR(40) NOT NULL UNIQUE,
        replenishment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        packaging_type VARCHAR(40) NOT NULL,
        quantity NUMERIC(14,2) NOT NULL CHECK (quantity > 0),
        source_name VARCHAR(160),
        notes TEXT,
        stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `
  });

  await executor.query(`
    ALTER TABLE packaging_replenishments
    ADD COLUMN IF NOT EXISTS stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL;
  `);
  await executor.query(`
    ALTER TABLE packaging_replenishments
    ADD COLUMN IF NOT EXISTS source_name VARCHAR(160);
  `);
  await executor.query(`
    ALTER TABLE packaging_replenishments
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
  `);
}

async function getPackagingProductRecord(executor, productId) {
  const result = await executor.query(
    `
      SELECT *
      FROM products
      WHERE id = $1
      LIMIT 1;
    `,
    [productId]
  );

  return result.rows[0] || null;
}

async function getNextPackagingConsumptionNumber(executor, consumptionDate) {
  const year = new Date(consumptionDate).getFullYear();
  const prefix = `EMB-${year}-`;

  const result = await executor.query(
    `
      SELECT
        COALESCE(
          MAX(
            CASE
              WHEN REPLACE(consumption_number, $1, '') ~ '^[0-9]+$'
                THEN CAST(REPLACE(consumption_number, $1, '') AS INTEGER)
              ELSE NULL
            END
          ),
          0
        ) AS max_sequence
      FROM packaging_consumptions
      WHERE consumption_number LIKE $2;
    `,
    [prefix, `${prefix}%`]
  );

  const nextSequence = Number(result.rows[0]?.max_sequence || 0) + 1;
  return `${prefix}${String(nextSequence).padStart(5, "0")}`;
}

async function getNextPackagingReplenishmentNumber(executor, replenishmentDate) {
  const year = new Date(replenishmentDate).getFullYear();
  const prefix = `APP-EMB-${year}-`;

  const result = await executor.query(
    `
      SELECT
        COALESCE(
          MAX(
            CASE
              WHEN REPLACE(replenishment_number, $1, '') ~ '^[0-9]+$'
                THEN CAST(REPLACE(replenishment_number, $1, '') AS INTEGER)
              ELSE NULL
            END
          ),
          0
        ) AS max_sequence
      FROM packaging_replenishments
      WHERE replenishment_number LIKE $2;
    `,
    [prefix, `${prefix}%`]
  );

  const nextSequence = Number(result.rows[0]?.max_sequence || 0) + 1;
  return `${prefix}${String(nextSequence).padStart(5, "0")}`;
}

async function createPackagingConsumptionEntry(client, data) {
  const product = await getPackagingProductRecord(client, data.product_id);

  if (!product) {
    const error = new Error("Produit emballage introuvable.");
    error.statusCode = 404;
    throw error;
  }

  if (product.product_role !== "packaging_material") {
    const error = new Error(
      "Le produit selectionne n'est pas configure comme emballage."
    );
    error.statusCode = 400;
    throw error;
  }

  const packagingType =
    normalizePackagingType(data.packaging_type) ||
    normalizePackagingType(product.packaging_type);

  if (!packagingType) {
    const error = new Error(
      "Veuillez d'abord classer cet emballage dans un type valide."
    );
    error.statusCode = 400;
    throw error;
  }

  const consumptionNumber = await getNextPackagingConsumptionNumber(
    client,
    data.consumption_date
  );

  const insertResult = await client.query(
    `
      INSERT INTO packaging_consumptions (
        consumption_number,
        consumption_date,
        warehouse_id,
        product_id,
        packaging_type,
        quantity,
        consumer_name,
        consumer_type,
        purpose,
        notes,
        source_type,
        source_id,
        trigger_mode,
        status,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14)
      RETURNING *;
    `,
    [
      consumptionNumber,
      data.consumption_date,
      data.warehouse_id,
      data.product_id,
      packagingType,
      data.quantity,
      data.consumer_name,
      normalizeOptionalText(data.consumer_type),
      normalizeOptionalText(data.purpose),
      normalizeOptionalText(data.notes),
      normalizeOptionalText(data.source_type),
      data.source_id ?? null,
      normalizeOptionalText(data.trigger_mode) || "manual",
      data.created_by || null
    ]
  );

  const consumption = insertResult.rows[0];

  const stockExit = await performStockExit({
    client,
    warehouse_id: data.warehouse_id,
    product_id: data.product_id,
    quantity: data.quantity,
    unit_cost: Number(product.cost_price || 0),
    reference_type:
      normalizeOptionalText(data.reference_type) || "packaging_consumption",
    reference_id: consumption.id,
    notes:
      normalizeOptionalText(data.notes) ||
      `Consommation emballage par ${data.consumer_name}`,
    created_by: data.created_by || null,
    allow_negative:
      normalizeOptionalText(data.source_type) === "invoice"
  });

  await client.query(
    `
      UPDATE packaging_consumptions
      SET
        stock_movement_id = $1,
        updated_at = NOW()
      WHERE id = $2;
    `,
    [stockExit.movement.id, consumption.id]
  );

  const finalResult = await client.query(
    `
      SELECT
        pc.*,
        p.name AS product_name,
        p.sku,
        p.barcode,
        w.name AS warehouse_name,
        w.city AS warehouse_city
      FROM packaging_consumptions pc
      INNER JOIN products p ON p.id = pc.product_id
      INNER JOIN warehouses w ON w.id = pc.warehouse_id
      WHERE pc.id = $1
      LIMIT 1;
    `,
    [consumption.id]
  );

  return finalResult.rows[0] || null;
}

export async function getPackagingProducts() {
  const query = `
    WITH warehouse_rows AS (
      SELECT
        ws.product_id,
        ws.warehouse_id,
        w.name AS warehouse_name,
        w.city AS warehouse_city,
        SUM(ws.quantity) AS quantity
      FROM warehouse_stock ws
      INNER JOIN warehouses w ON w.id = ws.warehouse_id
      GROUP BY ws.product_id, ws.warehouse_id, w.name, w.city
    )
    SELECT
      p.id,
      p.name,
      p.category,
      p.sku,
      p.barcode,
      p.packaging_type,
      p.unit,
      p.cost_price,
      p.alert_threshold,
      p.is_active,
      COALESCE(SUM(wr.quantity), 0) AS total_stock,
      COALESCE(
        json_agg(
          json_build_object(
            'warehouse_id', wr.warehouse_id,
            'warehouse_name', wr.warehouse_name,
            'warehouse_city', wr.warehouse_city,
            'quantity', wr.quantity
          )
          ORDER BY wr.warehouse_name ASC
        ) FILTER (WHERE wr.warehouse_id IS NOT NULL),
        '[]'::json
      ) AS warehouse_stock
    FROM products p
    LEFT JOIN warehouse_rows wr ON wr.product_id = p.id
    WHERE p.product_role = 'packaging_material'
    GROUP BY p.id
    ORDER BY p.name ASC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePackagingSchema(pool),
    query
  });

  return result.rows;
}

export async function getFinishedProductPackagingConfigs() {
  const query = `
    SELECT
      fp.id AS finished_product_id,
      fp.name AS finished_product_name,
      fp.category AS finished_product_category,
      fp.sku AS finished_product_sku,
      fp.packaging_type AS required_packaging_type,
      fp.packaging_product_id,
      fp.packaging_quantity_per_unit,
      pp.name AS packaging_product_name,
      pp.sku AS packaging_product_sku,
      pp.packaging_type,
      pp.unit AS packaging_unit,
      pp.is_active AS packaging_is_active
    FROM products fp
    LEFT JOIN products pp ON pp.id = fp.packaging_product_id
    WHERE fp.product_role = 'finished_product'
    ORDER BY fp.name ASC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePackagingSchema(pool),
    query
  });

  return result.rows;
}

export async function updatePackagingProductType(productId, packagingType) {
  const normalizedType = normalizePackagingType(packagingType);

  await ensurePackagingSchema(pool);

  const product = await getPackagingProductRecord(pool, productId);

  if (!product) {
    return null;
  }

  if (product.product_role !== "packaging_material") {
    const error = new Error(
      "Seuls les produits marques comme emballages peuvent recevoir un type d'emballage."
    );
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `
      UPDATE products
      SET
        packaging_type = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `,
    [normalizedType, productId]
  );

  return result.rows[0] || null;
}

export async function updateFinishedProductPackagingConfig(
  finishedProductId,
  packagingProductId,
  packagingQuantityPerUnit,
  requiredPackagingType = null
) {
  await ensurePackagingSchema(pool);

  const finishedProduct = await getPackagingProductRecord(pool, finishedProductId);

  if (!finishedProduct) {
    return null;
  }

  if (finishedProduct.product_role !== "finished_product") {
    const error = new Error(
      "Seuls les produits finis peuvent recevoir une configuration d'emballage."
    );
    error.statusCode = 400;
    throw error;
  }

  if (packagingProductId !== null) {
    const packagingProduct = await getPackagingProductRecord(pool, packagingProductId);

    if (!packagingProduct) {
      const error = new Error("Produit emballage introuvable.");
      error.statusCode = 404;
      throw error;
    }

    if (packagingProduct.product_role !== "packaging_material") {
      const error = new Error(
        "Le produit lie doit etre un emballage."
      );
      error.statusCode = 400;
      throw error;
    }

    if (
      requiredPackagingType &&
      packagingProduct.packaging_type &&
      normalizePackagingType(packagingProduct.packaging_type) !==
        normalizePackagingType(requiredPackagingType)
    ) {
      const error = new Error(
        "Le type choisi pour le produit fini ne correspond pas au type de l'emballage lie."
      );
      error.statusCode = 400;
      throw error;
    }
  }

  const normalizedRequiredType =
    normalizePackagingType(requiredPackagingType) ||
    (packagingProductId !== null
      ? (
          await getPackagingProductRecord(pool, packagingProductId)
        )?.packaging_type || null
      : null);

  const result = await pool.query(
    `
      UPDATE products
      SET
        packaging_type = $1,
        packaging_product_id = $2,
        packaging_quantity_per_unit = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `,
    [
      normalizedRequiredType,
      packagingProductId,
      packagingProductId === null ? null : packagingQuantityPerUnit,
      finishedProductId
    ]
  );

  return result.rows[0] || null;
}

export async function getPackagingConsumptions({
  start_date = null,
  end_date = null,
  warehouse_id = null,
  product_id = null,
  packaging_type = null,
  consumer_name = null,
  consumer_type = null,
  limit = 100
} = {}) {
  const filters = buildConsumptionFilters({
    start_date,
    end_date,
    warehouse_id,
    product_id,
    packaging_type,
    consumer_name,
    consumer_type
  });

  const query = `
    SELECT
      pc.id,
      pc.consumption_number,
      pc.consumption_date,
      pc.warehouse_id,
      pc.product_id,
      pc.packaging_type,
      pc.quantity,
      pc.consumer_name,
      pc.consumer_type,
      pc.purpose,
      pc.notes,
      pc.source_type,
      pc.source_id,
      pc.trigger_mode,
      pc.stock_movement_id,
      pc.created_by,
      pc.created_at,
      p.name AS product_name,
      p.sku,
      p.barcode,
      i.invoice_number,
      i.invoice_date AS source_invoice_date,
      c.business_name AS source_customer_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM packaging_consumptions pc
    INNER JOIN products p ON p.id = pc.product_id
    INNER JOIN warehouses w ON w.id = pc.warehouse_id
    LEFT JOIN invoices i
      ON pc.source_type = 'invoice'
     AND i.id = pc.source_id
    LEFT JOIN customers c
      ON c.id = i.customer_id
    ${filters.whereClause}
    ORDER BY pc.consumption_date DESC, pc.id DESC
    LIMIT $${filters.nextIndex};
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePackagingSchema(pool),
    query,
    values: [...filters.values, Number(limit) > 0 ? Number(limit) : 100]
  });

  return result.rows;
}

export async function getPackagingReplenishments({
  start_date = null,
  end_date = null,
  warehouse_id = null,
  product_id = null,
  packaging_type = null,
  limit = 100
} = {}) {
  const filters = buildReplenishmentFilters({
    start_date,
    end_date,
    warehouse_id,
    product_id,
    packaging_type
  });

  const query = `
    SELECT
      pr.id,
      pr.replenishment_number,
      pr.replenishment_date,
      pr.warehouse_id,
      pr.product_id,
      pr.packaging_type,
      pr.quantity,
      pr.source_name,
      pr.notes,
      pr.stock_movement_id,
      pr.created_by,
      pr.created_at,
      p.name AS product_name,
      p.sku,
      p.barcode,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM packaging_replenishments pr
    INNER JOIN products p ON p.id = pr.product_id
    INNER JOIN warehouses w ON w.id = pr.warehouse_id
    ${filters.whereClause}
    ORDER BY pr.replenishment_date DESC, pr.id DESC
    LIMIT $${filters.nextIndex};
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePackagingSchema(pool),
    query,
    values: [...filters.values, Number(limit) > 0 ? Number(limit) : 100]
  });

  return result.rows;
}

export async function getPackagingUsageByInvoice({
  start_date = null,
  end_date = null,
  warehouse_id = null,
  product_id = null,
  packaging_type = null,
  consumer_name = null,
  limit = 100
} = {}) {
  const filters = buildConsumptionFilters({
    start_date,
    end_date,
    warehouse_id,
    product_id,
    packaging_type,
    consumer_name
  });

  const whereClause = filters.whereClause
    ? `${filters.whereClause} AND pc.source_type = 'invoice'`
    : `WHERE pc.source_type = 'invoice' AND pc.status = 'active'`;

  const query = `
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.invoice_date,
      c.id AS customer_id,
      c.business_name AS customer_name,
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      pc.packaging_type,
      COUNT(*)::int AS consumption_lines_count,
      COUNT(DISTINCT pc.product_id)::int AS packaging_products_count,
      COALESCE(SUM(pc.quantity), 0) AS total_quantity
    FROM packaging_consumptions pc
    INNER JOIN invoices i
      ON i.id = pc.source_id
    INNER JOIN customers c
      ON c.id = i.customer_id
    INNER JOIN warehouses w
      ON w.id = pc.warehouse_id
    ${whereClause}
    GROUP BY
      i.id,
      i.invoice_number,
      i.invoice_date,
      c.id,
      c.business_name,
      w.id,
      w.name,
      pc.packaging_type
    ORDER BY i.invoice_date DESC, i.invoice_number DESC, pc.packaging_type ASC
    LIMIT $${filters.nextIndex};
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePackagingSchema(pool),
    query,
    values: [...filters.values, Number(limit) > 0 ? Number(limit) : 100]
  });

  return result.rows.map((row) => ({
    ...row,
    consumption_lines_count: Number(row.consumption_lines_count || 0),
    packaging_products_count: Number(row.packaging_products_count || 0),
    total_quantity: Number(row.total_quantity || 0)
  }));
}

export async function getPackagingOverview(filters = {}) {
  await ensurePackagingSchema(pool);

  const consumptionFilters = buildConsumptionFilters(filters);
  const replenishmentFilters = buildReplenishmentFilters(filters);

  const summaryQuery = `
    SELECT
      COALESCE(SUM(pc.quantity), 0) AS total_consumed,
      COUNT(*)::int AS consumption_count,
      COUNT(DISTINCT pc.consumer_name)::int AS consumers_count
    FROM packaging_consumptions pc
    ${consumptionFilters.whereClause};
  `;

  const replenishmentSummaryQuery = `
    SELECT
      COALESCE(SUM(pr.quantity), 0) AS total_replenished,
      COUNT(*)::int AS replenishment_count
    FROM packaging_replenishments pr
    ${replenishmentFilters.whereClause};
  `;

  const stockConditions = [`p.product_role = 'packaging_material'`];
  const stockValues = [];
  let stockIndex = 1;

  if (filters.packaging_type) {
    stockConditions.push(`p.packaging_type = $${stockIndex++}`);
    stockValues.push(filters.packaging_type);
  }

  if (filters.warehouse_id) {
    stockConditions.push(`ws.warehouse_id = $${stockIndex++}`);
    stockValues.push(Number(filters.warehouse_id));
  }

  if (filters.product_id) {
    stockConditions.push(`p.id = $${stockIndex++}`);
    stockValues.push(Number(filters.product_id));
  }

  const stockWhereClause = `WHERE ${stockConditions.join(" AND ")}`;

  const stockSummaryQuery = `
    SELECT
      COALESCE(SUM(ws.quantity), 0) AS current_stock,
      COUNT(DISTINCT p.id)::int AS packaging_products_count,
      COUNT(DISTINCT ws.warehouse_id)::int AS active_warehouses_count
    FROM products p
    LEFT JOIN warehouse_stock ws ON ws.product_id = p.id
    ${stockWhereClause};
  `;

  const stockByTypeQuery = `
    SELECT
      COALESCE(NULLIF(TRIM(p.packaging_type), ''), 'unclassified') AS packaging_type,
      COALESCE(SUM(ws.quantity), 0) AS current_stock
    FROM products p
    LEFT JOIN warehouse_stock ws ON ws.product_id = p.id
    ${stockWhereClause}
    GROUP BY COALESCE(NULLIF(TRIM(p.packaging_type), ''), 'unclassified')
    ORDER BY current_stock DESC, packaging_type ASC;
  `;

  const consumptionByTypeQuery = `
    SELECT
      pc.packaging_type,
      COALESCE(SUM(pc.quantity), 0) AS total_consumed,
      COUNT(*)::int AS consumption_count
    FROM packaging_consumptions pc
    ${consumptionFilters.whereClause}
    GROUP BY pc.packaging_type
    ORDER BY total_consumed DESC, pc.packaging_type ASC;
  `;

  const topConsumersQuery = `
    SELECT
      pc.consumer_name,
      COALESCE(NULLIF(TRIM(pc.consumer_type), ''), 'other') AS consumer_type,
      COALESCE(SUM(pc.quantity), 0) AS total_consumed,
      COUNT(*)::int AS consumption_count
    FROM packaging_consumptions pc
    ${consumptionFilters.whereClause}
    GROUP BY pc.consumer_name, COALESCE(NULLIF(TRIM(pc.consumer_type), ''), 'other')
    ORDER BY total_consumed DESC, pc.consumer_name ASC
    LIMIT 10;
  `;

  const monthlyConsumptionQuery = `
    SELECT
      DATE_TRUNC('month', pc.consumption_date)::date AS period_start,
      COALESCE(SUM(pc.quantity), 0) AS total_consumed,
      COUNT(*)::int AS consumption_count
    FROM packaging_consumptions pc
    ${consumptionFilters.whereClause}
    GROUP BY DATE_TRUNC('month', pc.consumption_date)::date
    ORDER BY period_start DESC
    LIMIT 12;
  `;

  const recentConsumptions = await getPackagingConsumptions({
    ...filters,
    limit: 12
  });
  const recentReplenishments = await getPackagingReplenishments({
    ...filters,
    limit: 12
  });

  const [
    summaryResult,
    replenishmentSummaryResult,
    stockSummaryResult,
    stockByTypeResult,
    consumptionByTypeResult,
    topConsumersResult,
    monthlyConsumptionResult
  ] = await Promise.all([
    pool.query(summaryQuery, consumptionFilters.values),
    pool.query(replenishmentSummaryQuery, replenishmentFilters.values),
    pool.query(stockSummaryQuery, stockValues),
    pool.query(stockByTypeQuery, stockValues),
    pool.query(consumptionByTypeQuery, consumptionFilters.values),
    pool.query(topConsumersQuery, consumptionFilters.values),
    pool.query(monthlyConsumptionQuery, consumptionFilters.values)
  ]);

  return {
    summary: {
      total_consumed: Number(summaryResult.rows[0]?.total_consumed || 0),
      consumption_count: Number(summaryResult.rows[0]?.consumption_count || 0),
      consumers_count: Number(summaryResult.rows[0]?.consumers_count || 0),
      total_replenished: Number(
        replenishmentSummaryResult.rows[0]?.total_replenished || 0
      ),
      replenishment_count: Number(
        replenishmentSummaryResult.rows[0]?.replenishment_count || 0
      ),
      current_stock: Number(stockSummaryResult.rows[0]?.current_stock || 0),
      packaging_products_count: Number(
        stockSummaryResult.rows[0]?.packaging_products_count || 0
      ),
      active_warehouses_count: Number(
        stockSummaryResult.rows[0]?.active_warehouses_count || 0
      )
    },
    stock_by_type: stockByTypeResult.rows.map((row) => ({
      packaging_type: row.packaging_type,
      current_stock: Number(row.current_stock || 0)
    })),
    consumption_by_type: consumptionByTypeResult.rows.map((row) => ({
      packaging_type: row.packaging_type,
      total_consumed: Number(row.total_consumed || 0),
      consumption_count: Number(row.consumption_count || 0)
    })),
    top_consumers: topConsumersResult.rows.map((row) => ({
      consumer_name: row.consumer_name,
      consumer_type: row.consumer_type,
      total_consumed: Number(row.total_consumed || 0),
      consumption_count: Number(row.consumption_count || 0)
    })),
    monthly_consumption: monthlyConsumptionResult.rows.map((row) => ({
      period_start: row.period_start,
      total_consumed: Number(row.total_consumed || 0),
      consumption_count: Number(row.consumption_count || 0)
    })),
    recent_consumptions: recentConsumptions,
    recent_replenishments: recentReplenishments
  };
}

export async function createPackagingConsumption(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensurePackagingSchema(client);
    const finalResult = await createPackagingConsumptionEntry(client, {
      ...data,
      source_type: data.source_type || null,
      source_id: data.source_id ?? null,
      trigger_mode: data.trigger_mode || "manual",
      reference_type: data.reference_type || "packaging_consumption"
    });

    await client.query("COMMIT");
    return finalResult || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createPackagingReplenishment(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensurePackagingSchema(client);

    const product = await getPackagingProductRecord(client, data.product_id);

    if (!product) {
      const error = new Error("Produit emballage introuvable.");
      error.statusCode = 404;
      throw error;
    }

    if (product.product_role !== "packaging_material") {
      const error = new Error(
        "Le produit selectionne n'est pas configure comme emballage."
      );
      error.statusCode = 400;
      throw error;
    }

    const packagingType =
      normalizePackagingType(data.packaging_type) ||
      normalizePackagingType(product.packaging_type);

    if (!packagingType) {
      const error = new Error(
        "Veuillez d'abord classer cet emballage dans un type valide."
      );
      error.statusCode = 400;
      throw error;
    }

    const replenishmentNumber = await getNextPackagingReplenishmentNumber(
      client,
      data.replenishment_date
    );

    const insertResult = await client.query(
      `
        INSERT INTO packaging_replenishments (
          replenishment_number,
          replenishment_date,
          warehouse_id,
          product_id,
          packaging_type,
          quantity,
          source_name,
          notes,
          status,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)
        RETURNING *;
      `,
      [
        replenishmentNumber,
        data.replenishment_date,
        data.warehouse_id,
        data.product_id,
        packagingType,
        data.quantity,
        normalizeOptionalText(data.source_name),
        normalizeOptionalText(data.notes),
        data.created_by || null
      ]
    );

    const replenishment = insertResult.rows[0];

    const stockEntry = await performStockEntry({
      client,
      warehouse_id: data.warehouse_id,
      product_id: data.product_id,
      quantity: data.quantity,
      unit_cost: Number(product.cost_price || 0),
      reference_type: "packaging_replenishment",
      reference_id: replenishment.id,
      notes:
        normalizeOptionalText(data.notes) ||
        `Approvisionnement emballage ${replenishmentNumber}`,
      created_by: data.created_by || null
    });

    await client.query(
      `
        UPDATE packaging_replenishments
        SET
          stock_movement_id = $1,
          updated_at = NOW()
        WHERE id = $2;
      `,
      [stockEntry.movement.id, replenishment.id]
    );

    const rowResult = await client.query(
      `
        SELECT
          pr.*,
          p.name AS product_name,
          p.sku,
          p.barcode,
          w.name AS warehouse_name,
          w.city AS warehouse_city
        FROM packaging_replenishments pr
        INNER JOIN products p ON p.id = pr.product_id
        INNER JOIN warehouses w ON w.id = pr.warehouse_id
        WHERE pr.id = $1
        LIMIT 1;
      `,
      [replenishment.id]
    );

    await client.query("COMMIT");
    return rowResult.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumePackagingForInvoice({
  client,
  invoice,
  items,
  customer_name = null,
  created_by = null
}) {
  await ensurePackagingSchema(client);

  for (const item of items || []) {
    const configResult = await client.query(
      `
        SELECT
          fp.id AS finished_product_id,
          fp.name AS finished_product_name,
          fp.packaging_type AS required_packaging_type,
          fp.packaging_product_id,
          COALESCE(fp.packaging_quantity_per_unit, 0) AS packaging_quantity_per_unit,
          pp.name AS packaging_product_name,
          pp.packaging_type,
          pp.product_role AS packaging_product_role
        FROM products fp
        LEFT JOIN products pp ON pp.id = fp.packaging_product_id
        WHERE fp.id = $1
        LIMIT 1;
      `,
      [item.product_id]
    );

    const config = configResult.rows[0] || null;

    if (
      !config ||
      !config.packaging_product_id ||
      Number(config.packaging_quantity_per_unit || 0) <= 0
    ) {
      continue;
    }

    if (config.packaging_product_role !== "packaging_material") {
      const error = new Error(
        `L'emballage lie au produit ${config.finished_product_name} est invalide.`
      );
      error.statusCode = 400;
      throw error;
    }

    const quantityToConsume =
      Number(item.quantity || 0) * Number(config.packaging_quantity_per_unit || 0);

    if (quantityToConsume <= 0) {
      continue;
    }

    await createPackagingConsumptionEntry(client, {
      warehouse_id: invoice.warehouse_id,
      product_id: config.packaging_product_id,
      packaging_type:
        normalizePackagingType(config.required_packaging_type) ||
        normalizePackagingType(config.packaging_type) ||
        null,
      quantity: quantityToConsume,
      consumption_date: invoice.invoice_date,
      consumer_name: customer_name || `Facture ${invoice.invoice_number}`,
      consumer_type: "client",
      purpose: "conditioning",
      notes: `Consommation automatique liee a la facture ${invoice.invoice_number} pour ${config.finished_product_name}`,
      source_type: "invoice",
      source_id: invoice.id,
      trigger_mode: "automatic",
      reference_type: "packaging_consumption",
      created_by
    });
  }
}

export async function reversePackagingConsumptionsBySource({
  client,
  source_type,
  source_id,
  reason = "Annulation consommation emballage",
  created_by = null
}) {
  await ensurePackagingSchema(client);

  const result = await client.query(
    `
      SELECT *
      FROM packaging_consumptions
      WHERE source_type = $1
        AND source_id = $2
        AND status = 'active'
      ORDER BY id ASC;
    `,
    [source_type, source_id]
  );

  for (const row of result.rows) {
    await performStockEntry({
      client,
      warehouse_id: row.warehouse_id,
      product_id: row.product_id,
      quantity: row.quantity,
      reference_type: "packaging_consumption_reversal",
      reference_id: row.id,
      notes: `${reason} - ${row.consumption_number}`,
      created_by
    });

    await client.query(
      `
        UPDATE packaging_consumptions
        SET
          status = 'reversed',
          updated_at = NOW()
        WHERE id = $1;
      `,
      [row.id]
    );
  }

  return result.rows.length;
}
