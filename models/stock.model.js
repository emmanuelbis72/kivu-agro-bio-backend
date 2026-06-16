import { pool } from "../config/db.js";
import { createProduct as createProductRecord } from "./product.model.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";
import {
  calculateTheoreticalStockPosition,
  convertStockQuantity,
  convertToReportingQuantity,
  getReportingStockUnit,
  normalizeStockUnit
} from "../utils/stockUnit.util.js";

const STOCK_FORMS = {
  BULK: "bulk",
  PACKAGE: "package"
};

const PRODUCT_ROLES = {
  FINISHED: "finished_product",
  RAW_MATERIAL: "raw_material",
  PACKAGING: "packaging_material"
};
let stockSchemaReady = false;

function normalizeStockForm(value) {
  return String(value || STOCK_FORMS.BULK).trim().toLowerCase();
}

function normalizePackageMetadata(stockForm, packageSize, packageUnit) {
  const normalizedForm = normalizeStockForm(stockForm);

  if (normalizedForm !== STOCK_FORMS.PACKAGE) {
    return {
      stock_form: STOCK_FORMS.BULK,
      package_size: null,
      package_unit: null
    };
  }

  return {
    stock_form: STOCK_FORMS.PACKAGE,
    package_size:
      packageSize === undefined || packageSize === null ? null : Number(packageSize),
    package_unit: packageUnit ? String(packageUnit).trim().toLowerCase() : null
  };
}

async function getClient(externalClient) {
  if (externalClient) {
    return { client: externalClient, shouldManageTransaction: false };
  }

  return { client: await pool.connect(), shouldManageTransaction: true };
}

export async function ensureStockSchema(executor = pool) {
  if (executor === pool && stockSchemaReady) {
    return;
  }

  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS product_role VARCHAR(30) NOT NULL DEFAULT 'finished_product';
  `);
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS stock_unit VARCHAR(20) NOT NULL DEFAULT 'unit';
  `);
  await executor.query(`
    ALTER TABLE warehouse_stock
    ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk';
  `);
  await executor.query(`
    ALTER TABLE warehouse_stock
    ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2);
  `);
  await executor.query(`
    ALTER TABLE warehouse_stock
    ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk';
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2);
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20);
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_movement_type_chk;
  `);
  await executor.query(`
    ALTER TABLE warehouse_stock
    ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;
  `);
  await executor.query(`
    ALTER TABLE warehouse_stock
    DROP CONSTRAINT IF EXISTS warehouse_stock_quantity_chk;
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;
  `);
  await executor.query(`
    ALTER TABLE stock_transfer_items
    ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;
  `);
  await executor.query(`
    ALTER TABLE product_recipes
    ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20);
  `);
  await executor.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'product_recipes'
          AND column_name = 'unit'
      ) THEN
        EXECUTE '
          UPDATE product_recipes
          SET quantity_unit = COALESCE(quantity_unit, unit)
          WHERE quantity_unit IS NULL
        ';
      END IF;
    END $$;
  `);
  await executor.query(`
    ALTER TABLE product_recipes
    ALTER COLUMN quantity_required TYPE NUMERIC(18,6)
    USING quantity_required::NUMERIC;
  `);
  await executor.query(`
    CREATE TABLE IF NOT EXISTS invoice_stock_consumptions (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE SET NULL,
      sold_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      component_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      consumption_mode VARCHAR(20) NOT NULL,
      sold_quantity NUMERIC(18,6) NOT NULL,
      recipe_quantity NUMERIC(18,6),
      recipe_unit VARCHAR(20),
      consumed_quantity NUMERIC(18,6) NOT NULL,
      consumed_unit VARCHAR(20) NOT NULL,
      stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
      package_size NUMERIC(14,2),
      package_unit VARCHAR(20),
      movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
      reversal_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
      reversed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT invoice_stock_consumptions_mode_chk
        CHECK (consumption_mode IN ('recipe', 'direct')),
      CONSTRAINT invoice_stock_consumptions_quantity_chk
        CHECK (consumed_quantity > 0)
    );
  `);
  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_invoice_stock_consumptions_invoice
    ON invoice_stock_consumptions(invoice_id, reversed_at);
  `);

  if (executor === pool) {
    stockSchemaReady = true;
  }
}

async function getProductRecord(client, productId) {
  const result = await client.query(
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

async function getStockItemByVariant(client, warehouseId, productId, variant = {}) {
  const metadata = normalizePackageMetadata(
    variant.stock_form,
    variant.package_size,
    variant.package_unit
  );

  const result = await client.query(
    `
    SELECT *
    FROM warehouse_stock
    WHERE warehouse_id = $1
      AND product_id = $2
      AND stock_form = $3
      AND COALESCE(package_size, 0) = COALESCE($4, 0)
      AND COALESCE(package_unit, '') = COALESCE($5, '')
    LIMIT 1;
    `,
    [
      warehouseId,
      productId,
      metadata.stock_form,
      metadata.package_size,
      metadata.package_unit
    ]
  );

  return result.rows[0] || null;
}

async function getStockItemsForProduct(client, warehouseId, productId) {
  const result = await client.query(
    `
    SELECT *
    FROM warehouse_stock
    WHERE warehouse_id = $1 AND product_id = $2
    ORDER BY
      CASE stock_form
        WHEN 'package' THEN 1
        ELSE 2
      END,
      COALESCE(package_size, 0) ASC,
      id ASC;
    `,
    [warehouseId, productId]
  );

  return result.rows;
}

async function resolveStockItem(client, warehouseId, productId, variant = {}, options = {}) {
  const hasExplicitForm = variant.stock_form !== undefined && variant.stock_form !== null;

  if (hasExplicitForm) {
    return getStockItemByVariant(client, warehouseId, productId, variant);
  }

  const rows = await getStockItemsForProduct(client, warehouseId, productId);

  if (!rows.length) {
    return null;
  }

  if (rows.length === 1 || options.allowAmbiguousFallback) {
    return rows[0];
  }

  const error = new Error(
    "Plusieurs variantes de stock existent pour ce produit dans ce dépôt. Veuillez préciser 'stock_form'."
  );
  error.statusCode = 400;
  throw error;
}

async function createStockItem(client, warehouseId, productId, quantity = 0, variant = {}) {
  const metadata = normalizePackageMetadata(
    variant.stock_form,
    variant.package_size,
    variant.package_unit
  );

  const result = await client.query(
    `
    INSERT INTO warehouse_stock (
      warehouse_id,
      product_id,
      quantity,
      stock_form,
      package_size,
      package_unit
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
    `,
    [
      warehouseId,
      productId,
      quantity,
      metadata.stock_form,
      metadata.package_size,
      metadata.package_unit
    ]
  );

  return result.rows[0];
}

async function ensureStockItem(client, warehouseId, productId, variant = {}) {
  let stockItem = await getStockItemByVariant(client, warehouseId, productId, variant);

  if (!stockItem) {
    stockItem = await createStockItem(client, warehouseId, productId, 0, variant);
  }

  return stockItem;
}

async function updateStockQuantity(client, stockItemId, quantity) {
  const result = await client.query(
    `
    UPDATE warehouse_stock
    SET
      quantity = $1,
      updated_at = NOW()
    WHERE id = $2
    RETURNING *;
    `,
    [quantity, stockItemId]
  );

  return result.rows[0] || null;
}

async function createStockMovement(client, data) {
  const metadata = normalizePackageMetadata(
    data.stock_form,
    data.package_size,
    data.package_unit
  );

  const result = await client.query(
    `
    INSERT INTO stock_movements (
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      stock_form,
      package_size,
      package_unit,
      quantity_unit,
      unit_cost,
      reference_type,
      reference_id,
      notes,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *;
    `,
    [
      data.product_id,
      data.warehouse_id,
      data.movement_type,
      data.quantity,
      metadata.stock_form,
      metadata.package_size,
      metadata.package_unit,
      normalizeStockUnit(data.quantity_unit),
      data.unit_cost ?? 0,
      data.reference_type || null,
      data.reference_id || null,
      data.notes || null,
      data.created_by || null
    ]
  );

  return result.rows[0];
}

export async function getWarehouseStock(warehouseId) {
  const query = `
    SELECT
      ws.id,
      ws.warehouse_id,
      ws.product_id,
      ws.quantity,
      ws.stock_form,
      ws.package_size,
      ws.package_unit,
      ws.created_at,
      ws.updated_at,
      p.name AS product_name,
      p.sku,
      p.category,
      p.product_role,
      p.unit,
      p.stock_unit,
      p.alert_threshold,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM warehouse_stock ws
    INNER JOIN products p ON p.id = ws.product_id
    INNER JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.warehouse_id = $1
    ORDER BY p.name ASC, ws.stock_form ASC, COALESCE(ws.package_size, 0) ASC;
    `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureStockSchema(pool),
    query,
    values: [warehouseId]
  });

  return result.rows;
}

