import { pool } from "../config/db.js";

function normalizeUnitToBase(unit) {
  const value = String(unit || "").trim().toLowerCase();

  if (value === "kg") return "g";
  if (value === "l") return "ml";
  return value;
}

function convertToBaseQuantity(quantity, unit) {
  const numeric = Number(quantity || 0);
  const normalizedUnit = String(unit || "").trim().toLowerCase();

  if (normalizedUnit === "kg") return numeric * 1000;
  if (normalizedUnit === "l") return numeric * 1000;
  return numeric;
}

async function getProductById(client, productId) {
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

async function getBulkStockItem(client, warehouseId, productId) {
  const result = await client.query(
    `
    SELECT *
    FROM warehouse_stock
    WHERE warehouse_id = $1
      AND product_id = $2
      AND stock_form = 'bulk'
    LIMIT 1;
    `,
    [warehouseId, productId]
  );

  return result.rows[0] || null;
}

async function ensureBulkStockItem(client, warehouseId, productId) {
  let stockItem = await getBulkStockItem(client, warehouseId, productId);

  if (!stockItem) {
    const created = await client.query(
      `
      INSERT INTO warehouse_stock (
        warehouse_id,
        product_id,
        quantity,
        stock_form,
        package_size,
        package_unit
      )
      VALUES ($1, $2, 0, 'bulk', NULL, NULL)
      RETURNING *;
      `,
      [warehouseId, productId]
    );
    stockItem = created.rows[0];
  }

  return stockItem;
}

async function updateStockQuantity(client, stockItemId, quantity) {
  const result = await client.query(
    `
    UPDATE warehouse_stock
    SET quantity = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *;
    `,
    [quantity, stockItemId]
  );

  return result.rows[0] || null;
}

async function createStockMovement(client, data) {
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
      unit_cost,
      reference_type,
      reference_id,
      notes,
      created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *;
    `,
    [
      data.product_id,
      data.warehouse_id,
      data.movement_type,
      data.quantity,
      "bulk",
      null,
      null,
      data.unit_cost ?? 0,
      data.reference_type || null,
      data.reference_id || null,
      data.notes || null,
      data.created_by || null
    ]
  );

  return result.rows[0];
}

export async function getRecipesByFinishedProduct(finishedProductId) {
  const result = await pool.query(
    `
    SELECT
      pr.id,
      pr.finished_product_id,
      pr.component_product_id,
      pr.quantity_required,
      pr.quantity_unit,
      pr.created_at,
      pr.updated_at,
      fp.name AS finished_product_name,
      fp.sku AS finished_product_sku,
      fp.unit AS finished_product_unit,
      cp.name AS component_product_name,
      cp.sku AS component_product_sku,
      cp.unit AS component_unit
    FROM product_recipes pr
    INNER JOIN products fp ON fp.id = pr.finished_product_id
    INNER JOIN products cp ON cp.id = pr.component_product_id
    WHERE pr.finished_product_id = $1
    ORDER BY pr.id ASC;
    `,
    [finishedProductId]
  );

  return result.rows;
}

export async function createOrUpdateRecipeItem(data) {
  const result = await pool.query(
    `
    INSERT INTO product_recipes (
      finished_product_id,
      component_product_id,
      quantity_required,
      quantity_unit
    )
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (finished_product_id, component_product_id)
    DO UPDATE SET
      quantity_required = EXCLUDED.quantity_required,
      quantity_unit = EXCLUDED.quantity_unit,
      updated_at = NOW()
    RETURNING *;
    `,
    [
      data.finished_product_id,
      data.component_product_id,
      data.quantity_required,
      data.quantity_unit
    ]
  );

  return result.rows[0];
}

export async function deleteRecipeItem(recipeId) {
  const result = await pool.query(
    `
    DELETE FROM product_recipes
    WHERE id = $1
    RETURNING *;
    `,
    [recipeId]
  );

  return result.rows[0] || null;
}

async function generateNextBatchNumber(client) {
  const year = new Date().getFullYear();
  const result = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM production_batches
    WHERE EXTRACT(YEAR FROM created_at) = $1;
    `,
    [year]
  );

  const nextNumber = Number(result.rows[0]?.count || 0) + 1;
  return `PRD-${year}-${String(nextNumber).padStart(5, "0")}`;
}

export async function getProductionBatches(limit = 100) {
  const result = await pool.query(
    `
    SELECT
      pb.id,
      pb.batch_number,
      pb.warehouse_id,
      pb.finished_product_id,
      pb.quantity_produced,
      pb.production_date,
      pb.status,
      pb.notes,
      pb.created_by,
      pb.created_at,
      pb.updated_at,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      p.name AS finished_product_name,
      p.sku AS finished_product_sku,
      p.unit AS finished_product_unit,
      COALESCE(COUNT(pbi.id), 0)::int AS components_count
    FROM production_batches pb
    INNER JOIN warehouses w ON w.id = pb.warehouse_id
    INNER JOIN products p ON p.id = pb.finished_product_id
    LEFT JOIN production_batch_items pbi ON pbi.batch_id = pb.id
    GROUP BY pb.id, w.name, w.city, p.name, p.sku, p.unit
    ORDER BY pb.created_at DESC
    LIMIT $1;
    `,
    [limit]
  );

  return result.rows;
}

