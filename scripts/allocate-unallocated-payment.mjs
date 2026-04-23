import dotenv from "dotenv";

import { pool } from "../config/db.js";

dotenv.config();

function parseArgs(argv) {
  const args = {
    unallocatedPaymentId: null,
    invoiceId: null,
    method: "bank_transfer"
  };
  const positional = [];

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];

    if (item === "--payment-id" && argv[index + 1]) {
      args.unallocatedPaymentId = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (item === "--invoice-id" && argv[index + 1]) {
      args.invoiceId = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (item === "--method" && argv[index + 1]) {
      args.method = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    positional.push(item);
  }

  args.unallocatedPaymentId ||= Number(positional[0]);
  args.invoiceId ||= Number(positional[1]);
  args.method = positional[2] || args.method;

  return args;
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} invalide.`);
  }
}

async function getUnallocatedPayment(client, id) {
  const { rows } = await client.query(
    `
    SELECT *
    FROM unallocated_payments
    WHERE id = $1
    LIMIT 1;
    `,
    [id]
  );

  return rows[0] || null;
}

async function getInvoiceForAllocation(client, id) {
  const { rows } = await client.query(
    `
    SELECT *
    FROM invoices
    WHERE id = $1
    LIMIT 1;
    `,
    [id]
  );

  return rows[0] || null;
}

async function createAllocatedPayment(client, data) {
  const { rows } = await client.query(
    `
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
    `,
    [
      data.invoice_id,
      data.payment_date,
      data.amount,
      data.payment_method,
      data.reference,
      data.notes,
      null
    ]
  );

  return rows[0];
}

async function recomputeInvoiceBalancesWithClient(client, invoiceId) {
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
    return null;
  }

  const paymentResult = await client.query(
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

  const updateResult = await client.query(
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

  return updateResult.rows[0] || null;
}

async function allocatePayment({ unallocatedPaymentId, invoiceId, method }) {
  assertPositiveInteger(unallocatedPaymentId, "--payment-id");
  assertPositiveInteger(invoiceId, "--invoice-id");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const pendingPayment = await getUnallocatedPayment(client, unallocatedPaymentId);

    if (!pendingPayment) {
      throw new Error(`Paiement tampon ${unallocatedPaymentId} introuvable.`);
    }

    if (pendingPayment.allocation_state !== "pending") {
      throw new Error(
        `Paiement tampon ${unallocatedPaymentId} deja traite: ${pendingPayment.allocation_state}.`
      );
    }

    const invoice = await getInvoiceForAllocation(client, invoiceId);

    if (!invoice) {
      throw new Error(`Facture ${invoiceId} introuvable.`);
    }

    const amount = Number(pendingPayment.amount || 0);
    const balanceDue = Number(invoice.balance_due || 0);

    if (amount <= 0) {
      throw new Error("Le montant du paiement tampon doit etre > 0.");
    }

    if (amount > balanceDue) {
      throw new Error(
        `Le paiement (${amount}) depasse le solde de la facture ${invoice.invoice_number} (${balanceDue}).`
      );
    }

    const payment = await createAllocatedPayment(client, {
      invoice_id: invoiceId,
      payment_date: pendingPayment.payment_date,
      amount,
      payment_method: method,
      reference: pendingPayment.reference || `UNALLOCATED-${pendingPayment.id}`,
      notes:
        pendingPayment.notes ||
        `Rapprochement du paiement importe ${pendingPayment.id}`,
      received_by: null
    });

    const updatedInvoice = await recomputeInvoiceBalancesWithClient(
      client,
      invoiceId
    );

    await client.query(
      `
      UPDATE unallocated_payments
      SET
        allocation_state = 'allocated',
        allocated_invoice_id = $2,
        allocated_payment_id = $3,
        updated_at = NOW()
      WHERE id = $1;
      `,
      [unallocatedPaymentId, invoiceId, payment.id]
    );

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          success: true,
          unallocated_payment_id: unallocatedPaymentId,
          payment_id: payment.id,
          invoice_id: invoiceId,
          invoice_number: invoice.invoice_number,
          amount,
          invoice_status: updatedInvoice?.status,
          invoice_balance_due: Number(updatedInvoice?.balance_due || 0)
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const args = parseArgs(process.argv);

allocatePayment(args).catch((error) => {
  console.error("Allocation paiement impossible:", error);
  process.exit(1);
});
