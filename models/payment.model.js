import { pool } from "../config/db.js";

export async function ensureUnallocatedPaymentsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS unallocated_payments (
      id SERIAL PRIMARY KEY,
      import_key VARCHAR(120) NOT NULL UNIQUE,
      source_file TEXT NOT NULL,
      source_sheet VARCHAR(120),
      source_row INTEGER,
      raw_customer_name TEXT NOT NULL,
      matched_customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      payment_date DATE NOT NULL,
      amount NUMERIC(14,2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL DEFAULT 'unknown',
      reference TEXT,
      notes TEXT,
      allocation_state VARCHAR(30) NOT NULL DEFAULT 'pending',
      allocated_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      allocated_payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unallocated_payments_amount_chk CHECK (amount > 0),
      CONSTRAINT unallocated_payments_allocation_state_chk CHECK (
        allocation_state IN ('pending', 'allocated', 'ignored')
      )
    );

    CREATE INDEX IF NOT EXISTS idx_unallocated_payments_state
      ON unallocated_payments (allocation_state);

    CREATE INDEX IF NOT EXISTS idx_unallocated_payments_customer
      ON unallocated_payments (matched_customer_id);

    CREATE INDEX IF NOT EXISTS idx_unallocated_payments_date
      ON unallocated_payments (payment_date DESC);
  `);
}

export async function createPayment(data) {
  const query = `
    INSERT INTO payments (
      invoice_id,
      payment_date,
      amount,
      payment_method,
      reference,
      notes,
      received_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *;
  `;

  const values = [
    data.invoice_id,
    data.payment_date,
    data.amount,
    data.payment_method || "cash",
    data.reference || null,
    data.notes || null,
    data.received_by || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getUnallocatedPayments({ state = "pending", limit = 100 } = {}) {
  await ensureUnallocatedPaymentsTable();

  const result = await pool.query(
    `
    SELECT
      up.id,
      up.raw_customer_name,
      up.matched_customer_id,
      c.business_name AS matched_customer_name,
      up.payment_date,
      up.amount,
      up.payment_method,
      up.reference,
      up.notes,
      up.allocation_state,
      up.allocated_invoice_id,
      up.allocated_payment_id,
      up.source_file,
      up.source_sheet,
      up.source_row,
      up.created_at,
      up.updated_at
    FROM unallocated_payments up
    LEFT JOIN customers c ON c.id = up.matched_customer_id
    WHERE up.allocation_state = $1
    ORDER BY up.payment_date ASC, up.id ASC
    LIMIT $2;
    `,
    [state, limit]
  );

  return result.rows;
}

export async function getUnallocatedPaymentById(id) {
  await ensureUnallocatedPaymentsTable();

  const result = await pool.query(
    `
    SELECT *
    FROM unallocated_payments
    WHERE id = $1
    LIMIT 1;
    `,
    [id]
  );

  return result.rows[0] || null;
}

export async function updateUnallocatedPayment(id, data) {
  await ensureUnallocatedPaymentsTable();

  const result = await pool.query(
    `
    UPDATE unallocated_payments
    SET
      raw_customer_name = COALESCE($2, raw_customer_name),
      payment_date = COALESCE($3, payment_date),
      amount = COALESCE($4, amount),
      payment_method = COALESCE($5, payment_method),
      reference = COALESCE($6, reference),
      notes = COALESCE($7, notes),
      updated_at = NOW()
    WHERE id = $1
      AND allocation_state = 'pending'
    RETURNING *;
    `,
    [
      id,
      data.raw_customer_name ?? null,
      data.payment_date ?? null,
      data.amount ?? null,
      data.payment_method ?? null,
      data.reference ?? null,
      data.notes ?? null
    ]
  );

  return result.rows[0] || null;
}

export async function markUnallocatedPaymentAllocated(id, data) {
  await ensureUnallocatedPaymentsTable();

  const result = await pool.query(
    `
    UPDATE unallocated_payments
    SET
      allocation_state = 'allocated',
      allocated_invoice_id = $2,
      allocated_payment_id = $3,
      updated_at = NOW()
    WHERE id = $1
      AND allocation_state = 'pending'
    RETURNING *;
    `,
    [id, data.invoice_id, data.payment_id]
  );

  return result.rows[0] || null;
}

export async function getPaymentsByInvoiceId(invoiceId) {
  const query = `
    SELECT
      p.id,
      p.invoice_id,
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
    WHERE p.invoice_id = $1
    ORDER BY p.payment_date DESC, p.created_at DESC;
  `;

  const result = await pool.query(query, [invoiceId]);
  return result.rows;
}
