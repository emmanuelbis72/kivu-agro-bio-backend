import { pool } from "../config/db.js";

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