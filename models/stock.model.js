import { pool } from "../config/db.js";

export async function getWarehouseStock(warehouseId) {
  const query = `
    SELECT
      ws.id,
      ws.warehouse_id,
      ws.product_id,
      ws.quantity,
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
    ORDER BY p.name ASC;
  `;

  const result = await pool.query(query, [warehouseId]);
  return result.rows;
}

export async function getAllStockSummary() {
  const query = `
    SELECT
      ws.id,
      ws.warehouse_id,
      ws.product_id,
      ws.quantity,
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
    ORDER BY w.name ASC, p.name ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getStockItem(warehouseId, productId) {
  const query = `
    SELECT *
    FROM warehouse_stock
    WHERE warehouse_id = $1 AND product_id = $2
    LIMIT 1;
  `;
  const result = await pool.query(query, [warehouseId, productId]);
  return result.rows[0] || null;
}

export async function createStockItem(warehouseId, productId, quantity = 0) {
  const query = `
    INSERT INTO warehouse_stock (
      warehouse_id,
      product_id,
      quantity
    )
    VALUES ($1, $2, $3)
    RETURNING *;
  `;

  const result = await pool.query(query, [warehouseId, productId, quantity]);
  return result.rows[0];
}

export async function updateStockQuantity(client, warehouseId, productId, quantity) {
  const query = `
    UPDATE warehouse_stock
    SET
      quantity = $1,
      updated_at = NOW()
    WHERE warehouse_id = $2 AND product_id = $3
    RETURNING *;
  `;

  const result = await client.query(query, [quantity, warehouseId, productId]);
  return result.rows[0] || null;
}

export async function createStockMovement(client, data) {
  const query = `
    INSERT INTO stock_movements (
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      unit_cost,
      reference_type,
      reference_id,
      notes,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *;
  `;

  const values = [
    data.product_id,
    data.warehouse_id,
    data.movement_type,
    data.quantity,
    data.unit_cost ?? 0,
    data.reference_type || null,
    data.reference_id || null,
    data.notes || null,
    data.created_by || null
  ];

  const result = await client.query(query, values);
  return result.rows[0];
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
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id
    INNER JOIN warehouses w ON w.id = sm.warehouse_id
    ${whereClause}
    ORDER BY sm.created_at DESC
    LIMIT $${index};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

export async function performStockEntry(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let stockItem = await client.query(
      `
      SELECT *
      FROM warehouse_stock
      WHERE warehouse_id = $1 AND product_id = $2
      LIMIT 1;
      `,
      [data.warehouse_id, data.product_id]
    );

    let currentStock = stockItem.rows[0] || null;

    if (!currentStock) {
      const created = await client.query(
        `
        INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
        VALUES ($1, $2, $3)
        RETURNING *;
        `,
        [data.warehouse_id, data.product_id, 0]
      );
      currentStock = created.rows[0];
    }

    const newQuantity = Number(currentStock.quantity) + Number(data.quantity);

    const updatedStock = await updateStockQuantity(
      client,
      data.warehouse_id,
      data.product_id,
      newQuantity
    );

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "IN",
      quantity: data.quantity,
      unit_cost: data.unit_cost ?? 0,
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      notes: data.notes,
      created_by: data.created_by
    });

    await client.query("COMMIT");

    return {
      stock: updatedStock,
      movement
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function performStockExit(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const stockResult = await client.query(
      `
      SELECT *
      FROM warehouse_stock
      WHERE warehouse_id = $1 AND product_id = $2
      LIMIT 1;
      `,
      [data.warehouse_id, data.product_id]
    );

    const currentStock = stockResult.rows[0] || null;

    if (!currentStock) {
      const error = new Error("Aucun stock trouvé pour ce produit dans ce dépôt.");
      error.statusCode = 404;
      throw error;
    }

    if (Number(currentStock.quantity) < Number(data.quantity)) {
      const error = new Error("Stock insuffisant pour effectuer la sortie.");
      error.statusCode = 400;
      throw error;
    }

    const newQuantity = Number(currentStock.quantity) - Number(data.quantity);

    const updatedStock = await updateStockQuantity(
      client,
      data.warehouse_id,
      data.product_id,
      newQuantity
    );

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "OUT",
      quantity: data.quantity,
      unit_cost: data.unit_cost ?? 0,
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      notes: data.notes,
      created_by: data.created_by
    });

    await client.query("COMMIT");

    return {
      stock: updatedStock,
      movement
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function performStockAdjustment(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const stockResult = await client.query(
      `
      SELECT *
      FROM warehouse_stock
      WHERE warehouse_id = $1 AND product_id = $2
      LIMIT 1;
      `,
      [data.warehouse_id, data.product_id]
    );

    let currentStock = stockResult.rows[0] || null;

    if (!currentStock) {
      const created = await client.query(
        `
        INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
        VALUES ($1, $2, $3)
        RETURNING *;
        `,
        [data.warehouse_id, data.product_id, 0]
      );
      currentStock = created.rows[0];
    }

    const adjustedQuantity = Number(data.new_quantity);

    const updatedStock = await updateStockQuantity(
      client,
      data.warehouse_id,
      data.product_id,
      adjustedQuantity
    );

    const movement = await createStockMovement(client, {
      product_id: data.product_id,
      warehouse_id: data.warehouse_id,
      movement_type: "ADJUSTMENT",
      quantity: adjustedQuantity,
      unit_cost: data.unit_cost ?? 0,
      reference_type: data.reference_type,
      reference_id: data.reference_id,
      notes: data.notes,
      created_by: data.created_by
    });

    await client.query("COMMIT");

    return {
      stock: updatedStock,
      movement
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}