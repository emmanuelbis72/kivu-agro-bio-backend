import { pool } from "../config/db.js";
import {
  ensureStockSchema,
  performStockEntry,
  performStockExit
} from "./stock.model.js";
import { ensureSuppliersSchema } from "./supplier.model.js";
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

export async function ensurePurchaseInvoicesSchema(executor = pool) {
  await ensureSuppliersSchema(executor);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id SERIAL PRIMARY KEY,
      purchase_invoice_number VARCHAR(50) NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      purchase_order_id INTEGER,
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
      invoice_date DATE NOT NULL,
      due_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'issued',
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      balance_due NUMERIC(14,2) NOT NULL DEFAULT 0,
      notes TEXT,
      accounting_status VARCHAR(20),
      accounting_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
      accounting_message TEXT,
      created_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT purchase_invoices_status_chk CHECK (
        status IN ('draft', 'issued', 'partial', 'paid', 'cancelled')
      )
    );
  `);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS purchase_invoice_items (
      id SERIAL PRIMARY KEY,
      purchase_invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity NUMERIC(18,6) NOT NULL,
      quantity_unit VARCHAR(20),
      stock_form VARCHAR(20),
      package_size NUMERIC(14,2),
      package_unit VARCHAR(20),
      unit_cost NUMERIC(14,2) NOT NULL,
      line_total NUMERIC(14,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT purchase_invoice_items_quantity_chk CHECK (quantity > 0),
      CONSTRAINT purchase_invoice_items_unit_cost_chk CHECK (unit_cost >= 0),
      CONSTRAINT purchase_invoice_items_line_total_chk CHECK (line_total >= 0)
    );
  `);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS supplier_payments (
      id SERIAL PRIMARY KEY,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      purchase_invoice_id INTEGER REFERENCES purchase_invoices(id) ON DELETE SET NULL,
      payment_date DATE NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
      reference VARCHAR(120),
      notes TEXT,
      accounting_status VARCHAR(20),
      accounting_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
      accounting_message TEXT,
      created_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT supplier_payments_amount_chk CHECK (amount > 0),
      CONSTRAINT supplier_payments_method_chk CHECK (
        payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'card')
      )
    );
  `);

  await executor.query(`
    ALTER TABLE purchase_invoices
    ADD COLUMN IF NOT EXISTS purchase_order_id INTEGER;
  `);
  await executor.query(`
    ALTER TABLE purchase_invoice_items
    ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20);
  `);
  await executor.query(`
    ALTER TABLE purchase_invoice_items
    ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_id
    ON purchase_invoices(supplier_id);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_invoices_purchase_order_id
    ON purchase_invoices(purchase_order_id);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_invoices_warehouse_id
    ON purchase_invoices(warehouse_id);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_purchase_invoice_id
    ON purchase_invoice_items(purchase_invoice_id);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id
    ON supplier_payments(supplier_id);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase_invoice_id
    ON supplier_payments(purchase_invoice_id);
  `);
}

export async function getNextPurchaseInvoiceNumberForDate(invoiceDate) {
  await ensurePurchaseInvoicesSchema(pool);

  const date = new Date(invoiceDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  const result = await pool.query(
    `
    SELECT COALESCE(
      MAX(NULLIF(REGEXP_REPLACE(SPLIT_PART(purchase_invoice_number, '/', 1), '[^0-9]', '', 'g'), '')::int),
      0
    ) AS max_number
    FROM purchase_invoices
    WHERE EXTRACT(YEAR FROM invoice_date) = $1
      AND EXTRACT(MONTH FROM invoice_date) = $2
      AND purchase_invoice_number ~ '^ACH-[0-9]+/[0-9]{2}-[0-9]{4}$';
    `,
    [year, Number(month)]
  );

  const nextNumber = Number(result.rows[0]?.max_number || 0) + 1;
  return `ACH-${String(nextNumber).padStart(3, "0")}/${month}-${year}`;
}

export async function getPurchaseInvoiceById(id) {
  await ensurePurchaseInvoicesSchema(pool);
  const invoiceQuery = `
    SELECT
      pi.*,
      s.business_name AS supplier_name,
      s.phone AS supplier_phone,
      s.email AS supplier_email,
      s.city AS supplier_city,
      s.address AS supplier_address,
      s.payable_account_id AS supplier_payable_account_id,
      a.account_number AS payable_account_number,
      a.account_name AS payable_account_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM purchase_invoices pi
    INNER JOIN suppliers s ON s.id = pi.supplier_id
    LEFT JOIN accounts a ON a.id = s.payable_account_id
    INNER JOIN warehouses w ON w.id = pi.warehouse_id
    WHERE pi.id = $1
    LIMIT 1;
  `;

  const itemsQuery = `
    SELECT
      pii.id,
      pii.purchase_invoice_id,
      pii.product_id,
      pii.quantity,
      pii.quantity_unit,
      pii.stock_form,
      pii.package_size,
      pii.package_unit,
      pii.unit_cost,
      pii.line_total,
      p.name AS product_name,
      p.sku,
      p.barcode,
      p.product_role,
      p.unit
    FROM purchase_invoice_items pii
    INNER JOIN products p ON p.id = pii.product_id
    WHERE pii.purchase_invoice_id = $1
    ORDER BY pii.id ASC;
  `;

  const paymentsQuery = `
    SELECT
      sp.id,
      sp.supplier_id,
      sp.purchase_invoice_id,
      sp.payment_date,
      sp.amount,
      sp.payment_method,
      sp.reference,
      sp.notes,
      sp.accounting_status,
      sp.accounting_entry_id,
      sp.accounting_message,
      sp.created_at
    FROM supplier_payments sp
    WHERE sp.purchase_invoice_id = $1
    ORDER BY sp.payment_date DESC, sp.created_at DESC, sp.id DESC;
  `;

  const [invoiceResult, itemsResult, paymentsResult] = await Promise.all([
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensurePurchaseInvoicesSchema(pool),
      query: invoiceQuery,
      values: [id]
    }),
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensurePurchaseInvoicesSchema(pool),
      query: itemsQuery,
      values: [id]
    }),
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensurePurchaseInvoicesSchema(pool),
      query: paymentsQuery,
      values: [id]
    })
  ]);

  const invoice = invoiceResult.rows[0] || null;

  if (!invoice) {
    return null;
  }

  return {
    ...invoice,
    items: itemsResult.rows,
    payments: paymentsResult.rows
  };
}

export async function getAllPurchaseInvoices() {
  await ensurePurchaseInvoicesSchema(pool);
  const query = `
    SELECT
      pi.id,
      pi.purchase_invoice_number,
      pi.supplier_id,
      pi.purchase_order_id,
      pi.warehouse_id,
      pi.invoice_date,
      pi.due_date,
      pi.status,
      pi.subtotal,
      pi.tax_amount,
      pi.total_amount,
      pi.paid_amount,
      pi.balance_due,
      pi.notes,
      pi.accounting_status,
      pi.accounting_entry_id,
      pi.accounting_message,
      pi.created_by,
      pi.created_at,
      pi.updated_at,
      s.business_name AS supplier_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      COALESCE(item_stats.items_count, 0)::int AS items_count,
      COALESCE(item_stats.total_quantity, 0) AS total_quantity
    FROM purchase_invoices pi
    INNER JOIN suppliers s ON s.id = pi.supplier_id
    INNER JOIN warehouses w ON w.id = pi.warehouse_id
    LEFT JOIN (
      SELECT
        purchase_invoice_id,
        COUNT(*)::int AS items_count,
        COALESCE(SUM(quantity), 0) AS total_quantity
      FROM purchase_invoice_items
      GROUP BY purchase_invoice_id
    ) AS item_stats ON item_stats.purchase_invoice_id = pi.id
    ORDER BY pi.created_at DESC, pi.id DESC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePurchaseInvoicesSchema(pool),
    query
  });

  return result.rows;
}