export async function getAllStockSummary() {
  const query = `
    SELECT
      ws.id,
      ws.warehouse_id,
      ws.product_id,
      ws.quantity,
      ws.stock_form,
      ws.package_size,
      ws.package_unit,
      p.name AS product_name,
      p.sku,
      p.category,
      p.product_role,
      p.unit,
      p.stock_unit,
      p.alert_threshold,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM warehouse_stock ws
    INNER JOIN products p ON p.id = ws.product_id
    INNER JOIN warehouses w ON w.id = ws.warehouse_id
    ORDER BY w.name ASC, p.name ASC, ws.stock_form ASC, COALESCE(ws.package_size, 0) ASC;
    `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureStockSchema(pool),
    query
  });

  return result.rows;
}

export async function getStockMovements({ warehouseId, productId, limit = 100 }) {
  const conditions = [];
  const values = [];
  let index = 1;

  if (warehouseId) {
    conditions.push(`sm.warehouse_id = $${index++}`);
    values.push(warehouseId);
  }

  if (productId) {
    conditions.push(`sm.product_id = $${index++}`);
    values.push(productId);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(limit);

  const query = `
    SELECT
      sm.*,
      p.name AS product_name,
      p.sku,
      p.product_role,
      p.unit,
      p.stock_unit,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id
    INNER JOIN warehouses w ON w.id = sm.warehouse_id
    ${whereClause}
    ORDER BY sm.created_at DESC
    LIMIT $${index};
    `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, params = []) => pool.query(sql, params),
    ensureSchema: () => ensureStockSchema(pool),
    query,
    values
  });

  return result.rows;
}

export async function getStockTransfers(limit = 100) {
  const result = await pool.query(
    `
    SELECT
      st.id,
      st.transfer_number,
      st.source_warehouse_id,
      st.destination_warehouse_id,
      st.transfer_date,
      st.status,
      st.notes,
      st.created_by,
      st.created_at,
      st.updated_at,
      sw.name AS source_warehouse_name,
      sw.city AS source_warehouse_city,
      dw.name AS destination_warehouse_name,
      dw.city AS destination_warehouse_city,
      COALESCE(COUNT(sti.id), 0)::int AS items_count,
      COALESCE(SUM(sti.quantity), 0) AS total_quantity
    FROM stock_transfers st
    INNER JOIN warehouses sw ON sw.id = st.source_warehouse_id
    INNER JOIN warehouses dw ON dw.id = st.destination_warehouse_id
    LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id
    GROUP BY
      st.id,
      sw.name,
      sw.city,
      dw.name,
      dw.city
    ORDER BY st.created_at DESC
    LIMIT $1;
    `,
    [limit]
  );

  return result.rows;
}

export async function getStockTransferById(transferId) {
  const [headerResult, itemsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        st.*,
        sw.name AS source_warehouse_name,
        sw.city AS source_warehouse_city,
        dw.name AS destination_warehouse_name,
        dw.city AS destination_warehouse_city
      FROM stock_transfers st
      INNER JOIN warehouses sw ON sw.id = st.source_warehouse_id
      INNER JOIN warehouses dw ON dw.id = st.destination_warehouse_id
      WHERE st.id = $1
      LIMIT 1;
      `,
      [transferId]
    ),
    pool.query(
      `
      SELECT
        sti.id,
        sti.transfer_id,
        sti.product_id,
        sti.quantity,
        sti.stock_form,
        sti.package_size,
        sti.package_unit,
        sti.unit_cost,
        p.name AS product_name,
        p.sku,
        p.product_role,
        p.unit
      FROM stock_transfer_items sti
      INNER JOIN products p ON p.id = sti.product_id
      WHERE sti.transfer_id = $1
      ORDER BY sti.id ASC;
      `,
      [transferId]
    )
  ]);

  const transfer = headerResult.rows[0] || null;

  if (!transfer) {
    return null;
  }

  return {
    ...transfer,
    items: itemsResult.rows
  };
}

async function generateNextTransferNumber(client) {
  const year = new Date().getFullYear();

  const result = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM stock_transfers
    WHERE EXTRACT(YEAR FROM created_at) = $1;
    `,
    [year]
  );

  const nextNumber = Number(result.rows[0]?.count || 0) + 1;
  return `TRF-${year}-${String(nextNumber).padStart(5, "0")}`;
}

