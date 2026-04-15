import { pool } from "../config/db.js";

export async function getInvoiceById(id) {
  const invoiceQuery = `
    SELECT
      i.id,
      i.invoice_number,
      i.customer_id,
      i.warehouse_id,
      i.invoice_date,
      i.due_date,
      i.status,
      i.subtotal,
      i.discount_amount,
      i.tax_amount,
      i.total_amount,
      i.paid_amount,
      i.balance_due,
      i.notes,
      i.accounting_status,
      i.accounting_entry_id,
      i.accounting_message,
      i.created_by,
      i.created_at,
      i.updated_at,
      c.business_name AS customer_name,
      c.phone AS customer_phone,
      c.email AS customer_email,
      c.city AS customer_city,
      c.address AS customer_address,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    WHERE i.id = $1
    LIMIT 1;
  `;

  const itemsQuery = `
    SELECT
      ii.id,
      ii.invoice_id,
      ii.product_id,
      ii.quantity,
      ii.unit_price,
      ii.line_total,
      p.name AS product_name,
      p.sku,
      p.unit
    FROM invoice_items ii
    INNER JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = $1
    ORDER BY ii.id ASC;
  `;

  const [invoiceResult, itemsResult] = await Promise.all([
    pool.query(invoiceQuery, [id]),
    pool.query(itemsQuery, [id])
  ]);

  const invoice = invoiceResult.rows[0] || null;

  if (!invoice) {
    return null;
  }

  return {
    ...invoice,
    items: itemsResult.rows
  };
}

export async function getAllInvoices() {
  const query = `
    SELECT
      i.id,
      i.invoice_number,
      i.customer_id,
      i.warehouse_id,
      i.invoice_date,
      i.due_date,
      i.status,
      i.subtotal,
      i.discount_amount,
      i.tax_amount,
      i.total_amount,
      i.paid_amount,
      i.balance_due,
      i.notes,
      i.accounting_status,
      i.accounting_entry_id,
      i.accounting_message,
      i.created_by,
      i.created_at,
      i.updated_at,
      c.business_name AS customer_name,
      w.name AS warehouse_name
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    ORDER BY i.created_at DESC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getNextInvoiceNumber() {
  const year = new Date().getFullYear();

  const query = `
    SELECT COUNT(*)::int AS count
    FROM invoices
    WHERE EXTRACT(YEAR FROM created_at) = $1;
  `;

  const result = await pool.query(query, [year]);
  const nextNumber = result.rows[0].count + 1;

  return `KAB-${year}-${String(nextNumber).padStart(5, "0")}`;
}

export async function createInvoiceWithItems(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const invoiceInsertQuery = `
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
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *;
    `;

    const invoiceValues = [
      data.invoice_number,
      data.customer_id,
      data.warehouse_id,
      data.invoice_date,
      data.due_date || null,
      data.status,
      data.subtotal,
      data.discount_amount,
      data.tax_amount,
      data.total_amount,
      data.paid_amount,
      data.balance_due,
      data.notes || null,
      data.created_by || null
    ];

    const invoiceResult = await client.query(invoiceInsertQuery, invoiceValues);
    const invoice = invoiceResult.rows[0];

    const insertedItems = [];

    for (const item of data.items) {
      const itemQuery = `
        INSERT INTO invoice_items (
          invoice_id,
          product_id,
          quantity,
          unit_price,
          line_total
        )
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *;
      `;

      const itemValues = [
        invoice.id,
        item.product_id,
        item.quantity,
        item.unit_price,
        item.line_total
      ];

      const itemResult = await client.query(itemQuery, itemValues);
      insertedItems.push(itemResult.rows[0]);

      const stockResult = await client.query(
        `
        SELECT *
        FROM warehouse_stock
        WHERE warehouse_id = $1 AND product_id = $2
        LIMIT 1;
        `,
        [data.warehouse_id, item.product_id]
      );

      const currentStock = stockResult.rows[0] || null;

      if (!currentStock) {
        const error = new Error(
          `Aucun stock trouvé pour le produit ID ${item.product_id} dans ce dépôt.`
        );
        error.statusCode = 400;
        throw error;
      }

      if (Number(currentStock.quantity) < Number(item.quantity)) {
        const error = new Error(
          `Stock insuffisant pour le produit ID ${item.product_id}.`
        );
        error.statusCode = 400;
        throw error;
      }

      const newQuantity = Number(currentStock.quantity) - Number(item.quantity);

      await client.query(
        `
        UPDATE warehouse_stock
        SET quantity = $1, updated_at = NOW()
        WHERE warehouse_id = $2 AND product_id = $3;
        `,
        [newQuantity, data.warehouse_id, item.product_id]
      );

      await client.query(
        `
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
        VALUES ($1,$2,'OUT',$3,$4,'invoice',$5,$6,$7);
        `,
        [
          item.product_id,
          data.warehouse_id,
          item.quantity,
          item.unit_cost ?? 0,
          invoice.id,
          `Sortie liée à la facture ${data.invoice_number}`,
          data.created_by || null
        ]
      );
    }

    await client.query("COMMIT");

    return {
      ...invoice,
      items: insertedItems
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateInvoiceStatus(id, status) {
  const query = `
    UPDATE invoices
    SET
      status = $1,
      updated_at = NOW()
    WHERE id = $2
    RETURNING *;
  `;

  const result = await pool.query(query, [status, id]);
  return result.rows[0] || null;
}

export async function recomputeInvoiceBalances(invoiceId) {
  const invoiceResult = await pool.query(
    `
    SELECT *
    FROM invoices
    WHERE id = $1
    LIMIT 1;
    `,
    [invoiceId]
  );

  const invoice = invoiceResult.rows[0] || null;

  if (!invoice) {
    return null;
  }

  const paymentResult = await pool.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS total_paid
    FROM payments
    WHERE invoice_id = $1;
    `,
    [invoiceId]
  );

  const totalPaid = Number(paymentResult.rows[0].total_paid || 0);
  const totalAmount = Number(invoice.total_amount || 0);
  const balanceDue = totalAmount - totalPaid;

  let status = "issued";

  if (totalPaid <= 0) {
    status = "issued";
  } else if (balanceDue > 0) {
    status = "partial";
  } else {
    status = "paid";
  }

  const updateResult = await pool.query(
    `
    UPDATE invoices
    SET
      paid_amount = $1,
      balance_due = $2,
      status = $3,
      updated_at = NOW()
    WHERE id = $4
    RETURNING *;
    `,
    [totalPaid, balanceDue, status, invoiceId]
  );

  return updateResult.rows[0];
}