export async function getProductionBatchById(batchId) {
  const headerResult = await pool.query(
    `
    SELECT
      pb.*,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      p.name AS finished_product_name,
      p.sku AS finished_product_sku,
      p.unit AS finished_product_unit
    FROM production_batches pb
    INNER JOIN warehouses w ON w.id = pb.warehouse_id
    INNER JOIN products p ON p.id = pb.finished_product_id
    WHERE pb.id = $1
    LIMIT 1;
    `,
    [batchId]
  );

  const header = headerResult.rows[0] || null;

  if (!header) {
    return null;
  }

  const itemsResult = await pool.query(
    `
    SELECT
      pbi.id,
      pbi.batch_id,
      pbi.component_product_id,
      pbi.quantity_consumed,
      pbi.quantity_unit,
      pbi.unit_cost,
      cp.name AS component_product_name,
      cp.sku AS component_product_sku,
      cp.unit AS component_unit
    FROM production_batch_items pbi
    INNER JOIN products cp ON cp.id = pbi.component_product_id
    WHERE pbi.batch_id = $1
    ORDER BY pbi.id ASC;
    `,
    [batchId]
  );

  return {
    ...header,
    items: itemsResult.rows
  };
}

export async function createProductionBatch(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const finishedProduct = await getProductById(client, data.finished_product_id);

    if (!finishedProduct) {
      const error = new Error("Produit fini introuvable.");
      error.statusCode = 404;
      throw error;
    }

    const recipesResult = await client.query(
      `
      SELECT *
      FROM product_recipes
      WHERE finished_product_id = $1
      ORDER BY id ASC;
      `,
      [data.finished_product_id]
    );

    const recipeRows = recipesResult.rows;

    if (!recipeRows.length) {
      const error = new Error("Aucune recette définie pour ce produit.");
      error.statusCode = 400;
      throw error;
    }

    const batchNumber = await generateNextBatchNumber(client);

    const batchHeaderResult = await client.query(
      `
      INSERT INTO production_batches (
        batch_number,
        warehouse_id,
        finished_product_id,
        quantity_produced,
        production_date,
        status,
        notes,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,'completed',$6,$7)
      RETURNING *;
      `,
      [
        batchNumber,
        data.warehouse_id,
        data.finished_product_id,
        data.quantity_produced,
        data.production_date,
        data.notes || null,
        data.created_by || null
      ]
    );

    const batch = batchHeaderResult.rows[0];
    const producedQty = Number(data.quantity_produced || 0);
    const consumedItems = [];

    for (const recipe of recipeRows) {
      const componentProduct = await getProductById(client, recipe.component_product_id);

      if (!componentProduct) {
        const error = new Error(
          `Composant introuvable pour la recette (product_id=${recipe.component_product_id}).`
        );
        error.statusCode = 404;
        throw error;
      }

      const requiredQtyBase =
        convertToBaseQuantity(recipe.quantity_required, recipe.quantity_unit) *
        producedQty;

      const recipeBaseUnit = normalizeUnitToBase(recipe.quantity_unit);
      const componentBaseUnit = normalizeUnitToBase(componentProduct.unit);

      if (recipeBaseUnit !== componentBaseUnit) {
        const error = new Error(
          `Incohérence d'unité pour ${componentProduct.name}: recette en ${recipe.quantity_unit}, produit en ${componentProduct.unit}.`
        );
        error.statusCode = 400;
        throw error;
      }

      const sourceStock = await ensureBulkStockItem(
        client,
        data.warehouse_id,
        componentProduct.id
      );

      if (Number(sourceStock.quantity) < Number(requiredQtyBase)) {
        const error = new Error(
          `Stock vrac insuffisant pour ${componentProduct.name}. Requis: ${requiredQtyBase}, disponible: ${sourceStock.quantity}.`
        );
        error.statusCode = 400;
        throw error;
      }

      await updateStockQuantity(
        client,
        sourceStock.id,
        Number(sourceStock.quantity) - Number(requiredQtyBase)
      );

      const batchItemResult = await client.query(
        `
        INSERT INTO production_batch_items (
          batch_id,
          component_product_id,
          quantity_consumed,
          quantity_unit,
          unit_cost
        )
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *;
        `,
        [
          batch.id,
          componentProduct.id,
          requiredQtyBase,
          componentBaseUnit,
          Number(componentProduct.cost_price || 0)
        ]
      );

      consumedItems.push(batchItemResult.rows[0]);

      await createStockMovement(client, {
        product_id: componentProduct.id,
        warehouse_id: data.warehouse_id,
        movement_type: "PRODUCTION_CONSUME",
        quantity: requiredQtyBase,
        unit_cost: Number(componentProduct.cost_price || 0),
        reference_type: "production_batch",
        reference_id: batch.id,
        notes: data.notes || `Consommation composant pour batch ${batchNumber}`,
        created_by: data.created_by
      });
    }

    const finishedStock = await ensureBulkStockItem(
      client,
      data.warehouse_id,
      data.finished_product_id
    );

    await updateStockQuantity(
      client,
      finishedStock.id,
      Number(finishedStock.quantity) + Number(producedQty)
    );

    await createStockMovement(client, {
      product_id: data.finished_product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "PRODUCTION_OUTPUT",
      quantity: producedQty,
      unit_cost: Number(finishedProduct.cost_price || 0),
      reference_type: "production_batch",
      reference_id: batch.id,
      notes: data.notes || `Production terminée batch ${batchNumber}`,
      created_by: data.created_by
    });

    await client.query("COMMIT");

    return {
      ...batch,
      items: consumedItems
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
