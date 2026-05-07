import { pool } from "../config/db.js";
import {
  createPurchaseInvoiceWithItems,
  ensurePurchaseInvoicesSchema,
  getNextPurchaseInvoiceNumberForDate,
  getPurchaseInvoiceById
} from "./purchaseInvoice.model.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function getClient(externalClient) {
  if (externalClient) {
    return { client: externalClient, shouldManageTransaction: false };
  }

  return { client: await pool.connect(), shouldManageTransaction: true };
}

export async function ensurePurchaseOrdersSchema(executor = pool) {
  await ensurePurchaseInvoicesSchema(executor);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      purchase_order_number VARCHAR(50) NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      order_date DATE NOT NULL,
      expected_date DATE,
      status VARCHAR(30) NOT NULL DEFAULT 'ordered',
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT purchase_orders_status_chk CHECK (
        status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')
      )
    );
  `);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id SERIAL PRIMARY KEY,
      purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      ordered_quantity NUMERIC(14,2) NOT NULL,
      received_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(14,2) NOT NULL,
      line_total NUMERIC(14,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT purchase_order_items_ordered_quantity_chk CHECK (ordered_quantity > 0),
      CONSTRAINT purchase_order_items_received_quantity_chk CHECK (received_quantity >= 0),
      CONSTRAINT purchase_order_items_unit_cost_chk CHECK (unit_cost >= 0),
      CONSTRAINT purchase_order_items_line_total_chk CHECK (line_total >= 0)
    );
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id
    ON purchase_orders(supplier_id);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_warehouse_id
    ON purchase_orders(warehouse_id);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_order_items_purchase_order_id
    ON purchase_order_items(purchase_order_id);
  `);
}

