import { pool } from "../config/db.js";
import {
  ensureTableSchema,
  queryWithSchemaOrColumnRetry
} from "../utils/schemaSelfHealing.util.js";
import { performStockExit } from "./stock.model.js";

export const PACKAGING_TYPES = [
  "oil_bottle",
  "butter_bottle",
  "kraft_paper"
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
  const conditions = [];
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

async function ensurePackagingSchema(executor = pool) {
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS packaging_type VARCHAR(40);
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
      pc.stock_movement_id,
      pc.created_by,
      pc.created_at,
      p.name AS product_name,
      p.sku,
      p.barcode,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM packaging_consumptions pc
    INNER JOIN products p ON p.id = pc.product_id
    INNER JOIN warehouses w ON w.id = pc.warehouse_id
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

export async function getPackagingOverview(filters = {}) {
  await ensurePackagingSchema(pool);

  const consumptionFilters = buildConsumptionFilters(filters);

  const summaryQuery = `
    SELECT
      COALESCE(SUM(pc.quantity), 0) AS total_consumed,
      COUNT(*)::int AS consumption_count,
      COUNT(DISTINCT pc.consumer_name)::int AS consumers_count
    FROM packaging_consumptions pc
    ${consumptionFilters.whereClause};
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

  const [
    summaryResult,
    stockSummaryResult,
    stockByTypeResult,
    consumptionByTypeResult,
    topConsumersResult,
    monthlyConsumptionResult
  ] = await Promise.all([
    pool.query(summaryQuery, consumptionFilters.values),
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
    recent_consumptions: recentConsumptions
  };
}

export async function createPackagingConsumption(data) {
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
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
      reference_type: "packaging_consumption",
      reference_id: consumption.id,
      notes:
        normalizeOptionalText(data.notes) ||
        `Consommation emballage par ${data.consumer_name}`,
      created_by: data.created_by || null
    });

    const updateResult = await client.query(
      `
        UPDATE packaging_consumptions
        SET
          stock_movement_id = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *;
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
      [updateResult.rows[0].id]
    );

    await client.query("COMMIT");
    return finalResult.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
