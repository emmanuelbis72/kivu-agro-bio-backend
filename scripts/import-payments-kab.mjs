import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const DEFAULT_XLSX_PATH = "C:\\Users\\bcomm\\Documents\\PAIEMENT KAB.xlsx";
const PYTHON_EXTRACTOR = String.raw`
import json
import sys
from datetime import date, datetime
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)

rows = []
for ws in wb.worksheets:
    for row_number, row in enumerate(ws.iter_rows(values_only=True), start=1):
        values = list(row[:3])
        first = values[0]

        if row_number <= 2:
            continue

        if first is None or str(first).strip() == "":
            continue

        customer_name = str(values[0] or "").strip()
        payment_date = values[1]
        amount = values[2]

        if isinstance(payment_date, (datetime, date)):
            payment_date = payment_date.isoformat()[:10]
        elif payment_date is not None:
            payment_date = str(payment_date).strip()[:10]
        else:
            payment_date = ""

        amount_text = str(amount or "").strip().replace(" ", "").replace(",", ".")
        try:
            amount_number = float(amount_text)
        except Exception:
            amount_number = 0

        if not customer_name or not payment_date or amount_number <= 0:
            continue

        rows.append({
            "source_sheet": ws.title,
            "source_row": row_number,
            "raw_customer_name": customer_name,
            "payment_date": payment_date,
            "amount": round(amount_number, 2),
            "raw_payload": {
                "customer_name": customer_name,
                "payment_date": payment_date,
                "amount": amount_number
            }
        })

print(json.dumps(rows, ensure_ascii=False))
`;

function parseArgs(argv) {
  const args = {
    file: DEFAULT_XLSX_PATH,
    dryRun: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];

    if (item === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (item === "--file" && argv[index + 1]) {
      args.file = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function makeImportKey({ sourceFile, source_sheet, source_row, raw_customer_name, payment_date, amount }) {
  return crypto
    .createHash("sha256")
    .update(
      [
        path.basename(sourceFile),
        source_sheet,
        source_row,
        normalizeName(raw_customer_name),
        payment_date,
        Number(amount || 0).toFixed(2)
      ].join("|")
    )
    .digest("hex")
    .slice(0, 48);
}

function extractRowsFromWorkbook(filePath) {
  const pythonExe = process.env.PYTHON_EXE || "python";
  const result = spawnSync(pythonExe, ["-c", PYTHON_EXTRACTOR, filePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Extraction Excel impossible avec ${pythonExe}: ${result.stderr || result.stdout}`
    );
  }

  return JSON.parse(result.stdout || "[]");
}

async function ensureUnallocatedPaymentsTable(client) {
  await client.query(`
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

async function loadCustomerMap(client) {
  const { rows } = await client.query(`
    SELECT id, business_name
    FROM customers
    WHERE is_active = TRUE;
  `);

  const exact = new Map();

  for (const row of rows) {
    exact.set(normalizeName(row.business_name), row);
  }

  return exact;
}

function matchCustomer(customerMap, rawCustomerName) {
  const normalized = normalizeName(rawCustomerName);

  if (customerMap.has(normalized)) {
    return customerMap.get(normalized);
  }

  for (const [candidateKey, customer] of customerMap.entries()) {
    if (
      candidateKey &&
      normalized &&
      (candidateKey.includes(normalized) || normalized.includes(candidateKey))
    ) {
      return customer;
    }
  }

  return null;
}

async function importRows({ client, rows, sourceFile, dryRun }) {
  const customerMap = await loadCustomerMap(client);
  const summary = {
    read: rows.length,
    insertedOrUpdated: 0,
    matchedCustomers: 0,
    unmatchedCustomers: 0,
    totalAmount: 0,
    unmatchedNames: new Set()
  };

  for (const row of rows) {
    const matchedCustomer = matchCustomer(customerMap, row.raw_customer_name);
    const importKey = makeImportKey({ sourceFile, ...row });
    summary.totalAmount += Number(row.amount || 0);

    if (matchedCustomer) {
      summary.matchedCustomers += 1;
    } else {
      summary.unmatchedCustomers += 1;
      summary.unmatchedNames.add(row.raw_customer_name);
    }

    if (dryRun) {
      continue;
    }

    await client.query(
      `
      INSERT INTO unallocated_payments (
        import_key,
        source_file,
        source_sheet,
        source_row,
        raw_customer_name,
        matched_customer_id,
        payment_date,
        amount,
        payment_method,
        reference,
        notes,
        raw_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unknown',$9,$10,$11::jsonb)
      ON CONFLICT (import_key)
      DO UPDATE SET
        source_file = EXCLUDED.source_file,
        source_sheet = EXCLUDED.source_sheet,
        source_row = EXCLUDED.source_row,
        raw_customer_name = EXCLUDED.raw_customer_name,
        matched_customer_id = COALESCE(unallocated_payments.matched_customer_id, EXCLUDED.matched_customer_id),
        payment_date = EXCLUDED.payment_date,
        amount = EXCLUDED.amount,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING id;
      `,
      [
        importKey,
        sourceFile,
        row.source_sheet,
        row.source_row,
        row.raw_customer_name,
        matchedCustomer?.id || null,
        row.payment_date,
        row.amount,
        `PAIEMENT-KAB-${row.source_sheet}-${row.source_row}`,
        "Import depuis PAIEMENT KAB.xlsx - en attente de rapprochement facture",
        JSON.stringify(row.raw_payload || {})
      ]
    );

    summary.insertedOrUpdated += 1;
  }

  return {
    ...summary,
    totalAmount: Math.round(summary.totalAmount * 100) / 100,
    unmatchedNames: Array.from(summary.unmatchedNames).sort()
  };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL manquant dans .env ou les variables d'environnement.");
  }

  const rows = extractRowsFromWorkbook(args.file);
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureUnallocatedPaymentsTable(client);

    const summary = await importRows({
      client,
      rows,
      sourceFile: args.file,
      dryRun: args.dryRun
    });

    if (args.dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }

    console.log(
      JSON.stringify(
        {
          success: true,
          dryRun: args.dryRun,
          sourceFile: args.file,
          ...summary
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

main().catch((error) => {
  console.error("Import paiements KAB impossible:", error);
  process.exit(1);
});
