import { pool } from "../config/db.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function ensureCustomersSchema(executor = pool) {
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL;
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS receivable_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS chain_name VARCHAR(150);
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS sales_channel VARCHAR(80);
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS commercial_name VARCHAR(150);
  `);
  await executor.query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS archive_reason TEXT;
  `);
}

export async function createCustomer(data) {
  await ensureCustomersSchema(pool);
  const query = `
    INSERT INTO customers (
      customer_type,
      business_name,
      contact_name,
      phone,
      email,
      city,
      chain_name,
      sales_channel,
      commercial_name,
      address,
      payment_terms_days,
      credit_limit,
      notes,
      is_active,
      receivable_account_id,
      warehouse_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *;
  `;

  const values = [
    data.customer_type || "retail",
    data.business_name,
    data.contact_name || null,
    data.phone || null,
    data.email || null,
    data.city || null,
    data.chain_name || null,
    data.sales_channel || null,
    data.commercial_name || null,
    data.address || null,
    data.payment_terms_days ?? 0,
    data.credit_limit ?? 0,
    data.notes || null,
    data.is_active ?? true,
    data.receivable_account_id || null,
    data.warehouse_id || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getAllCustomers() {
  const query = `
    SELECT
      c.*,
      a.account_number AS receivable_account_number,
      a.account_name AS receivable_account_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM customers c
    LEFT JOIN accounts a ON a.id = c.receivable_account_id
    LEFT JOIN warehouses w ON w.id = c.warehouse_id
    WHERE c.archived_at IS NULL
    ORDER BY c.created_at DESC;
  `;
  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureCustomersSchema(pool),
    query
  });
  return result.rows;
}

export async function getCustomerById(id) {
  const query = `
    SELECT
      c.*,
      a.account_number AS receivable_account_number,
      a.account_name AS receivable_account_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM customers c
    LEFT JOIN accounts a ON a.id = c.receivable_account_id
    LEFT JOIN warehouses w ON w.id = c.warehouse_id
    WHERE c.id = $1
      AND c.archived_at IS NULL
    LIMIT 1;
  `;
  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureCustomersSchema(pool),
    query,
    values: [id]
  });
  return result.rows[0] || null;
}

