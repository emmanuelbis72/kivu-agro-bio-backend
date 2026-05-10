import { pool } from "../config/db.js";
import { getInvoiceById } from "../models/invoice.model.js";
import { autoPostInvoiceEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

function parseArgs(argv = []) {
  const args = {
    invoiceId: null,
    limit: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--invoice-id") {
      args.invoiceId = Number(argv[index + 1] || 0);
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

async function getReplayCandidates({ invoiceId = null, limit = null } = {}) {
  const values = [];
  const conditions = [
    `NOT EXISTS (
      SELECT 1
      FROM journal_entries je
      WHERE je.reference_type = 'invoice'
        AND je.reference_id = i.id
        AND je.status = 'posted'
    )`
  ];

  if (invoiceId && Number.isInteger(invoiceId) && invoiceId > 0) {
    values.push(invoiceId);
    conditions.push(`i.id = $${values.length}`);
  }

  let limitClause = "";

  if (limit && Number.isInteger(limit) && limit > 0) {
    values.push(limit);
    limitClause = `LIMIT $${values.length}`;
  }

  const query = `
    SELECT
      i.id,
      i.invoice_number,
      i.customer_id,
      i.invoice_date,
      i.accounting_status,
      i.accounting_entry_id,
      i.accounting_message
    FROM invoices i
    WHERE ${conditions.join(" AND ")}
    ORDER BY i.invoice_date ASC, i.id ASC
    ${limitClause};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

async function getPostedInvoiceEntries(invoiceId) {
  const result = await pool.query(
    `
      SELECT id, entry_number
      FROM journal_entries
      WHERE reference_type = 'invoice'
        AND reference_id = $1
        AND status = 'posted'
      ORDER BY id DESC;
    `,
    [invoiceId]
  );

  return result.rows;
}

async function replayInvoiceAccounting(invoiceRow) {
  const invoice = await getInvoiceById(invoiceRow.id);

  if (!invoice) {
    const accounting = {
      status: "error",
      reason: `Facture introuvable pour invoice_id=${invoiceRow.id}.`
    };

    await persistAccountingStatus({
      tableName: "invoices",
      recordId: invoiceRow.id,
      accountingResult: accounting
    });

    return {
      invoiceId: invoiceRow.id,
      status: accounting.status,
      message: accounting.reason
    };
  }

  let accounting;

  try {
    const existingPostedEntries = await getPostedInvoiceEntries(invoice.id);

    if (existingPostedEntries.length > 0) {
      const latestEntry = existingPostedEntries[0];

      accounting = {
        status: "posted",
        journal_entry_id: latestEntry.id,
        reason: `Facture deja comptabilisee via ${latestEntry.entry_number}.`
      };
    } else {
      accounting = await autoPostInvoiceEntry({
        invoice,
        accounting: {},
        created_by: invoice.created_by ? Number(invoice.created_by) : null
      });
    }
  } catch (error) {
    accounting = {
      status: "error",
      reason: error.message
    };
  }

  await persistAccountingStatus({
    tableName: "invoices",
    recordId: invoice.id,
    accountingResult: accounting
  });

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    status: accounting.status || "unknown",
    journalEntryId: accounting.journal_entry_id || null,
    message: accounting.reason || null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await getReplayCandidates(args);

  if (candidates.length === 0) {
    console.log("Aucune facture a recomptabiliser.");
    return;
  }

  console.log(`Factures a traiter : ${candidates.length}`);

  const results = [];

  for (const invoice of candidates) {
    const result = await replayInvoiceAccounting(invoice);
    results.push(result);

    const suffix = result.journalEntryId
      ? ` -> ecriture #${result.journalEntryId}`
      : result.message
        ? ` -> ${result.message}`
        : "";

    console.log(
      `Facture #${result.invoiceId} / ${result.invoiceNumber || "?"} : ${result.status}${suffix}`
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

  console.log("\nResume");
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
