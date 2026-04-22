import { pool } from "../config/db.js";
import { createProduct as createProductRecord } from "./product.model.js";

const STOCK_FORMS = {
  BULK: "bulk",
  PACKAGE: "package"
};

const PRODUCT_ROLES = {
  FINISHED: "finished_product",
  RAW_MATERIAL: "raw_material",
  PACKAGING: "packaging_material"
};

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
      unit_cost,
      reference_type,
      reference_id,
      notes,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
  const result = await pool.query(
    `
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
      p.unit,
      p.alert_threshold,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM warehouse_stock ws
    INNER JOIN products p ON p.id = ws.product_id
    INNER JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.warehouse_id = $1
    ORDER BY p.name ASC, ws.stock_form ASC, COALESCE(ws.package_size, 0) ASC;
    `,
    [warehouseId]
  );

  return result.rows;
}

export async function getAllStockSummary() {
  const result = await pool.query(
    `
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
      p.unit,
      p.alert_threshold,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM warehouse_stock ws
    INNER JOIN products p ON p.id = ws.product_id
    INNER JOIN warehouses w ON w.id = ws.warehouse_id
    ORDER BY w.name ASC, p.name ASC, ws.stock_form ASC, COALESCE(ws.package_size, 0) ASC;
    `
  );

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

  const result = await pool.query(
    `
    SELECT
      sm.*,
      p.name AS product_name,
      p.sku,
      p.unit,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id
    INNER JOIN warehouses w ON w.id = sm.warehouse_id
    ${whereClause}
    ORDER BY sm.created_at DESC
    LIMIT $${index};
    `,
    values
  );

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

    const newQuantity = Number(stockItem.quantity) + Number(data.quantity);

    const updatedStock = await updateStockQuantity(client, stockItem.id, newQuantity);

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "IN",
      quantity: data.quantity,
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

export async function performStockExit(data) {
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    const stockItem = await resolveStockItem(
      client,
      data.warehouse_id,
      data.product_id,
      {
        stock_form: data.stock_form,
        package_size: data.package_size,
        package_unit: data.package_unit
      }
    );

    if (!stockItem) {
      const error = new Error("Aucun stock trouvé pour ce produit dans ce dépôt.");
      error.statusCode = 404;
      throw error;
    }

    if (Number(stockItem.quantity) < Number(data.quantity)) {
      const error = new Error("Stock insuffisant pour effectuer la sortie.");
      error.statusCode = 400;
      throw error;
    }

    const newQuantity = Number(stockItem.quantity) - Number(data.quantity);

    const updatedStock = await updateStockQuantity(client, stockItem.id, newQuantity);

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "OUT",
      quantity: data.quantity,
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
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
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

      if (Number(sourceStock.quantity) < Number(item.quantity)) {
        const error = new Error(
          `Stock insuffisant pour le produit ID ${item.product_id} dans le dépôt source.`
        );
        error.statusCode = 400;
        throw error;
      }

      await updateStockQuantity(
        client,
        sourceStock.id,
        Number(sourceStock.quantity) - Number(item.quantity)
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
        Number(destinationStock.quantity) + Number(item.quantity)
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
          item.quantity,
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
        quantity: item.quantity,
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
        quantity: item.quantity,
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
