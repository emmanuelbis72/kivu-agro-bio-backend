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
      p.stock_unit,
      p.product_type,
      p.pack_size,
      p.pack_unit,
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
      p.stock_unit,
      p.product_type,
      p.pack_size,
      p.pack_unit,
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
      p.stock_unit,
      p.product_type,
      p.pack_size,
      p.pack_unit,
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

export async function getStockTransfers(limit = 100) {
  const query = `
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
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getStockTransferById(transferId) {
  const headerQuery = `
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
  `;

  const itemsQuery = `
    SELECT
      sti.id,
      sti.transfer_id,
      sti.product_id,
      sti.quantity,
      sti.unit_cost,
      p.name AS product_name,
      p.sku,
      p.unit,
      p.stock_unit,
      p.product_type,
      p.pack_size,
      p.pack_unit
    FROM stock_transfer_items sti
    INNER JOIN products p ON p.id = sti.product_id
    WHERE sti.transfer_id = $1
    ORDER BY sti.id ASC;
  `;

  const [headerResult, itemsResult] = await Promise.all([
    pool.query(headerQuery, [transferId]),
    pool.query(itemsQuery, [transferId])
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

export async function generateNextTransferNumber(client) {
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

export async function performStockTransfer(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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
      const sourceStockResult = await client.query(
        `
        SELECT *
        FROM warehouse_stock
        WHERE warehouse_id = $1 AND product_id = $2
        LIMIT 1;
        `,
        [data.source_warehouse_id, item.product_id]
      );

      const sourceStock = sourceStockResult.rows[0] || null;

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

      const newSourceQty = Number(sourceStock.quantity) - Number(item.quantity);

      await updateStockQuantity(
        client,
        data.source_warehouse_id,
        item.product_id,
        newSourceQty
      );

      let destinationStockResult = await client.query(
        `
        SELECT *
        FROM warehouse_stock
        WHERE warehouse_id = $1 AND product_id = $2
        LIMIT 1;
        `,
        [data.destination_warehouse_id, item.product_id]
      );

      let destinationStock = destinationStockResult.rows[0] || null;

      if (!destinationStock) {
        const createdDestination = await client.query(
          `
          INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
          VALUES ($1, $2, 0)
          RETURNING *;
          `,
          [data.destination_warehouse_id, item.product_id]
        );
        destinationStock = createdDestination.rows[0];
      }

      const newDestinationQty =
        Number(destinationStock.quantity) + Number(item.quantity);

      await updateStockQuantity(
        client,
        data.destination_warehouse_id,
        item.product_id,
        newDestinationQty
      );

      const itemResult = await client.query(
        `
        INSERT INTO stock_transfer_items (
          transfer_id,
          product_id,
          quantity,
          unit_cost
        )
        VALUES ($1,$2,$3,$4)
        RETURNING *;
        `,
        [transfer.id, item.product_id, item.quantity, item.unit_cost ?? 0]
      );

      items.push(itemResult.rows[0]);

      await createStockMovement(client, {
        product_id: item.product_id,
        warehouse_id: data.source_warehouse_id,
        movement_type: "OUT",
        quantity: item.quantity,
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
        movement_type: "IN",
        quantity: item.quantity,
        unit_cost: item.unit_cost ?? 0,
        reference_type: "transfer",
        reference_id: transfer.id,
        notes:
          item.notes ||
          `Transfert ${transferNumber} depuis dépôt ${data.source_warehouse_id}`,
        created_by: data.created_by
      });
    }

    await client.query("COMMIT");

    return {
      ...transfer,
      items
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}