export async function getCustomerAccountStatement(customerId) {
  const customer = await getCustomerById(customerId);

  if (!customer) {
    return null;
  }

  const summaryQuery = `
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
        COALESCE(SUM(total_amount), 0) AS total_invoiced,
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
      FROM invoices
      WHERE customer_id = $1
        AND COALESCE(status, 'issued') <> 'cancelled'
    ),
    payment_totals AS (
      SELECT
        COUNT(p.id)::int AS total_payments,
        COALESCE(SUM(p.amount), 0) AS total_paid
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE i.customer_id = $1
        AND COALESCE(i.status, 'issued') <> 'cancelled'
    )
    SELECT
      it.total_invoices,
      it.paid_invoices,
      it.partial_invoices,
      it.issued_invoices,
      it.overdue_invoices,
      it.total_invoiced,
      it.total_paid_on_invoices,
      it.balance_due,
      it.overdue_balance,
      pt.total_payments,
      pt.total_paid
    FROM invoice_totals it
    CROSS JOIN payment_totals pt;
  `;

  const invoicesQuery = `
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      i.due_date,
      i.status,
      i.total_amount,
      i.paid_amount,
      i.balance_due,
      i.notes,
      i.accounting_status,
      i.accounting_entry_id,
      i.accounting_message,
      i.created_at,
      i.updated_at,
      w.name AS warehouse_name
    FROM invoices i
    LEFT JOIN warehouses w ON w.id = i.warehouse_id
    WHERE i.customer_id = $1
      AND COALESCE(i.status, 'issued') <> 'cancelled'
    ORDER BY i.invoice_date DESC, i.created_at DESC, i.id DESC;
  `;

  const paymentsQuery = `
    SELECT
      p.id,
      p.invoice_id,
      i.invoice_number,
      p.payment_date,
      p.amount,
      p.payment_method,
      p.reference,
      p.notes,
      p.received_by,
      p.accounting_status,
      p.accounting_entry_id,
      p.accounting_message,
      p.created_at
    FROM payments p
    INNER JOIN invoices i ON i.id = p.invoice_id
    WHERE i.customer_id = $1
      AND COALESCE(i.status, 'issued') <> 'cancelled'
    ORDER BY p.payment_date DESC, p.created_at DESC, p.id DESC;
  `;

  const [summaryResult, invoicesResult, paymentsResult] = await Promise.all([
    pool.query(summaryQuery, [customerId]),
    pool.query(invoicesQuery, [customerId]),
    pool.query(paymentsQuery, [customerId])
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
      id: `invoice-${invoice.id}`,
      movement_id: invoice.id,
      movement_type: "invoice",
      movement_label: "Facture",
      movement_date: invoice.invoice_date,
      due_date: invoice.due_date,
      reference: invoice.invoice_number,
      description: `Facture ${invoice.invoice_number}`,
      debit: roundAmount(invoice.total_amount),
      credit: 0,
      document_status: invoice.status,
      accounting_status: invoice.accounting_status || null,
      invoice_id: invoice.id,
      payment_id: null,
      payment_method: null,
      notes: invoice.notes || null,
      created_at: invoice.created_at,
      sort_rank: 1
    })),
    ...payments.map((payment) => ({
      id: `payment-${payment.id}`,
      movement_id: payment.id,
      movement_type: "payment",
      movement_label: "Paiement",
      movement_date: payment.payment_date,
      due_date: null,
      reference: payment.reference || payment.invoice_number || `PAY-${payment.id}`,
      description: `Paiement facture ${payment.invoice_number}`,
      debit: 0,
      credit: roundAmount(payment.amount),
      document_status: null,
      accounting_status: payment.accounting_status || null,
      invoice_id: payment.invoice_id,
      payment_id: payment.id,
      payment_method: payment.payment_method || null,
      notes: payment.notes || null,
      created_at: payment.created_at,
      sort_rank: 2
    }))
  ]
    .sort((left, right) => {
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
    customer,
    summary: {
      total_invoices: Number(summaryRow.total_invoices || 0),
      paid_invoices: Number(summaryRow.paid_invoices || 0),
      partial_invoices: Number(summaryRow.partial_invoices || 0),
      issued_invoices: Number(summaryRow.issued_invoices || 0),
      overdue_invoices: Number(summaryRow.overdue_invoices || 0),
      total_payments: Number(summaryRow.total_payments || 0),
      total_invoiced: roundAmount(summaryRow.total_invoiced),
      total_paid: roundAmount(summaryRow.total_paid),
      balance_due: roundAmount(summaryRow.balance_due),
      overdue_balance: roundAmount(summaryRow.overdue_balance)
    },
    invoices,
    payments,
    movements
  };
}

export async function updateCustomer(id, data) {
  await ensureCustomersSchema(pool);
  const query = `
    UPDATE customers
    SET
      customer_type = $1,
      business_name = $2,
      contact_name = $3,
      phone = $4,
      email = $5,
      city = $6,
      chain_name = $7,
      sales_channel = $8,
      commercial_name = $9,
      address = $10,
      payment_terms_days = $11,
      credit_limit = $12,
      notes = $13,
      is_active = $14,
      receivable_account_id = $15,
      warehouse_id = $16,
      updated_at = NOW()
    WHERE id = $17
      AND archived_at IS NULL
    RETURNING *;
  `;

  const values = [
    data.customer_type || "retail",
    data.business_name,
    data.contact_name || null,
    data.phone || null,
    data.email || null,
    data.city || null,
    data.chain_name || null,
    data.sales_channel || null,
    data.commercial_name || null,
    data.address || null,
    data.payment_terms_days ?? 0,
    data.credit_limit ?? 0,
    data.notes || null,
    data.is_active ?? true,
    data.receivable_account_id || null,
    data.warehouse_id || null,
    id
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

export async function bulkAssignCustomerCommercial(customerIds = [], commercialName = null) {
  await ensureCustomersSchema(pool);

  const normalizedIds = [...new Set(
    customerIds
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  )];

  if (normalizedIds.length === 0) {
    return [];
  }

  const query = `
    UPDATE customers
    SET
      commercial_name = $1,
      updated_at = NOW()
    WHERE id = ANY($2::int[])
    RETURNING *;
  `;

  const result = await pool.query(query, [
    String(commercialName || "").trim() || null,
    normalizedIds
  ]);

  return result.rows;
}

export async function deleteCustomer(id, { archived_by = null, reason = null } = {}) {
  await ensureCustomersSchema(pool);
  const query = `
    UPDATE customers
    SET
      is_active = FALSE,
      archived_at = NOW(),
      archived_by = $2,
      archive_reason = $3,
      updated_at = NOW()
    WHERE id = $1
      AND archived_at IS NULL
    RETURNING *;
  `;
  const result = await pool.query(query, [id, archived_by, reason]);
  return result.rows[0] || null;
}
