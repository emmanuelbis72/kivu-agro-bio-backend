import { pool } from "../config/db.js";
import { performStockExit } from "./stock.model.js";

export async function getInvoiceById(id) {
  const invoiceQuery = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = $1
      GROUP BY ii.invoice_id
    )
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
      c.warehouse_id AS customer_warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount,
      (
        COALESCE(i.total_amount, 0)
        - COALESCE(i.tax_amount, 0)
        - COALESCE(ic.total_cogs_amount, 0)
      ) AS gross_profit_amount
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.id = $1
    LIMIT 1;
  `;

  const itemsQuery = `
    SELECT
      ii.id,
      ii.invoice_id,
      ii.product_id,
      ii.quantity,
      ii.stock_form,
      ii.package_size,
      ii.package_unit,
      ii.unit_price,
      ii.line_total,
      p.name AS product_name,
      p.sku,
      p.product_role,
      p.unit,
      p.cost_price,
      (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
      (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS line_gross_profit_amount
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
    items: itemsResult.rows.map((item) => ({
      ...item,
      unit_cost: Number(item.cost_price ?? 0)
    }))
  };
}

export async function getAllInvoices() {
  const query = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
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
      c.warehouse_id AS customer_warehouse_id,
      w.name AS warehouse_name,
      COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount,
      (
        COALESCE(i.total_amount, 0)
        - COALESCE(i.tax_amount, 0)
        - COALESCE(ic.total_cogs_amount, 0)
      ) AS gross_profit_amount
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    ORDER BY i.created_at DESC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getNextInvoiceNumber() {
  return getNextInvoiceNumberForDate(new Date().toISOString().split("T")[0]);
}

export async function getNextInvoiceNumberForDate(invoiceDate) {
  const date = new Date(invoiceDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  const query = `
    SELECT COALESCE(
      MAX(NULLIF(SPLIT_PART(invoice_number, '/', 1), '')::int),
      0
    ) AS max_number
    FROM invoices
    WHERE EXTRACT(YEAR FROM invoice_date) = $1
      AND EXTRACT(MONTH FROM invoice_date) = $2
      AND invoice_number ~ '^[0-9]+/[0-9]{2}-[0-9]{4}$';
  `;

  const result = await pool.query(query, [year, Number(month)]);
  const nextNumber = Number(result.rows[0].max_number || 0) + 1;

  return `${String(nextNumber).padStart(3, "0")}/${month}-${year}`;
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
      const exitResult = await performStockExit({
        warehouse_id: data.warehouse_id,
        product_id: item.product_id,
        quantity: item.quantity,
        stock_form: item.stock_form || undefined,
        package_size: item.package_size ?? undefined,
        package_unit: item.package_unit ?? undefined,
        unit_cost: item.unit_cost ?? 0,
        reference_type: "invoice",
        reference_id: invoice.id,
        notes: `Sortie liee a la facture ${data.invoice_number}`,
        created_by: data.created_by || null,
        client
      });

      const itemQuery = `
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
      `;

      const itemValues = [
        invoice.id,
        item.product_id,
        item.quantity,
        exitResult.movement.stock_form || null,
        exitResult.movement.package_size ?? null,
        exitResult.movement.package_unit ?? null,
        item.unit_price,
        item.line_total
      ];

      const itemResult = await client.query(itemQuery, itemValues);

      insertedItems.push({
        ...itemResult.rows[0],
        unit_cost: Number(item.unit_cost ?? 0),
        stock_form: exitResult.movement.stock_form || null,
        package_size: exitResult.movement.package_size ?? null,
        package_unit: exitResult.movement.package_unit ?? null
      });
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

async function reverseInvoiceStock(client, invoice, reason = "Correction facture") {
  const itemsResult = await client.query(
    `
    SELECT *
    FROM invoice_items
    WHERE invoice_id = $1
    ORDER BY id ASC;
    `,
    [invoice.id]
  );

  for (const item of itemsResult.rows) {
    const stockResult = await client.query(
      `
      SELECT *
      FROM warehouse_stock
      WHERE warehouse_id = $1
        AND product_id = $2
        AND stock_form = COALESCE($3, 'bulk')
        AND COALESCE(package_size, 0) = COALESCE($4, 0)
        AND COALESCE(package_unit, '') = COALESCE($5, '')
      LIMIT 1;
      `,
      [
        invoice.warehouse_id,
        item.product_id,
        item.stock_form || "bulk",
        item.package_size,
        item.package_unit
      ]
    );

    if (stockResult.rows[0]) {
      await client.query(
        `
        UPDATE warehouse_stock
        SET
          quantity = quantity + $1,
          updated_at = NOW()
        WHERE id = $2;
        `,
        [item.quantity, stockResult.rows[0].id]
      );
    } else {
      await client.query(
        `
        INSERT INTO warehouse_stock (
          warehouse_id,
          product_id,
          quantity,
          stock_form,
          package_size,
          package_unit
        )
        VALUES ($1,$2,$3,COALESCE($4, 'bulk'),$5,$6);
        `,
        [
          invoice.warehouse_id,
          item.product_id,
          item.quantity,
          item.stock_form || "bulk",
          item.package_size,
          item.package_unit
        ]
      );
    }

    await client.query(
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
      VALUES ($1,$2,'IN',$3,COALESCE($4, 'bulk'),$5,$6,0,'invoice',$7,$8,$9);
      `,
      [
        item.product_id,
        invoice.warehouse_id,
        item.quantity,
        item.stock_form || "bulk",
        item.package_size,
        item.package_unit,
        invoice.id,
        `${reason} ${invoice.invoice_number}`,
        invoice.created_by || null
      ]
    );
  }
}

async function ensureInvoiceCanBeChanged(client, invoiceId) {
  const invoiceResult = await client.query(
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
    return { invoice: null, error: "Facture introuvable." };
  }

  const paymentResult = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM payments
    WHERE invoice_id = $1;
    `,
    [invoiceId]
  );

  if (Number(paymentResult.rows[0].count || 0) > 0) {
    return {
      invoice,
      error:
        "Impossible de modifier ou supprimer une facture qui possede deja un paiement."
    };
  }

  return { invoice, error: null };
}

export async function updateInvoiceWithItems(id, data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { invoice, error } = await ensureInvoiceCanBeChanged(client, id);

    if (error) {
      const updateError = new Error(error);
      updateError.statusCode = invoice ? 400 : 404;
      throw updateError;
    }

    await reverseInvoiceStock(client, invoice, "Annulation avant modification facture");
    await client.query("DELETE FROM invoice_items WHERE invoice_id = $1;", [id]);

    const invoiceUpdateResult = await client.query(
      `
      UPDATE invoices
      SET
        customer_id = $1,
        warehouse_id = $2,
        invoice_date = $3,
        due_date = $4,
        subtotal = $5,
        discount_amount = $6,
        tax_amount = $7,
        total_amount = $8,
        paid_amount = 0,
        balance_due = $8,
        status = 'issued',
        notes = $9,
        accounting_status = NULL,
        accounting_entry_id = NULL,
        accounting_message = NULL,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *;
      `,
      [
        data.customer_id,
        data.warehouse_id,
        data.invoice_date,
        data.due_date || null,
        data.subtotal,
        data.discount_amount,
        data.tax_amount,
        data.total_amount,
        data.notes || null,
        id
      ]
    );

    const updatedInvoice = invoiceUpdateResult.rows[0];
    const insertedItems = [];

    for (const item of data.items) {
      const exitResult = await performStockExit({
        warehouse_id: data.warehouse_id,
        product_id: item.product_id,
        quantity: item.quantity,
        stock_form: item.stock_form || undefined,
        package_size: item.package_size ?? undefined,
        package_unit: item.package_unit ?? undefined,
        unit_cost: item.unit_cost ?? 0,
        reference_type: "invoice",
        reference_id: id,
        notes: `Sortie liee a la facture modifiee ${updatedInvoice.invoice_number}`,
        created_by: data.created_by || invoice.created_by || null,
        client
      });

      const itemResult = await client.query(
        `
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
        `,
        [
          id,
          item.product_id,
          item.quantity,
          exitResult.movement.stock_form || null,
          exitResult.movement.package_size ?? null,
          exitResult.movement.package_unit ?? null,
          item.unit_price,
          item.line_total
        ]
      );

      insertedItems.push(itemResult.rows[0]);
    }

    if (invoice.accounting_entry_id) {
      await client.query(
        `
        UPDATE journal_entries
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1;
        `,
        [invoice.accounting_entry_id]
      );
    }

    await client.query("COMMIT");

    return {
      ...updatedInvoice,
      items: insertedItems
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteInvoiceById(id) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { invoice, error } = await ensureInvoiceCanBeChanged(client, id);

    if (error) {
      const deleteError = new Error(error);
      deleteError.statusCode = invoice ? 400 : 404;
      throw deleteError;
    }

    await reverseInvoiceStock(client, invoice, "Suppression facture");
    await client.query("DELETE FROM invoice_items WHERE invoice_id = $1;", [id]);

    if (invoice.accounting_entry_id) {
      await client.query(
        `
        UPDATE journal_entries
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1;
        `,
        [invoice.accounting_entry_id]
      );
    }

    const deletedResult = await client.query(
      `
      DELETE FROM invoices
      WHERE id = $1
      RETURNING *;
      `,
      [id]
    );

    await client.query("COMMIT");
    return deletedResult.rows[0] || null;
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
