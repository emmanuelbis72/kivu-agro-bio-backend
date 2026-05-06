import { pool } from "../config/db.js";
import { getInvoiceById } from "../models/invoice.model.js";
import { autoPostPaymentEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

function parseArgs(argv = []) {
  const args = {
    paymentId: null,
    limit: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--payment-id") {
      args.paymentId = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }

    if (token === "--limit") {
      args.limit = Number(argv[index + 1] || 0);
      index += 1;
    }
  }

  return args;
}

async function ensurePaymentAccountingTables() {
  const result = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'payment_method_accounts'
      ) AS payment_method_accounts_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'accounts'
      ) AS accounts_exists
  `);

  const row = result.rows[0] || {};

  if (!row.accounts_exists) {
    throw new Error(
      "La table accounts est absente. Le module comptable n'est pas initialisé."
    );
  }

  if (!row.payment_method_accounts_exists) {
    throw new Error(
      "La table payment_method_accounts est absente. Crée d'abord les mappings comptables des modes de paiement."
    );
  }
}

async function getReplayCandidates({ paymentId = null, limit = null } = {}) {
  const values = [];
  const conditions = [
    "p.accounting_entry_id IS NULL",
    "COALESCE(LOWER(TRIM(p.accounting_status)), '') <> 'posted'"
  ];

  if (paymentId && Number.isInteger(paymentId) && paymentId > 0) {
    values.push(paymentId);
    conditions.push(`p.id = $${values.length}`);
  }

  let limitClause = "";

  if (limit && Number.isInteger(limit) && limit > 0) {
    values.push(limit);
    limitClause = `LIMIT $${values.length}`;
  }

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
      p.accounting_message
    FROM payments p
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.payment_date ASC, p.id ASC
    ${limitClause};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

async function replayPaymentAccounting(payment) {
  const invoice = await getInvoiceById(payment.invoice_id);

  if (!invoice) {
    const accounting = {
      status: "error",
      reason: `Facture introuvable pour invoice_id=${payment.invoice_id}.`
    };

    await persistAccountingStatus({
      tableName: "payments",
      recordId: payment.id,
      accountingResult: accounting
    });

    return {
      paymentId: payment.id,
      status: accounting.status,
      message: accounting.reason
    };
  }

  let accounting;

  try {
    accounting = await autoPostPaymentEntry({
      payment,
      invoice,
      accounting: {},
      created_by: payment.received_by ? Number(payment.received_by) : null
    });
  } catch (error) {
    accounting = {
      status: "error",
      reason: error.message
    };
  }

  await persistAccountingStatus({
    tableName: "payments",
    recordId: payment.id,
    accountingResult: accounting
  });

  return {
    paymentId: payment.id,
    invoiceId: payment.invoice_id,
    status: accounting.status || "unknown",
    journalEntryId: accounting.journal_entry_id || null,
    message: accounting.reason || null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await ensurePaymentAccountingTables();

  const candidates = await getReplayCandidates(args);

  if (candidates.length === 0) {
    console.log("Aucun paiement à recomptabiliser.");
    return;
  }

  console.log(`Paiements à traiter : ${candidates.length}`);

  const results = [];

  for (const payment of candidates) {
    const result = await replayPaymentAccounting(payment);
    results.push(result);

    const suffix = result.journalEntryId
      ? ` -> ecriture #${result.journalEntryId}`
      : result.message
      ? ` -> ${result.message}`
      : "";

    console.log(
      `Paiement #${result.paymentId} / facture #${result.invoiceId || "?"} : ${result.status}${suffix}`
    );
  }

  const summary = results.reduce(
    (accumulator, item) => {
      accumulator.total += 1;
      accumulator[item.status] = (accumulator[item.status] || 0) + 1;
      return accumulator;
    },
    { total: 0, posted: 0, skipped: 0, error: 0, unknown: 0 }
  );

  console.log("\nRésumé");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