export async function getNextPurchaseOrderNumberForDate(orderDate) {
  await ensurePurchaseOrdersSchema(pool);

  const date = new Date(orderDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  const result = await pool.query(
    `
    SELECT COALESCE(
      MAX(NULLIF(REGEXP_REPLACE(SPLIT_PART(purchase_order_number, '/', 1), '[^0-9]', '', 'g'), '')::int),
      0
    ) AS max_number
    FROM purchase_orders
    WHERE EXTRACT(YEAR FROM order_date) = $1
      AND EXTRACT(MONTH FROM order_date) = $2
      AND purchase_order_number ~ '^BCA-[0-9]+/[0-9]{2}-[0-9]{4}$';
    `,
    [year, Number(month)]
  );

  const nextNumber = Number(result.rows[0]?.max_number || 0) + 1;
  return `BCA-${String(nextNumber).padStart(3, "0")}/${month}-${year}`;
}

export async function getAllPurchaseOrders() {
  await ensurePurchaseOrdersSchema(pool);

  const query = `
    SELECT
      po.id,
      po.purchase_order_number,
      po.supplier_id,
      po.warehouse_id,
      po.order_date,
      po.expected_date,
      po.status,
      po.subtotal,
      po.tax_amount,
      po.total_amount,
      po.notes,
      po.created_by,
      po.created_at,
      po.updated_at,
      s.business_name AS supplier_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      COALESCE(item_stats.items_count, 0)::int AS items_count,
      COALESCE(item_stats.total_ordered_quantity, 0) AS total_ordered_quantity,
      COALESCE(item_stats.total_received_quantity, 0) AS total_received_quantity
    FROM purchase_orders po
    INNER JOIN suppliers s ON s.id = po.supplier_id
    INNER JOIN warehouses w ON w.id = po.warehouse_id
    LEFT JOIN (
      SELECT
        purchase_order_id,
        COUNT(*)::int AS items_count,
        COALESCE(SUM(ordered_quantity), 0) AS total_ordered_quantity,
        COALESCE(SUM(received_quantity), 0) AS total_received_quantity
      FROM purchase_order_items
      GROUP BY purchase_order_id
    ) AS item_stats ON item_stats.purchase_order_id = po.id
    ORDER BY po.created_at DESC, po.id DESC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePurchaseOrdersSchema(pool),
    query
  });

  return result.rows;
}

export async function getPurchaseOrderById(id) {
  await ensurePurchaseOrdersSchema(pool);

  const headerQuery = `
    SELECT
      po.*,
      s.business_name AS supplier_name,
      s.phone AS supplier_phone,
      s.email AS supplier_email,
      s.city AS supplier_city,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM purchase_orders po
    INNER JOIN suppliers s ON s.id = po.supplier_id
    INNER JOIN warehouses w ON w.id = po.warehouse_id
    WHERE po.id = $1
    LIMIT 1;
  `;

  const itemsQuery = `
    SELECT
      poi.id,
      poi.purchase_order_id,
      poi.product_id,
      poi.ordered_quantity,
      poi.received_quantity,
      GREATEST(poi.ordered_quantity - poi.received_quantity, 0) AS remaining_quantity,
      poi.unit_cost,
      poi.line_total,
      p.name AS product_name,
      p.sku,
      p.barcode,
      p.product_role,
      p.unit
    FROM purchase_order_items poi
    INNER JOIN products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = $1
    ORDER BY poi.id ASC;
  `;

  const relatedInvoicesQuery = `
    SELECT
      pi.id,
      pi.purchase_invoice_number,
      pi.invoice_date,
      pi.status,
      pi.total_amount,
      pi.paid_amount,
      pi.balance_due,
      pi.accounting_status,
      pi.accounting_entry_id,
      pi.accounting_message,
      pi.created_at
    FROM purchase_invoices pi
    WHERE pi.purchase_order_id = $1
    ORDER BY pi.invoice_date DESC, pi.created_at DESC, pi.id DESC;
  `;

  const [headerResult, itemsResult, invoicesResult] = await Promise.all([
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensurePurchaseOrdersSchema(pool),
      query: headerQuery,
      values: [id]
    }),
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensurePurchaseOrdersSchema(pool),
      query: itemsQuery,
      values: [id]
    }),
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensurePurchaseOrdersSchema(pool),
      query: relatedInvoicesQuery,
      values: [id]
    })
  ]);

  const purchaseOrder = headerResult.rows[0] || null;

  if (!purchaseOrder) {
    return null;
  }

  return {
    ...purchaseOrder,
    items: itemsResult.rows,
    related_invoices: invoicesResult.rows
  };
}

async function ensurePurchaseOrderCanBeChanged(client, purchaseOrderId) {
  const headerResult = await client.query(
    `
    SELECT *
    FROM purchase_orders
    WHERE id = $1
    LIMIT 1;
    `,
    [purchaseOrderId]
  );

  const purchaseOrder = headerResult.rows[0] || null;

  if (!purchaseOrder) {
    return { purchaseOrder: null, error: "Commande d'achat introuvable." };
  }

  const receiptsResult = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM purchase_order_items
    WHERE purchase_order_id = $1
      AND COALESCE(received_quantity, 0) > 0;
    `,
    [purchaseOrderId]
  );

  if (Number(receiptsResult.rows[0]?.count || 0) > 0) {
    return {
      purchaseOrder,
      error:
        "Impossible de modifier ou supprimer une commande d'achat deja receptionnee partiellement."
    };
  }

  return { purchaseOrder, error: null };
}

async function recomputePurchaseOrderStatus(client, purchaseOrderId) {
  const statsResult = await client.query(
    `
    SELECT
      COALESCE(SUM(ordered_quantity), 0) AS total_ordered,
      COALESCE(SUM(received_quantity), 0) AS total_received
    FROM purchase_order_items
    WHERE purchase_order_id = $1;
    `,
    [purchaseOrderId]
  );

  const totalOrdered = Number(statsResult.rows[0]?.total_ordered || 0);
  const totalReceived = Number(statsResult.rows[0]?.total_received || 0);

  let status = "ordered";

  if (totalOrdered > 0 && totalReceived >= totalOrdered) {
    status = "received";
  } else if (totalReceived > 0) {
    status = "partially_received";
  }

  await client.query(
    `
    UPDATE purchase_orders
    SET
      status = $1,
      updated_at = NOW()
    WHERE id = $2;
    `,
    [status, purchaseOrderId]
  );
}