export async function performStockEntry(data) {
  if (!data.client) {
    await ensureStockSchema(pool);
  }
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    if (!data.skip_schema && !stockSchemaReady) {
      await ensureStockSchema(client);
    }
    const product = await getProductRecord(client, data.product_id);

    if (!product) {
      const error = new Error("Produit introuvable.");
      error.statusCode = 404;
      throw error;
    }

    const stockItem = await ensureStockItem(client, data.warehouse_id, data.product_id, {
      stock_form: data.stock_form,
      package_size: data.package_size,
      package_unit: data.package_unit
    });
    const quantityUnit =
      stockItem.stock_form === STOCK_FORMS.BULK
        ? normalizeStockUnit(product.stock_unit || product.unit)
        : "unit";
    const movementQuantity =
      data.quantity_unit && stockItem.stock_form === STOCK_FORMS.BULK
        ? convertStockQuantity(data.quantity, data.quantity_unit, quantityUnit)
        : Number(data.quantity);

    const newQuantity = Number(stockItem.quantity) + movementQuantity;

    const updatedStock = await updateStockQuantity(client, stockItem.id, newQuantity);

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: data.movement_type || "IN",
      quantity: movementQuantity,
      stock_form: stockItem.stock_form,
      package_size: stockItem.package_size,
      package_unit: stockItem.package_unit,
      quantity_unit: quantityUnit,
      unit_cost: data.unit_cost ?? 0,
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      notes: data.notes,
      created_by: data.created_by
    });

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }

    return {
      stock: updatedStock,
      movement
    };
  } catch (error) {
    if (shouldManageTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}

export async function performStockExit(data) {
  if (!data.client) {
    await ensureStockSchema(pool);
  }
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    if (!data.skip_schema && !stockSchemaReady) {
      await ensureStockSchema(client);
    }
    const product = await getProductRecord(client, data.product_id);

    if (!product) {
      const error = new Error("Produit introuvable.");
      error.statusCode = 404;
      throw error;
    }

    let stockItem = await resolveStockItem(
      client,
      data.warehouse_id,
      data.product_id,
      {
        stock_form: data.stock_form,
        package_size: data.package_size,
        package_unit: data.package_unit
      }
    );

    if (!stockItem && data.allow_negative) {
      stockItem = await ensureStockItem(
        client,
        data.warehouse_id,
        data.product_id,
        {
          stock_form: data.stock_form || STOCK_FORMS.BULK,
          package_size: data.package_size,
          package_unit: data.package_unit
        }
      );
    }

    if (!stockItem) {
      const error = new Error("Aucun stock trouvé pour ce produit dans ce dépôt.");
      error.statusCode = 404;
      throw error;
    }

    const quantityUnit =
      stockItem.stock_form === STOCK_FORMS.BULK
        ? normalizeStockUnit(product.stock_unit || product.unit)
        : "unit";
    const movementQuantity =
      data.quantity_unit && stockItem.stock_form === STOCK_FORMS.BULK
        ? convertStockQuantity(data.quantity, data.quantity_unit, quantityUnit)
        : Number(data.quantity);

    if (!data.allow_negative && Number(stockItem.quantity) < movementQuantity) {
      const error = new Error("Stock insuffisant pour effectuer la sortie.");
      error.statusCode = 400;
      throw error;
    }

    const newQuantity = Number(stockItem.quantity) - movementQuantity;

    const updatedStock = await updateStockQuantity(client, stockItem.id, newQuantity);

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: data.movement_type || "OUT",
      quantity: movementQuantity,
      stock_form: stockItem.stock_form,
      package_size: stockItem.package_size,
      package_unit: stockItem.package_unit,
      quantity_unit: quantityUnit,
      unit_cost: data.unit_cost ?? 0,
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      notes: data.notes,
      created_by: data.created_by
    });

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }

    return {
      stock: updatedStock,
      movement
    };
  } catch (error) {
    if (shouldManageTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}

function roundStockQuantity(value) {
  return Math.round(Number(value || 0) * 1000000) / 1000000;
}

async function recordInvoiceStockConsumption(client, data) {
  const result = await client.query(
    `
    INSERT INTO invoice_stock_consumptions (
      invoice_id,
      invoice_item_id,
      sold_product_id,
      component_product_id,
      warehouse_id,
      consumption_mode,
      sold_quantity,
      recipe_quantity,
      recipe_unit,
      consumed_quantity,
      consumed_unit,
      stock_form,
      package_size,
      package_unit,
      movement_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *;
    `,
    [
      data.invoice_id,
      data.invoice_item_id,
      data.sold_product_id,
      data.component_product_id,
      data.warehouse_id,
      data.consumption_mode,
      data.sold_quantity,
      data.recipe_quantity ?? null,
      data.recipe_unit || null,
      data.consumed_quantity,
      data.consumed_unit,
      data.stock_form || STOCK_FORMS.BULK,
      data.package_size ?? null,
      data.package_unit || null,
      data.movement_id || null
    ]
  );

  return result.rows[0];
}

export async function consumeStockForInvoiceItem({
  client,
  invoice,
  invoiceItem,
  soldProduct,
  created_by = null,
  schema_ready = false
}) {
  if (!schema_ready) {
    await ensureStockSchema(client);
  }

  const recipesResult = await client.query(
    `
    SELECT
      pr.id,
      pr.component_product_id,
      pr.quantity_required,
      pr.quantity_unit
    FROM product_recipes pr
    WHERE pr.finished_product_id = $1
    ORDER BY pr.id ASC;
    `,
    [soldProduct.id]
  );

  const soldQuantity = Number(invoiceItem.quantity || 0);
  const consumptions = [];
  let totalCost = 0;

  if (!recipesResult.rows.length) {
    return {
      mode: "unconfigured",
      stock_form: null,
      package_size: null,
      package_unit: null,
      total_cost: soldQuantity * Number(soldProduct.cost_price || 0),
      consumptions
    };
  }

  for (const recipe of recipesResult.rows) {
    const componentProduct = await getProductRecord(
      client,
      recipe.component_product_id
    );

    if (!componentProduct) {
      const error = new Error(
        `Composant introuvable pour la recette du produit ${soldProduct.name}.`
      );
      error.statusCode = 404;
      throw error;
    }

    const componentStockUnit = normalizeStockUnit(
      componentProduct.stock_unit || componentProduct.unit
    );
    const recipeQuantity = Number(recipe.quantity_required || 0);
    const requiredInRecipeUnit = recipeQuantity * soldQuantity;
    let consumedQuantity;

    try {
      consumedQuantity = convertStockQuantity(
        requiredInRecipeUnit,
        recipe.quantity_unit,
        componentStockUnit
      );
    } catch (conversionError) {
      const error = new Error(
        `Unite incompatible pour ${componentProduct.name}: recette en ${recipe.quantity_unit}, stock en ${componentStockUnit}.`
      );
      error.statusCode = 400;
      throw error;
    }

    const exitResult = await performStockExit({
      warehouse_id: invoice.warehouse_id,
      product_id: componentProduct.id,
      quantity: consumedQuantity,
      stock_form: STOCK_FORMS.BULK,
      movement_type: "PRODUCTION_CONSUME",
      unit_cost: Number(componentProduct.cost_price || 0),
      reference_type: "invoice_consumption",
      reference_id: invoice.id,
      notes: `Consommation de ${componentProduct.name} pour la facture ${invoice.invoice_number}`,
      created_by,
      allow_negative: true,
      skip_schema: true,
      client
    });
    totalCost +=
      Number(exitResult.movement.quantity || 0) *
      Number(componentProduct.cost_price || 0);

    consumptions.push(
      await recordInvoiceStockConsumption(client, {
        invoice_id: invoice.id,
        invoice_item_id: invoiceItem.id,
        sold_product_id: soldProduct.id,
        component_product_id: componentProduct.id,
        warehouse_id: invoice.warehouse_id,
        consumption_mode: "recipe",
        sold_quantity: soldQuantity,
        recipe_quantity: recipeQuantity,
        recipe_unit: recipe.quantity_unit,
        consumed_quantity: exitResult.movement.quantity,
        consumed_unit: componentStockUnit,
        stock_form: STOCK_FORMS.BULK,
        movement_id: exitResult.movement.id
      })
    );
  }

  return {
    mode: "recipe",
    stock_form: null,
    package_size: null,
    package_unit: null,
    total_cost: totalCost,
    consumptions
  };
}

export async function reverseInvoiceStockConsumptions({
  client,
  invoice,
  reason = "Annulation consommation facture",
  created_by = null,
  schema_ready = false
}) {
  if (!schema_ready) {
    await ensureStockSchema(client);
  }
  const result = await client.query(
    `
    SELECT *
    FROM invoice_stock_consumptions
    WHERE invoice_id = $1
      AND reversed_at IS NULL
    ORDER BY id ASC
    FOR UPDATE;
    `,
    [invoice.id]
  );

  for (const consumption of result.rows) {
    const entryResult = await performStockEntry({
      warehouse_id: consumption.warehouse_id,
      product_id: consumption.component_product_id,
      quantity: consumption.consumed_quantity,
      stock_form: consumption.stock_form,
      package_size: consumption.package_size,
      package_unit: consumption.package_unit,
      reference_type: "invoice_consumption_reversal",
      reference_id: invoice.id,
      notes: `${reason} ${invoice.invoice_number}`,
      created_by,
      skip_schema: true,
      client
    });

    await client.query(
      `
      UPDATE invoice_stock_consumptions
      SET
        reversal_movement_id = $1,
        reversed_at = NOW()
      WHERE id = $2;
      `,
      [entryResult.movement.id, consumption.id]
    );
  }

  return result.rows.length;
}

export async function getBulkStockFlowComparison(filters = {}) {
  await ensureStockSchema(pool);
  const conditions = [`sm.stock_form = 'bulk'`];
  const values = [];

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`sm.warehouse_id = $${values.length}`);
  }

  if (filters.productId) {
    values.push(filters.productId);
    conditions.push(`sm.product_id = $${values.length}`);
  }

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`sm.created_at::date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`sm.created_at::date <= $${values.length}`);
  }

  const query = `
    WITH movement_totals AS (
      SELECT
        sm.warehouse_id,
        sm.product_id,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'IN'
            AND COALESCE(sm.reference_type, '') <> 'invoice_consumption_reversal'
        ), 0) AS bulk_entries,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'TRANSFER_IN'
        ), 0) AS transfer_in,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'TRANSFER_OUT'
        ), 0) AS transfer_out,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'PRODUCTION_CONSUME'
            AND sm.reference_type = 'invoice_consumption'
        ), 0) AS invoice_consumption,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'PRODUCTION_CONSUME'
            AND COALESCE(sm.reference_type, '') <> 'invoice_consumption'
        ), 0) AS production_consumption,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type IN ('OUT', 'TRANSFORM_OUT', 'MIXTURE_OUT')
        ), 0) AS other_consumption,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'IN'
            AND sm.reference_type = 'invoice_consumption_reversal'
        ), 0) AS invoice_reversals
      FROM stock_movements sm
      WHERE ${conditions.join(" AND ")}
      GROUP BY sm.warehouse_id, sm.product_id
    ),
    current_stock AS (
      SELECT
        ws.warehouse_id,
        ws.product_id,
        COALESCE(SUM(ws.quantity), 0) AS current_stock
      FROM warehouse_stock ws
      WHERE ws.stock_form = 'bulk'
      GROUP BY ws.warehouse_id, ws.product_id
    )
    SELECT
      mt.warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      mt.product_id,
      p.name AS product_name,
      p.sku,
      p.product_role,
      p.stock_unit,
      mt.bulk_entries,
      mt.transfer_in,
      mt.transfer_out,
      mt.invoice_consumption,
      mt.production_consumption,
      mt.other_consumption,
      mt.invoice_reversals,
      COALESCE(cs.current_stock, 0) AS current_stock
    FROM movement_totals mt
    INNER JOIN products p ON p.id = mt.product_id
    INNER JOIN warehouses w ON w.id = mt.warehouse_id
    LEFT JOIN current_stock cs
      ON cs.warehouse_id = mt.warehouse_id
      AND cs.product_id = mt.product_id
    ORDER BY w.name ASC, p.name ASC;
  `;

  const result = await pool.query(query, values);
  const rows = result.rows
    .map((row) => {
      const reportingUnit = getReportingStockUnit(row.stock_unit);
      const convert = (value) =>
        roundStockQuantity(
          convertToReportingQuantity(value, row.stock_unit).quantity
        );
      const bulkEntries = convert(row.bulk_entries);
      const transferIn = convert(row.transfer_in);
      const transferOut = convert(row.transfer_out);
      const invoiceConsumption = convert(row.invoice_consumption);
      const productionConsumption = convert(row.production_consumption);
      const otherConsumption = convert(row.other_consumption);
      const invoiceReversals = convert(row.invoice_reversals);
      const theoreticalRemaining = convert(row.current_stock);
      const position = calculateTheoreticalStockPosition({
        currentStock: theoreticalRemaining,
        bulkEntries,
        transferIn,
        transferOut,
        invoiceConsumption,
        productionConsumption,
        otherConsumption,
        invoiceReversals
      });
      const totalConsumption = roundStockQuantity(position.totalConsumption);
      const periodNetFlow = roundStockQuantity(position.netFlow);

      return {
        ...row,
        reporting_unit: reportingUnit,
        bulk_entries: bulkEntries,
        transfer_in: transferIn,
        transfer_out: transferOut,
        invoice_consumption: invoiceConsumption,
        production_consumption: productionConsumption,
        other_consumption: otherConsumption,
        total_consumption: totalConsumption,
        invoice_reversals: invoiceReversals,
        invoiced_difference: roundStockQuantity(
          bulkEntries - invoiceConsumption
        ),
        net_flow: periodNetFlow,
        opening_stock: roundStockQuantity(position.openingStock),
        theoretical_remaining: theoreticalRemaining,
        shortage_quantity: roundStockQuantity(position.shortageQuantity),
        current_stock: theoreticalRemaining
      };
    })
    .filter(
      (row) =>
        !filters.reportingUnit || row.reporting_unit === filters.reportingUnit
    );

  const summaryByUnit = Object.values(
    rows.reduce((acc, row) => {
      const unit = row.reporting_unit;
      acc[unit] ||= {
        reporting_unit: unit,
        bulk_entries: 0,
        transfer_in: 0,
        transfer_out: 0,
        total_consumption: 0,
        invoice_consumption: 0,
        invoice_reversals: 0,
        net_flow: 0,
        opening_stock: 0,
        theoretical_remaining: 0,
        shortage_quantity: 0,
        current_stock: 0
      };

      for (const key of [
        "bulk_entries",
        "transfer_in",
        "transfer_out",
        "total_consumption",
        "invoice_consumption",
        "invoice_reversals",
        "net_flow",
        "opening_stock",
        "theoretical_remaining",
        "shortage_quantity",
        "current_stock"
      ]) {
        acc[unit][key] = roundStockQuantity(acc[unit][key] + row[key]);
      }

      return acc;
    }, {})
  );

  return {
    summary_by_unit: summaryByUnit,
    rows
  };
}

export async function getStockInvoiceBulkReconciliation(filters = {}) {
  await ensureStockSchema(pool);
  const invoiceConditions = [`i.status IN ('issued', 'partial', 'paid')`];
  const invoiceValues = [];

  if (filters.warehouseId) {
    invoiceValues.push(filters.warehouseId);
    invoiceConditions.push(`i.warehouse_id = $${invoiceValues.length}`);
  }

  if (filters.startDate) {
    invoiceValues.push(filters.startDate);
    invoiceConditions.push(`i.invoice_date >= $${invoiceValues.length}`);
  }

  if (filters.endDate) {
    invoiceValues.push(filters.endDate);
    invoiceConditions.push(`i.invoice_date <= $${invoiceValues.length}`);
  }

  if (filters.productId) {
    invoiceValues.push(filters.productId);
    invoiceConditions.push(`pr.component_product_id = $${invoiceValues.length}`);
  }

  const movementConditions = [`sm.stock_form = 'bulk'`];
  const movementValues = [];

  if (filters.warehouseId) {
    movementValues.push(filters.warehouseId);
    movementConditions.push(`sm.warehouse_id = $${movementValues.length}`);
  }

  if (filters.productId) {
    movementValues.push(filters.productId);
    movementConditions.push(`sm.product_id = $${movementValues.length}`);
  }

  if (filters.startDate) {
    movementValues.push(filters.startDate);
    movementConditions.push(`sm.created_at::date >= $${movementValues.length}`);
  }

  if (filters.endDate) {
    movementValues.push(filters.endDate);
    movementConditions.push(`sm.created_at::date <= $${movementValues.length}`);
  }

  const [
    requirementsResult,
    movementsResult,
    recordedConsumptionResult,
    currentStockResult,
    unconfiguredResult
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        i.warehouse_id,
        w.name AS warehouse_name,
        w.city AS warehouse_city,
        pr.component_product_id AS product_id,
        cp.name AS product_name,
        cp.sku,
        cp.stock_unit,
        pr.quantity_unit AS recipe_unit,
        ARRAY_AGG(DISTINCT i.id) AS invoice_ids,
        ARRAY_AGG(DISTINCT ii.product_id) AS finished_product_ids,
        COUNT(DISTINCT i.id)::int AS invoices_count,
        COUNT(DISTINCT ii.product_id)::int AS finished_products_count,
        STRING_AGG(DISTINCT fp.name, ', ' ORDER BY fp.name) AS finished_products,
        COALESCE(SUM(ii.quantity), 0) AS sold_quantity,
        COALESCE(SUM(ii.quantity * pr.quantity_required), 0) AS required_quantity
      FROM invoices i
      INNER JOIN invoice_items ii ON ii.invoice_id = i.id
      INNER JOIN product_recipes pr ON pr.finished_product_id = ii.product_id
      INNER JOIN products cp ON cp.id = pr.component_product_id
      INNER JOIN products fp ON fp.id = ii.product_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      WHERE ${invoiceConditions.join(" AND ")}
      GROUP BY
        i.warehouse_id,
        w.name,
        w.city,
        pr.component_product_id,
        cp.name,
        cp.sku,
        cp.stock_unit,
        pr.quantity_unit;
      `,
      invoiceValues
    ),
    pool.query(
      `
      SELECT
        sm.warehouse_id,
        w.name AS warehouse_name,
        w.city AS warehouse_city,
        sm.product_id,
        p.name AS product_name,
        p.sku,
        p.stock_unit,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'IN'
            AND COALESCE(sm.reference_type, '') <> 'invoice_consumption_reversal'
        ), 0) AS bulk_entries,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'TRANSFER_IN'
        ), 0) AS transfer_in,
        COALESCE(SUM(sm.quantity) FILTER (
          WHERE sm.movement_type = 'TRANSFER_OUT'
        ), 0) AS transfer_out
      FROM stock_movements sm
      INNER JOIN products p ON p.id = sm.product_id
      INNER JOIN warehouses w ON w.id = sm.warehouse_id
      WHERE ${movementConditions.join(" AND ")}
      GROUP BY
        sm.warehouse_id,
        w.name,
        w.city,
        sm.product_id,
        p.name,
        p.sku,
        p.stock_unit;
      `,
      movementValues
    ),
    pool.query(
      `
      SELECT
        isc.warehouse_id,
        w.name AS warehouse_name,
        w.city AS warehouse_city,
        isc.component_product_id AS product_id,
        p.name AS product_name,
        p.sku,
        p.stock_unit,
        isc.consumed_unit,
        ARRAY_AGG(DISTINCT isc.invoice_id) AS recorded_invoice_ids,
        COUNT(DISTINCT isc.invoice_id)::int AS recorded_invoices_count,
        COALESCE(SUM(isc.consumed_quantity), 0) AS recorded_quantity
      FROM invoice_stock_consumptions isc
      INNER JOIN invoices i ON i.id = isc.invoice_id
      INNER JOIN products p ON p.id = isc.component_product_id
      INNER JOIN warehouses w ON w.id = isc.warehouse_id
      WHERE ${invoiceConditions
        .join(" AND ")
        .replaceAll("pr.component_product_id", "isc.component_product_id")}
        AND isc.reversed_at IS NULL
      GROUP BY
        isc.warehouse_id,
        w.name,
        w.city,
        isc.component_product_id,
        p.name,
        p.sku,
        p.stock_unit,
        isc.consumed_unit;
      `,
      invoiceValues
    ),
    pool.query(
      `
      SELECT
        ws.warehouse_id,
        w.name AS warehouse_name,
        w.city AS warehouse_city,
        ws.product_id,
        p.name AS product_name,
        p.sku,
        p.stock_unit,
        COALESCE(SUM(ws.quantity), 0) AS current_stock
      FROM warehouse_stock ws
      INNER JOIN products p ON p.id = ws.product_id
      INNER JOIN warehouses w ON w.id = ws.warehouse_id
      WHERE ws.stock_form = 'bulk'
        ${filters.warehouseId ? "AND ws.warehouse_id = $1" : ""}
        ${filters.productId ? `AND ws.product_id = $${filters.warehouseId ? 2 : 1}` : ""}
      GROUP BY
        ws.warehouse_id,
        w.name,
        w.city,
        ws.product_id,
        p.name,
        p.sku,
        p.stock_unit;
      `,
      [filters.warehouseId, filters.productId].filter(Boolean)
    ),
    pool.query(
      `
      SELECT
        COUNT(*)::int AS invoice_items_count,
        COUNT(DISTINCT i.id)::int AS invoices_count,
        COUNT(DISTINCT ii.product_id)::int AS products_count,
        COALESCE(SUM(ii.quantity), 0) AS sold_quantity
      FROM invoices i
      INNER JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE ${invoiceConditions
        .filter((condition) => !condition.includes("pr.component_product_id"))
        .join(" AND ")}
        AND NOT EXISTS (
          SELECT 1
          FROM product_recipes missing_pr
          WHERE missing_pr.finished_product_id = ii.product_id
        );
      `,
      filters.productId ? invoiceValues.slice(0, -1) : invoiceValues
    )
  ]);

  const rowsByKey = new Map();

  function buildKey(row) {
    return `${row.warehouse_id}:${row.product_id}`;
  }

  function getReconciliationRow(row) {
    const key = buildKey(row);
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        warehouse_city: row.warehouse_city,
        product_id: row.product_id,
        product_name: row.product_name,
        sku: row.sku,
        stock_unit: normalizeStockUnit(row.stock_unit),
        reporting_unit: getReportingStockUnit(row.stock_unit),
        invoice_ids: new Set(),
        recorded_invoice_ids: new Set(),
        finished_product_ids: new Set(),
        finished_products: new Set(),
        sold_quantity: 0,
        recipe_required_quantity: 0,
        recorded_invoice_consumption: 0,
        bulk_entries: 0,
        transfer_in: 0,
        transfer_out: 0,
        current_stock: 0,
        conversion_errors: []
      });
    }

    return rowsByKey.get(key);
  }

  function addConversionError(target, error) {
    if (error?.message && !target.conversion_errors.includes(error.message)) {
      target.conversion_errors.push(error.message);
    }
  }

  function convertQuantityToReporting(row, quantity, fromUnit) {
    const reportingUnit = getReportingStockUnit(row.stock_unit);
    const sourceUnit = normalizeStockUnit(fromUnit, row.stock_unit);
    const converted = convertStockQuantity(quantity, sourceUnit, reportingUnit);

    return roundStockQuantity(converted);
  }

  for (const row of requirementsResult.rows) {
    const target = getReconciliationRow(row);
    (row.invoice_ids || []).forEach((id) => target.invoice_ids.add(Number(id)));
    (row.finished_product_ids || []).forEach((id) =>
      target.finished_product_ids.add(Number(id))
    );
    target.sold_quantity = roundStockQuantity(
      target.sold_quantity + Number(row.sold_quantity || 0)
    );
    String(row.finished_products || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => target.finished_products.add(item));

    try {
      target.recipe_required_quantity = roundStockQuantity(
        target.recipe_required_quantity +
          convertQuantityToReporting(row, row.required_quantity, row.recipe_unit)
      );
    } catch (error) {
      addConversionError(target, error);
    }
  }

  for (const row of movementsResult.rows) {
    const target = getReconciliationRow(row);
    const convert = (quantity) =>
      roundStockQuantity(
        convertToReportingQuantity(quantity, row.stock_unit).quantity
      );
    target.bulk_entries = roundStockQuantity(
      target.bulk_entries + convert(row.bulk_entries)
    );
    target.transfer_in = roundStockQuantity(
      target.transfer_in + convert(row.transfer_in)
    );
    target.transfer_out = roundStockQuantity(
      target.transfer_out + convert(row.transfer_out)
    );
  }

  for (const row of recordedConsumptionResult.rows) {
    const target = getReconciliationRow(row);
    (row.recorded_invoice_ids || []).forEach((id) =>
      target.recorded_invoice_ids.add(Number(id))
    );

    try {
      target.recorded_invoice_consumption = roundStockQuantity(
        target.recorded_invoice_consumption +
          convertQuantityToReporting(row, row.recorded_quantity, row.consumed_unit)
      );
    } catch (error) {
      addConversionError(target, error);
    }
  }

  for (const row of currentStockResult.rows) {
    const key = buildKey(row);
    if (!rowsByKey.has(key)) {
      continue;
    }
    const target = getReconciliationRow(row);
    target.current_stock = roundStockQuantity(
      target.current_stock +
        convertToReportingQuantity(row.current_stock, row.stock_unit).quantity
    );
  }

  const rows = [...rowsByKey.values()]
    .map((row) => {
      const availableBulk = roundStockQuantity(
        row.bulk_entries + row.transfer_in - row.transfer_out
      );
      const reconciliationGap = roundStockQuantity(
        availableBulk - row.recipe_required_quantity
      );
      const recordingGap = roundStockQuantity(
        row.recorded_invoice_consumption - row.recipe_required_quantity
      );
      const hasConversionError = row.conversion_errors.length > 0;
      const status = hasConversionError
        ? "conversion_error"
        : reconciliationGap < 0
          ? "manquant"
          : reconciliationGap > 0
            ? "surplus"
            : "equilibre";
      const recordingStatus = hasConversionError
        ? "conversion_error"
        : row.recipe_required_quantity > 0 &&
            row.recorded_invoice_consumption === 0
          ? "non_comptabilise"
          : recordingGap === 0
            ? "ok"
            : "ecart";

      return {
        ...row,
        invoices_count: row.invoice_ids.size,
        recorded_invoices_count: row.recorded_invoice_ids.size,
        finished_products_count: row.finished_product_ids.size,
        invoice_ids: undefined,
        recorded_invoice_ids: undefined,
        finished_product_ids: undefined,
        finished_products: [...row.finished_products].join(", "),
        available_bulk: availableBulk,
        reconciliation_gap: reconciliationGap,
        recording_gap: recordingGap,
        status,
        recording_status: recordingStatus,
        conversion_error: row.conversion_errors.join(" | ")
      };
    })
    .filter(
      (row) =>
        !filters.reportingUnit || row.reporting_unit === filters.reportingUnit
    )
    .sort((a, b) =>
      `${a.warehouse_name} ${a.product_name}`.localeCompare(
        `${b.warehouse_name} ${b.product_name}`
      )
    );

  const summaryByUnit = Object.values(
    rows.reduce((acc, row) => {
      const unit = row.reporting_unit;
      acc[unit] ||= {
        reporting_unit: unit,
        recipe_required_quantity: 0,
        recorded_invoice_consumption: 0,
        bulk_entries: 0,
        transfer_in: 0,
        transfer_out: 0,
        available_bulk: 0,
        reconciliation_gap: 0,
        recording_gap: 0,
        current_stock: 0
      };

      for (const key of [
        "recipe_required_quantity",
        "recorded_invoice_consumption",
        "bulk_entries",
        "transfer_in",
        "transfer_out",
        "available_bulk",
        "reconciliation_gap",
        "recording_gap",
        "current_stock"
      ]) {
        acc[unit][key] = roundStockQuantity(acc[unit][key] + row[key]);
      }

      return acc;
    }, {})
  );

  const unconfigured = unconfiguredResult.rows[0] || {};

  return {
    summary: {
      total_rows: rows.length,
      shortage_rows: rows.filter((row) => row.status === "manquant").length,
      surplus_rows: rows.filter((row) => row.status === "surplus").length,
      balanced_rows: rows.filter((row) => row.status === "equilibre").length,
      recording_gap_rows: rows.filter((row) => row.recording_status === "ecart")
        .length,
      unrecorded_rows: rows.filter(
        (row) => row.recording_status === "non_comptabilise"
      ).length,
      conversion_error_rows: rows.filter(
        (row) => row.status === "conversion_error"
      ).length,
      reporting_unit: filters.reportingUnit || null,
      unconfigured_invoice_items_count: Number(
        unconfigured.invoice_items_count || 0
      ),
      unconfigured_invoices_count: Number(unconfigured.invoices_count || 0),
      unconfigured_products_count: Number(unconfigured.products_count || 0),
      unconfigured_sold_quantity: roundStockQuantity(
        unconfigured.sold_quantity || 0
      )
    },
    summary_by_unit: summaryByUnit,
    rows
  };
}