export async function getSupplierPaymentsBySupplierId(supplierId) {
  await ensurePurchaseInvoicesSchema(pool);
  const query = `
    SELECT
      sp.id,
      sp.supplier_id,
      sp.purchase_invoice_id,
      sp.payment_date,
      sp.amount,
      sp.payment_method,
      sp.reference,
      sp.notes,
      sp.accounting_status,
      sp.accounting_entry_id,
      sp.accounting_message,
      sp.created_at,
      pi.purchase_invoice_number
    FROM supplier_payments sp
    LEFT JOIN purchase_invoices pi ON pi.id = sp.purchase_invoice_id
    WHERE sp.supplier_id = $1
    ORDER BY sp.payment_date DESC, sp.created_at DESC, sp.id DESC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePurchaseInvoicesSchema(pool),
    query,
    values: [supplierId]
  });

  return result.rows;
}

async function reversePurchaseInvoiceStock(client, purchaseInvoice, reason) {
  const itemsResult = await client.query(
    `
    SELECT *
    FROM purchase_invoice_items
    WHERE purchase_invoice_id = $1
    ORDER BY id ASC;
    `,
    [purchaseInvoice.id]
  );

  for (const item of itemsResult.rows) {
    await performStockExit({
      warehouse_id: purchaseInvoice.warehouse_id,
      product_id: item.product_id,
      quantity: item.quantity,
      quantity_unit: item.quantity_unit || undefined,
      stock_form: item.stock_form || undefined,
      package_size: item.package_size ?? undefined,
      package_unit: item.package_unit ?? undefined,
      unit_cost: item.unit_cost ?? 0,
      reference_type: "purchase_invoice",
      reference_id: purchaseInvoice.id,
      notes: `${reason} ${purchaseInvoice.purchase_invoice_number}`,
      created_by: purchaseInvoice.created_by || null,
      client
    });
  }
}

async function ensurePurchaseInvoiceCanBeChanged(client, purchaseInvoiceId) {
  const purchaseInvoiceResult = await client.query(
    `
    SELECT *
    FROM purchase_invoices
    WHERE id = $1
    LIMIT 1;
    `,
    [purchaseInvoiceId]
  );

  const purchaseInvoice = purchaseInvoiceResult.rows[0] || null;

  if (!purchaseInvoice) {
    return { purchaseInvoice: null, error: "Facture fournisseur introuvable." };
  }

  const paymentsResult = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM supplier_payments
    WHERE purchase_invoice_id = $1;
    `,
    [purchaseInvoiceId]
  );

  if (Number(paymentsResult.rows[0]?.count || 0) > 0) {
    return {
      purchaseInvoice,
      error:
        "Impossible de modifier ou supprimer une facture fournisseur qui possede deja un paiement."
    };
  }

  return { purchaseInvoice, error: null };
}