export async function createPurchaseOrderWithItems(data) {
  await ensurePurchaseOrdersSchema(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertResult = await client.query(
      `
      INSERT INTO purchase_orders (
        purchase_order_number,
        supplier_id,
        warehouse_id,
        order_date,
        expected_date,
        status,
        subtotal,
        tax_amount,
        total_amount,
        notes,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,'ordered',$6,$7,$8,$9,$10)
      RETURNING *;
      `,
      [
        data.purchase_order_number,
        data.supplier_id,
        data.warehouse_id,
        data.order_date,
        data.expected_date || null,
        data.subtotal,
        data.tax_amount,
        data.total_amount,
        data.notes || null,
        data.created_by || null
      ]
    );

    const purchaseOrder = insertResult.rows[0];

    for (const item of data.items) {
      await client.query(
        `
        INSERT INTO purchase_order_items (
          purchase_order_id,
          product_id,
          ordered_quantity,
          received_quantity,
          unit_cost,
          line_total
        )
        VALUES ($1,$2,$3,0,$4,$5);
        `,
        [
          purchaseOrder.id,
          item.product_id,
          item.ordered_quantity,
          item.unit_cost,
          item.line_total
        ]
      );
    }

    await client.query("COMMIT");
    return getPurchaseOrderById(purchaseOrder.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePurchaseOrderWithItems(id, data) {
  await ensurePurchaseOrdersSchema(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { error } = await ensurePurchaseOrderCanBeChanged(client, id);

    if (error) {
      const updateError = new Error(error);
      updateError.statusCode = 400;
      throw updateError;
    }

    await client.query(
      `
      UPDATE purchase_orders
      SET
        supplier_id = $1,
        warehouse_id = $2,
        order_date = $3,
        expected_date = $4,
        subtotal = $5,
        tax_amount = $6,
        total_amount = $7,
        notes = $8,
        updated_at = NOW()
      WHERE id = $9;
      `,
      [
        data.supplier_id,
        data.warehouse_id,
        data.order_date,
        data.expected_date || null,
        data.subtotal,
        data.tax_amount,
        data.total_amount,
        data.notes || null,
        id
      ]
    );

    await client.query("DELETE FROM purchase_order_items WHERE purchase_order_id = $1;", [id]);

    for (const item of data.items) {
      await client.query(
        `
        INSERT INTO purchase_order_items (
          purchase_order_id,
          product_id,
          ordered_quantity,
          received_quantity,
          unit_cost,
          line_total
        )
        VALUES ($1,$2,$3,0,$4,$5);
        `,
        [
          id,
          item.product_id,
          item.ordered_quantity,
          item.unit_cost,
          item.line_total
        ]
      );
    }

    await client.query("COMMIT");
    return getPurchaseOrderById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePurchaseOrderById(id) {
  await ensurePurchaseOrdersSchema(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { purchaseOrder, error } = await ensurePurchaseOrderCanBeChanged(client, id);

    if (error) {
      const deleteError = new Error(error);
      deleteError.statusCode = purchaseOrder ? 400 : 404;
      throw deleteError;
    }

    await client.query("DELETE FROM purchase_order_items WHERE purchase_order_id = $1;", [id]);

    const deleteResult = await client.query(
      `
      DELETE FROM purchase_orders
      WHERE id = $1
      RETURNING *;
      `,
      [id]
    );

    await client.query("COMMIT");
    return deleteResult.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function receivePurchaseOrderItems(id, data) {
  await ensurePurchaseOrdersSchema(pool);
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    const purchaseOrderResult = await client.query(
      `
      SELECT *
      FROM purchase_orders
      WHERE id = $1
      LIMIT 1;
      `,
      [id]
    );

    const purchaseOrder = purchaseOrderResult.rows[0] || null;

    if (!purchaseOrder) {
      const notFoundError = new Error("Commande d'achat introuvable.");
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    const itemsResult = await client.query(
      `
      SELECT
        poi.*,
        p.name AS product_name,
        p.sku,
        p.barcode,
        p.product_role,
        p.unit
      FROM purchase_order_items poi
      INNER JOIN products p ON p.id = poi.product_id
      WHERE poi.purchase_order_id = $1
      ORDER BY poi.id ASC;
      `,
      [id]
    );

    const orderItems = itemsResult.rows;
    const requestedItems = data.items || [];

    if (!requestedItems.length) {
      const validationError = new Error("Aucune ligne de reception n'a ete fournie.");
      validationError.statusCode = 400;
      throw validationError;
    }

    const invoiceItems = [];

    for (const requestedItem of requestedItems) {
      const purchaseOrderItem = orderItems.find(
        (item) => Number(item.id) === Number(requestedItem.purchase_order_item_id)
      );

      if (!purchaseOrderItem) {
        const missingError = new Error("Une ligne de commande d'achat est introuvable.");
        missingError.statusCode = 404;
        throw missingError;
      }

      const remainingQuantity = roundAmount(
        Number(purchaseOrderItem.ordered_quantity || 0) -
          Number(purchaseOrderItem.received_quantity || 0)
      );
      const receivedQuantity = Number(requestedItem.received_quantity || 0);

      if (receivedQuantity <= 0) {
        continue;
      }

      if (receivedQuantity > remainingQuantity) {
        const quantityError = new Error(
          `La quantite recue pour ${purchaseOrderItem.product_name} depasse le reliquat commande.`
        );
        quantityError.statusCode = 400;
        throw quantityError;
      }

      const unitCost =
        requestedItem.unit_cost === undefined ||
        requestedItem.unit_cost === null ||
        requestedItem.unit_cost === ""
          ? Number(purchaseOrderItem.unit_cost || 0)
          : Number(requestedItem.unit_cost);

      if (Number.isNaN(unitCost) || unitCost < 0) {
        const costError = new Error("Le cout unitaire de reception est invalide.");
        costError.statusCode = 400;
        throw costError;
      }

      invoiceItems.push({
        product_id: purchaseOrderItem.product_id,
        quantity: receivedQuantity,
        unit_cost: unitCost,
        line_total: roundAmount(receivedQuantity * unitCost),
        product_name: purchaseOrderItem.product_name,
        sku: purchaseOrderItem.sku,
        barcode: purchaseOrderItem.barcode,
        product_role: purchaseOrderItem.product_role,
        unit: purchaseOrderItem.unit,
        purchase_order_item_id: purchaseOrderItem.id
      });
    }

    if (!invoiceItems.length) {
      const emptyError = new Error("Aucune quantite positive n'a ete receptionnee.");
      emptyError.statusCode = 400;
      throw emptyError;
    }

    const subtotal = roundAmount(
      invoiceItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0)
    );
    const taxAmount = Number(data.tax_amount || 0);
    const totalAmount = roundAmount(subtotal + taxAmount);
    const purchaseInvoiceNumber =
      data.purchase_invoice_number?.trim() ||
      (await getNextPurchaseInvoiceNumberForDate(data.invoice_date));

    const purchaseInvoice = await createPurchaseInvoiceWithItems({
      purchase_invoice_number: purchaseInvoiceNumber,
      purchase_order_id: id,
      supplier_id: purchaseOrder.supplier_id,
      warehouse_id: purchaseOrder.warehouse_id,
      invoice_date: data.invoice_date,
      due_date: data.due_date || null,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      notes: data.notes || `Reception de commande ${purchaseOrder.purchase_order_number}`,
      created_by: data.created_by || purchaseOrder.created_by || null,
      items: invoiceItems,
      client
    });

    for (const item of invoiceItems) {
      await client.query(
        `
        UPDATE purchase_order_items
        SET
          received_quantity = received_quantity + $1,
          updated_at = NOW()
        WHERE id = $2;
        `,
        [item.quantity, item.purchase_order_item_id]
      );
    }

    await recomputePurchaseOrderStatus(client, id);

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }

    return {
      purchase_order: await getPurchaseOrderById(id),
      purchase_invoice: shouldManageTransaction
        ? await getPurchaseInvoiceById(purchaseInvoice.id)
        : purchaseInvoice
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