export async function performStockAdjustment(data) {
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    const stockItem = await ensureStockItem(client, data.warehouse_id, data.product_id, {
      stock_form: data.stock_form,
      package_size: data.package_size,
      package_unit: data.package_unit
    });

    const adjustedQuantity = Number(data.new_quantity);

    const updatedStock = await updateStockQuantity(client, stockItem.id, adjustedQuantity);

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "ADJUSTMENT",
      quantity: adjustedQuantity,
      stock_form: stockItem.stock_form,
      package_size: stockItem.package_size,
      package_unit: stockItem.package_unit,
      unit_cost: data.unit_cost ?? 0,
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      notes: data.notes,
      created_by: data.created_by
    });

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }

    return {
      stock: updatedStock,
      movement
    };
  } catch (error) {
    if (shouldManageTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}

export async function performStockTransfer(data) {
  if (!data.client) {
    await ensureStockSchema(pool);
  }
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }
    if (!stockSchemaReady) {
      await ensureStockSchema(client);
    }

    const transferNumber = await generateNextTransferNumber(client);

    const headerResult = await client.query(
      `
      INSERT INTO stock_transfers (
        transfer_number,
        source_warehouse_id,
        destination_warehouse_id,
        transfer_date,
        status,
        notes,
        created_by
      )
      VALUES ($1,$2,$3,$4,'completed',$5,$6)
      RETURNING *;
      `,
      [
        transferNumber,
        data.source_warehouse_id,
        data.destination_warehouse_id,
        data.transfer_date,
        data.notes || null,
        data.created_by || null
      ]
    );

    const transfer = headerResult.rows[0];
    const items = [];

    for (const item of data.items) {
      const product = await getProductRecord(client, item.product_id);
      const sourceStock = await getStockItemByVariant(
        client,
        data.source_warehouse_id,
        item.product_id,
        item
      );

      if (!sourceStock) {
        const error = new Error(
          `Aucun stock trouvé pour le produit ID ${item.product_id} dans le dépôt source.`
        );
        error.statusCode = 404;
        throw error;
      }

      const quantityUnit =
        sourceStock.stock_form === STOCK_FORMS.BULK
          ? normalizeStockUnit(product?.stock_unit || product?.unit)
          : "unit";
      const transferQuantity =
        item.quantity_unit && sourceStock.stock_form === STOCK_FORMS.BULK
          ? convertStockQuantity(item.quantity, item.quantity_unit, quantityUnit)
          : Number(item.quantity);

      if (Number(sourceStock.quantity) < transferQuantity) {
        const error = new Error(
          `Stock insuffisant pour le produit ID ${item.product_id} dans le dépôt source.`
        );
        error.statusCode = 400;
        throw error;
      }

      await updateStockQuantity(
        client,
        sourceStock.id,
        Number(sourceStock.quantity) - transferQuantity
      );

      const destinationStock = await ensureStockItem(
        client,
        data.destination_warehouse_id,
        item.product_id,
        item
      );

      await updateStockQuantity(
        client,
        destinationStock.id,
        Number(destinationStock.quantity) + transferQuantity
      );

      const itemResult = await client.query(
        `
        INSERT INTO stock_transfer_items (
          transfer_id,
          product_id,
          quantity,
          stock_form,
          package_size,
          package_unit,
          unit_cost
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *;
        `,
        [
          transfer.id,
          item.product_id,
          transferQuantity,
          normalizeStockForm(item.stock_form),
          item.package_size ?? null,
          item.package_unit ?? null,
          item.unit_cost ?? 0
        ]
      );

      items.push(itemResult.rows[0]);

      await createStockMovement(client, {
        product_id: item.product_id,
        warehouse_id: data.source_warehouse_id,
        movement_type: "TRANSFER_OUT",
        quantity: transferQuantity,
        quantity_unit: quantityUnit,
        stock_form: sourceStock.stock_form,
        package_size: sourceStock.package_size,
        package_unit: sourceStock.package_unit,
        unit_cost: item.unit_cost ?? 0,
        reference_type: "transfer",
        reference_id: transfer.id,
        notes:
          item.notes ||
          `Transfert ${transferNumber} vers dépôt ${data.destination_warehouse_id}`,
        created_by: data.created_by
      });

      await createStockMovement(client, {
        product_id: item.product_id,
        warehouse_id: data.destination_warehouse_id,
        movement_type: "TRANSFER_IN",
        quantity: transferQuantity,
        quantity_unit: quantityUnit,
        stock_form: destinationStock.stock_form,
        package_size: destinationStock.package_size,
        package_unit: destinationStock.package_unit,
        unit_cost: item.unit_cost ?? 0,
        reference_type: "transfer",
        reference_id: transfer.id,
        notes:
          item.notes ||
          `Transfert ${transferNumber} depuis dépôt ${data.source_warehouse_id}`,
        created_by: data.created_by
      });
    }

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }

    return {
      ...transfer,
      items
    };
  } catch (error) {
    if (shouldManageTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}

export async function performBulkToPackageTransform(data) {
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    const [sourceProduct, targetProduct] = await Promise.all([
      getProductRecord(client, data.source_product_id),
      getProductRecord(client, data.target_product_id)
    ]);

    if (!sourceProduct) {
      const error = new Error("Produit source introuvable.");
      error.statusCode = 404;
      throw error;
    }

    if (!targetProduct) {
      const error = new Error("Produit cible introuvable.");
      error.statusCode = 404;
      throw error;
    }

    if (targetProduct.product_role !== PRODUCT_ROLES.FINISHED) {
      const error = new Error(
        "La mise en paquet doit produire un produit fini vendable."
      );
      error.statusCode = 400;
      throw error;
    }

    const sourceStock = await getStockItemByVariant(
      client,
      data.warehouse_id,
      data.source_product_id,
      { stock_form: STOCK_FORMS.BULK }
    );

    if (!sourceStock) {
      const error = new Error("Aucun stock vrac trouvé pour le produit source.");
      error.statusCode = 404;
      throw error;
    }

    if (Number(sourceStock.quantity) < Number(data.source_quantity)) {
      const error = new Error("Stock vrac insuffisant pour effectuer la transformation.");
      error.statusCode = 400;
      throw error;
    }

    const headerResult = await client.query(
      `
      INSERT INTO stock_transformations (
        warehouse_id,
        transformation_type,
        target_product_id,
        target_quantity,
        target_stock_form,
        target_package_size,
        target_package_unit,
        notes,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *;
      `,
      [
        data.warehouse_id,
        "bulk_to_package",
        data.target_product_id,
        data.target_quantity,
        STOCK_FORMS.PACKAGE,
        data.package_size,
        data.package_unit,
        data.notes || null,
        data.created_by || null
      ]
    );

    const transformation = headerResult.rows[0];

    await client.query(
      `
      INSERT INTO stock_transformation_inputs (
        transformation_id,
        source_product_id,
        source_quantity,
        source_stock_form
      )
      VALUES ($1,$2,$3,$4);
      `,
      [
        transformation.id,
        data.source_product_id,
        data.source_quantity,
        STOCK_FORMS.BULK
      ]
    );

    await updateStockQuantity(
      client,
      sourceStock.id,
      Number(sourceStock.quantity) - Number(data.source_quantity)
    );

    const targetStock = await ensureStockItem(
      client,
      data.warehouse_id,
      data.target_product_id,
      {
        stock_form: STOCK_FORMS.PACKAGE,
        package_size: data.package_size,
        package_unit: data.package_unit
      }
    );

    await updateStockQuantity(
      client,
      targetStock.id,
      Number(targetStock.quantity) + Number(data.target_quantity)
    );

    await createStockMovement(client, {
      product_id: data.source_product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "TRANSFORM_OUT",
      quantity: data.source_quantity,
      stock_form: STOCK_FORMS.BULK,
      unit_cost: data.unit_cost ?? 0,
      reference_type: "stock_transformation",
      reference_id: transformation.id,
      notes: data.notes || "Consommation vrac pour mise en paquet.",
      created_by: data.created_by
    });

    const movementIn = await createStockMovement(client, {
      product_id: data.target_product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "TRANSFORM_IN",
      quantity: data.target_quantity,
      stock_form: STOCK_FORMS.PACKAGE,
      package_size: data.package_size,
      package_unit: data.package_unit,
      unit_cost: data.unit_cost ?? 0,
      reference_type: "stock_transformation",
      reference_id: transformation.id,
      notes: data.notes || "Entrée en paquet après transformation.",
      created_by: data.created_by
    });

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }

    return {
      transformation,
      output_movement: movementIn
    };
  } catch (error) {
    if (shouldManageTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}

export async function performStockMixture(data) {
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    let targetProductId = data.target_product_id;

    if (!targetProductId && data.target_product) {
      const createdTargetProduct = await createProductRecord({
        client,
        name: data.target_product.name,
        category: data.target_product.category || null,
        sku: data.target_product.sku,
        barcode: data.target_product.barcode || null,
        product_role: PRODUCT_ROLES.FINISHED,
        unit: data.target_product.unit || "piece",
        cost_price: data.target_product.cost_price ?? data.unit_cost ?? 0,
        selling_price: data.target_product.selling_price ?? 0,
        alert_threshold: data.target_product.alert_threshold ?? 0,
        is_active:
          data.target_product.is_active === undefined
            ? true
            : Boolean(data.target_product.is_active),
        description: data.target_product.description || null,
        sales_account_id: data.target_product.sales_account_id ?? null
      });

      targetProductId = createdTargetProduct.id;
    }

    const targetProduct = await getProductRecord(client, targetProductId);

    if (!targetProduct) {
      const error = new Error("Produit cible de la mixture introuvable.");
      error.statusCode = 404;
      throw error;
    }

    if (targetProduct.product_role !== PRODUCT_ROLES.FINISHED) {
      const error = new Error(
        "La mixture doit produire un produit fini vendable."
      );
      error.statusCode = 400;
      throw error;
    }

    const targetVariant = {
      stock_form: data.target_stock_form,
      package_size: data.package_size,
      package_unit: data.package_unit
    };

    const normalizedTargetVariant = normalizePackageMetadata(
      targetVariant.stock_form,
      targetVariant.package_size,
      targetVariant.package_unit
    );

    const headerResult = await client.query(
      `
      INSERT INTO stock_transformations (
        warehouse_id,
        transformation_type,
        target_product_id,
        target_quantity,
        target_stock_form,
        target_package_size,
        target_package_unit,
        notes,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *;
      `,
      [
        data.warehouse_id,
        "bulk_mix",
        targetProductId,
        data.target_quantity,
        normalizedTargetVariant.stock_form,
        normalizedTargetVariant.package_size,
        normalizedTargetVariant.package_unit,
        data.notes || null,
        data.created_by || null
      ]
    );

    const transformation = headerResult.rows[0];

    for (const component of data.components) {
      const componentProduct = await getProductRecord(client, component.product_id);

      if (!componentProduct) {
        const error = new Error(
          `Produit composant introuvable pour l'ID ${component.product_id}.`
        );
        error.statusCode = 404;
        throw error;
      }

      if (component.product_id === targetProductId) {
        const error = new Error(
          "Le produit cible de la mixture ne peut pas être repris comme composant source."
        );
        error.statusCode = 400;
        throw error;
      }

      if (componentProduct.product_role === PRODUCT_ROLES.PACKAGING) {
        const error = new Error(
          `Le produit ${componentProduct.name} est un emballage et ne peut pas être utilisé dans une mixture.`
        );
        error.statusCode = 400;
        throw error;
      }

      const sourceStock = await getStockItemByVariant(
        client,
        data.warehouse_id,
        component.product_id,
        { stock_form: STOCK_FORMS.BULK }
      );

      if (!sourceStock) {
        const error = new Error(
          `Aucun stock vrac trouvé pour le produit ID ${component.product_id}.`
        );
        error.statusCode = 404;
        throw error;
      }

      if (Number(sourceStock.quantity) < Number(component.quantity)) {
        const error = new Error(
          `Stock insuffisant pour le produit ID ${component.product_id}.`
        );
        error.statusCode = 400;
        throw error;
      }

      await client.query(
        `
        INSERT INTO stock_transformation_inputs (
          transformation_id,
          source_product_id,
          source_quantity,
          source_stock_form
        )
        VALUES ($1,$2,$3,$4);
        `,
        [
          transformation.id,
          component.product_id,
          component.quantity,
          STOCK_FORMS.BULK
        ]
      );

      await updateStockQuantity(
        client,
        sourceStock.id,
        Number(sourceStock.quantity) - Number(component.quantity)
      );

      await createStockMovement(client, {
        product_id: component.product_id,
        warehouse_id: data.warehouse_id,
        movement_type: "MIXTURE_OUT",
        quantity: component.quantity,
        stock_form: STOCK_FORMS.BULK,
        unit_cost: component.unit_cost ?? 0,
        reference_type: "stock_transformation",
        reference_id: transformation.id,
        notes: data.notes || "Consommation vrac pour création de mixture.",
        created_by: data.created_by
      });
    }

    const targetStock = await ensureStockItem(
      client,
      data.warehouse_id,
      targetProductId,
      normalizedTargetVariant
    );

    await updateStockQuantity(
      client,
      targetStock.id,
      Number(targetStock.quantity) + Number(data.target_quantity)
    );

    const outputMovement = await createStockMovement(client, {
      product_id: targetProductId,
      warehouse_id: data.warehouse_id,
      movement_type: "MIXTURE_IN",
      quantity: data.target_quantity,
      stock_form: normalizedTargetVariant.stock_form,
      package_size: normalizedTargetVariant.package_size,
      package_unit: normalizedTargetVariant.package_unit,
      unit_cost: data.unit_cost ?? 0,
      reference_type: "stock_transformation",
      reference_id: transformation.id,
      notes: data.notes || "Entrée du produit mixture.",
      created_by: data.created_by
    });

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }

    return {
      transformation,
      target_product: targetProduct,
      output_movement: outputMovement
    };
  } catch (error) {
    if (shouldManageTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldManageTransaction) {
      client.release();
    }
  }
}