export async function createPurchaseInvoiceWithItems(data) {
  await ensurePurchaseInvoicesSchema(pool);
  await ensureStockSchema(pool);
  const { client, shouldManageTransaction } = await getClient(data.client);

  try {
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    const insertResult = await client.query(
      `
      INSERT INTO purchase_invoices (
        purchase_invoice_number,
        supplier_id,
        purchase_order_id,
        warehouse_id,
        invoice_date,
        due_date,
        status,
        subtotal,
        tax_amount,
        total_amount,
        paid_amount,
        balance_due,
        notes,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,$8,$9,0,$9,$10,$11)
      RETURNING *;
      `,
      [
        data.purchase_invoice_number,
        data.supplier_id,
        data.purchase_order_id || null,
        data.warehouse_id,
        data.invoice_date,
        data.due_date || null,
        data.subtotal,
        data.tax_amount,
        data.total_amount,
        data.notes || null,
        data.created_by || null
      ]
    );

    const purchaseInvoice = insertResult.rows[0];
    const insertedItems = [];

    for (const item of data.items) {
      const entryResult = await performStockEntry({
        warehouse_id: data.warehouse_id,
        product_id: item.product_id,
        quantity: item.quantity,
        quantity_unit: item.quantity_unit || undefined,
        stock_form: item.stock_form || undefined,
        package_size: item.package_size ?? undefined,
        package_unit: item.package_unit ?? undefined,
        unit_cost: item.unit_cost ?? 0,
        reference_type: "purchase_invoice",
        reference_id: purchaseInvoice.id,
        notes: `Entree liee a la facture fournisseur ${data.purchase_invoice_number}`,
        created_by: data.created_by || null,
        client
      });

      const itemResult = await client.query(
        `
        INSERT INTO purchase_invoice_items (
          purchase_invoice_id,
          product_id,
          quantity,
          quantity_unit,
          stock_form,
          package_size,
          package_unit,
          unit_cost,
          line_total
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *;
        `,
        [
          purchaseInvoice.id,
          item.product_id,
          item.quantity,
          item.quantity_unit || null,
          entryResult.movement.stock_form || null,
          entryResult.movement.package_size ?? null,
          entryResult.movement.package_unit ?? null,
          item.unit_cost,
          item.line_total
        ]
      );

      insertedItems.push({
        ...(itemResult.rows[0] || {}),
        product_name: item.product_name || null,
        sku: item.sku || null,
        barcode: item.barcode || null,
        product_role: item.product_role || null,
        unit: item.unit || null
      });
    }

    if (shouldManageTransaction) {
      await client.query("COMMIT");
      return getPurchaseInvoiceById(purchaseInvoice.id);
    }

    return {
      ...purchaseInvoice,
      items: insertedItems
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

export async function updatePurchaseInvoiceWithItems(id, data) {
  await ensurePurchaseInvoicesSchema(pool);
  await ensureStockSchema(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { purchaseInvoice, error } = await ensurePurchaseInvoiceCanBeChanged(
      client,
      id
    );

    if (error) {
      const updateError = new Error(error);
      updateError.statusCode = purchaseInvoice ? 400 : 404;
      throw updateError;
    }

    await reversePurchaseInvoiceStock(
      client,
      purchaseInvoice,
      "Annulation avant modification facture fournisseur"
    );

    await client.query("DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = $1;", [id]);

    const updateResult = await client.query(
      `
      UPDATE purchase_invoices
      SET
        supplier_id = $1,
        warehouse_id = $2,
        invoice_date = $3,
        due_date = $4,
        subtotal = $5,
        tax_amount = $6,
        total_amount = $7,
        paid_amount = 0,
        balance_due = $7,
        status = 'issued',
        notes = $8,
        accounting_status = NULL,
        accounting_entry_id = NULL,
        accounting_message = NULL,
        updated_at = NOW()
      WHERE id = $9
      RETURNING *;
      `,
      [
        data.supplier_id,
        data.warehouse_id,
        data.invoice_date,
        data.due_date || null,
        data.subtotal,
        data.tax_amount,
        data.total_amount,
        data.notes || null,
        id
      ]
    );

    const updatedInvoice = updateResult.rows[0];

    for (const item of data.items) {
      const entryResult = await performStockEntry({
        warehouse_id: data.warehouse_id,
        product_id: item.product_id,
        quantity: item.quantity,
        quantity_unit: item.quantity_unit || undefined,
        stock_form: item.stock_form || undefined,
        package_size: item.package_size ?? undefined,
        package_unit: item.package_unit ?? undefined,
        unit_cost: item.unit_cost ?? 0,
        reference_type: "purchase_invoice",
        reference_id: id,
        notes: `Entree liee a la facture fournisseur modifiee ${updatedInvoice.purchase_invoice_number}`,
        created_by: data.created_by || purchaseInvoice.created_by || null,
        client
      });

      await client.query(
        `
        INSERT INTO purchase_invoice_items (
          purchase_invoice_id,
          product_id,
          quantity,
          quantity_unit,
          stock_form,
          package_size,
          package_unit,
          unit_cost,
          line_total
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);
        `,
        [
          id,
          item.product_id,
          item.quantity,
          item.quantity_unit || null,
          entryResult.movement.stock_form || null,
          entryResult.movement.package_size ?? null,
          entryResult.movement.package_unit ?? null,
          item.unit_cost,
          item.line_total
        ]
      );
    }

    if (purchaseInvoice.accounting_entry_id) {
      await client.query(
        `
        UPDATE journal_entries
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1;
        `,
        [purchaseInvoice.accounting_entry_id]
      );
    }

    await client.query("COMMIT");
    return getPurchaseInvoiceById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePurchaseInvoiceById(id) {
  await ensurePurchaseInvoicesSchema(pool);
  await ensureStockSchema(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { purchaseInvoice, error } = await ensurePurchaseInvoiceCanBeChanged(
      client,
      id
    );

    if (error) {
      const deleteError = new Error(error);
      deleteError.statusCode = purchaseInvoice ? 400 : 404;
      throw deleteError;
    }

    await reversePurchaseInvoiceStock(client, purchaseInvoice, "Suppression facture fournisseur");
    await client.query("DELETE FROM purchase_invoice_items WHERE purchase_invoice_id = $1;", [id]);

    if (purchaseInvoice.accounting_entry_id) {
      await client.query(
        `
        UPDATE journal_entries
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1;
        `,
        [purchaseInvoice.accounting_entry_id]
      );
    }

    const deleteResult = await client.query(
      `
      DELETE FROM purchase_invoices
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

export async function recomputePurchaseInvoiceBalances(purchaseInvoiceId, executor = pool) {
  await ensurePurchaseInvoicesSchema(executor);

  const invoiceResult = await executor.query(
    `
    SELECT *
    FROM purchase_invoices
    WHERE id = $1
    LIMIT 1;
    `,
    [purchaseInvoiceId]
  );

  const purchaseInvoice = invoiceResult.rows[0] || null;

  if (!purchaseInvoice) {
    return null;
  }

  const paymentResult = await executor.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS total_paid
    FROM supplier_payments
    WHERE purchase_invoice_id = $1;
    `,
    [purchaseInvoiceId]
  );

  const totalPaid = roundAmount(paymentResult.rows[0]?.total_paid || 0);
  const totalAmount = roundAmount(purchaseInvoice.total_amount || 0);
  const balanceDue = roundAmount(totalAmount - totalPaid);

  let status = "issued";

  if (totalPaid <= 0) {
    status = "issued";
  } else if (balanceDue > 0) {
    status = "partial";
  } else {
    status = "paid";
  }

  const updateResult = await executor.query(
    `
    UPDATE purchase_invoices
    SET
      paid_amount = $1,
      balance_due = $2,
      status = $3,
      updated_at = NOW()
    WHERE id = $4
    RETURNING *;
    `,
    [totalPaid, balanceDue, status, purchaseInvoiceId]
  );

  return updateResult.rows[0] || null;
}

export async function createSupplierPayment(data) {
  await ensurePurchaseInvoicesSchema(pool);
  const result = await pool.query(
    `
    INSERT INTO supplier_payments (
      supplier_id,
      purchase_invoice_id,
      payment_date,
      amount,
      payment_method,
      reference,
      notes,
      created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *;
    `,
    [
      data.supplier_id,
      data.purchase_invoice_id || null,
      data.payment_date,
      data.amount,
      data.payment_method || "cash",
      data.reference || null,
      data.notes || null,
      data.created_by || null
    ]
  );

  if (data.purchase_invoice_id) {
    await recomputePurchaseInvoiceBalances(data.purchase_invoice_id);
  }

  return result.rows[0];
}

export async function getSupplierPaymentById(id) {
  await ensurePurchaseInvoicesSchema(pool);
  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePurchaseInvoicesSchema(pool),
    query: `
      SELECT
        sp.*,
        pi.purchase_invoice_number
      FROM supplier_payments sp
      LEFT JOIN purchase_invoices pi ON pi.id = sp.purchase_invoice_id
      WHERE sp.id = $1
      LIMIT 1;
    `,
    values: [id]
  });

  return result.rows[0] || null;
}

export async function getSupplierAccountStatement(supplierId) {
  await ensurePurchaseInvoicesSchema(pool);
  const supplierResult = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensurePurchaseInvoicesSchema(pool),
    query: `
      SELECT
        s.*,
        a.account_number AS payable_account_number,
        a.account_name AS payable_account_name
      FROM suppliers s
      LEFT JOIN accounts a ON a.id = s.payable_account_id
      WHERE s.id = $1
      LIMIT 1;
    `,
    values: [supplierId]
  });

  const supplier = supplierResult.rows[0] || null;

  if (!supplier) {
    return null;
  }

  const [summaryResult, invoicesResult, paymentsResult] = await Promise.all([
    pool.query(
      `
      WITH invoice_totals AS (
        SELECT
          COUNT(*)::int AS total_invoices,
          COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_invoices,
          COUNT(*) FILTER (WHERE status = 'partial')::int AS partial_invoices,
          COUNT(*) FILTER (WHERE status = 'issued')::int AS issued_invoices,
          COUNT(*) FILTER (
            WHERE due_date IS NOT NULL
              AND due_date < CURRENT_DATE
              AND COALESCE(balance_due, 0) > 0
          )::int AS overdue_invoices,
          COALESCE(SUM(total_amount), 0) AS total_purchased,
          COALESCE(SUM(paid_amount), 0) AS total_paid_on_invoices,
          COALESCE(SUM(balance_due), 0) AS balance_due,
          COALESCE(
            SUM(
              CASE
                WHEN due_date IS NOT NULL
                  AND due_date < CURRENT_DATE
                  AND COALESCE(balance_due, 0) > 0
                THEN balance_due
                ELSE 0
              END
            ),
            0
          ) AS overdue_balance
        FROM purchase_invoices
        WHERE supplier_id = $1
          AND COALESCE(status, 'issued') <> 'cancelled'
      ),
      payment_totals AS (
        SELECT
          COUNT(*)::int AS total_payments,
          COALESCE(SUM(amount), 0) AS total_paid
        FROM supplier_payments
        WHERE supplier_id = $1
      )
      SELECT
        it.total_invoices,
        it.paid_invoices,
        it.partial_invoices,
        it.issued_invoices,
        it.overdue_invoices,
        it.total_purchased,
        it.total_paid_on_invoices,
        it.balance_due,
        it.overdue_balance,
        pt.total_payments,
        pt.total_paid
      FROM invoice_totals it
      CROSS JOIN payment_totals pt;
      `,
      [supplierId]
    ),
    pool.query(
      `
      SELECT
        pi.id,
        pi.purchase_invoice_number,
        pi.invoice_date,
        pi.due_date,
        pi.status,
        pi.total_amount,
        pi.paid_amount,
        pi.balance_due,
        pi.notes,
        pi.accounting_status,
        pi.accounting_entry_id,
        pi.accounting_message,
        pi.created_at,
        pi.updated_at,
        w.name AS warehouse_name
      FROM purchase_invoices pi
      LEFT JOIN warehouses w ON w.id = pi.warehouse_id
      WHERE pi.supplier_id = $1
        AND COALESCE(pi.status, 'issued') <> 'cancelled'
      ORDER BY pi.invoice_date DESC, pi.created_at DESC, pi.id DESC;
      `,
      [supplierId]
    ),
    pool.query(
      `
      SELECT
        sp.id,
        sp.purchase_invoice_id,
        pi.purchase_invoice_number,
        sp.payment_date,
        sp.amount,
        sp.payment_method,
        sp.reference,
        sp.notes,
        sp.accounting_status,
        sp.accounting_entry_id,
        sp.accounting_message,
        sp.created_at
      FROM supplier_payments sp
      LEFT JOIN purchase_invoices pi ON pi.id = sp.purchase_invoice_id
      WHERE sp.supplier_id = $1
      ORDER BY sp.payment_date DESC, sp.created_at DESC, sp.id DESC;
      `,
      [supplierId]
    )
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const invoices = invoicesResult.rows.map((row) => ({
    ...row,
    total_amount: roundAmount(row.total_amount),
    paid_amount: roundAmount(row.paid_amount),
    balance_due: roundAmount(row.balance_due)
  }));
  const payments = paymentsResult.rows.map((row) => ({
    ...row,
    amount: roundAmount(row.amount)
  }));

  const orderedMovements = [
    ...invoices.map((invoice) => ({
      id: `purchase-invoice-${invoice.id}`,
      movement_id: invoice.id,
      movement_type: "purchase_invoice",
      movement_label: "Facture fournisseur",
      movement_date: invoice.invoice_date,
      due_date: invoice.due_date,
      reference: invoice.purchase_invoice_number,
      description: `Facture fournisseur ${invoice.purchase_invoice_number}`,
      debit: roundAmount(invoice.total_amount),
      credit: 0,
      document_status: invoice.status,
      accounting_status: invoice.accounting_status || null,
      purchase_invoice_id: invoice.id,
      supplier_payment_id: null,
      payment_method: null,
      notes: invoice.notes || null,
      created_at: invoice.created_at,
      sort_rank: 1
    })),
    ...payments.map((payment) => ({
      id: `supplier-payment-${payment.id}`,
      movement_id: payment.id,
      movement_type: "supplier_payment",
      movement_label: "Paiement fournisseur",
      movement_date: payment.payment_date,
      due_date: null,
      reference:
        payment.reference ||
        payment.purchase_invoice_number ||
        `SUP-PAY-${payment.id}`,
      description: payment.purchase_invoice_number
        ? `Reglement facture ${payment.purchase_invoice_number}`
        : `Paiement fournisseur ${payment.id}`,
      debit: 0,
      credit: roundAmount(payment.amount),
      document_status: null,
      accounting_status: payment.accounting_status || null,
      purchase_invoice_id: payment.purchase_invoice_id,
      supplier_payment_id: payment.id,
      payment_method: payment.payment_method || null,
      notes: payment.notes || null,
      created_at: payment.created_at,
      sort_rank: 2
    }))
  ].sort((left, right) => {
    const leftDate = new Date(left.movement_date || left.created_at || 0).getTime();
    const rightDate = new Date(right.movement_date || right.created_at || 0).getTime();

    if (leftDate !== rightDate) {
      return leftDate - rightDate;
    }

    if (left.sort_rank !== right.sort_rank) {
      return left.sort_rank - right.sort_rank;
    }

    const leftCreatedAt = new Date(left.created_at || 0).getTime();
    const rightCreatedAt = new Date(right.created_at || 0).getTime();

    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return left.movement_id - right.movement_id;
  });

  let runningBalance = 0;

  const movements = orderedMovements.map(({ sort_rank, ...movement }) => {
    runningBalance = roundAmount(
      runningBalance + Number(movement.debit || 0) - Number(movement.credit || 0)
    );

    return {
      ...movement,
      running_balance: runningBalance
    };
  });

  return {
    supplier: {
      ...supplier,
      total_expenses: roundAmount(supplier.total_expenses)
    },
    summary: {
      total_invoices: Number(summaryRow.total_invoices || 0),
      paid_invoices: Number(summaryRow.paid_invoices || 0),
      partial_invoices: Number(summaryRow.partial_invoices || 0),
      issued_invoices: Number(summaryRow.issued_invoices || 0),
      overdue_invoices: Number(summaryRow.overdue_invoices || 0),
      total_payments: Number(summaryRow.total_payments || 0),
      total_purchased: roundAmount(summaryRow.total_purchased),
      total_paid: roundAmount(summaryRow.total_paid),
      balance_due: roundAmount(summaryRow.balance_due),
      overdue_balance: roundAmount(summaryRow.overdue_balance)
    },
    invoices,
    payments,
    movements
  };
}
