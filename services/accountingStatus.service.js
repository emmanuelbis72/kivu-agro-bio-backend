import { pool } from "../config/db.js";

const allowedTables = ["invoices", "payments", "expenses"];

export async function persistAccountingStatus({
  tableName,
  recordId,
  accountingResult
}) {
  if (!allowedTables.includes(tableName)) {
    throw new Error("Table non autorisée pour la persistance comptable.");
  }

  if (!recordId || Number(recordId) <= 0) {
    throw new Error("ID enregistrement invalide.");
  }

  const status = accountingResult?.status || null;
  const entryId = accountingResult?.journal_entry_id || null;
  const message = accountingResult?.reason || null;

  const query = `
    UPDATE ${tableName}
    SET
      accounting_status = $1,
      accounting_entry_id = $2,
      accounting_message = $3
    WHERE id = $4
    RETURNING accounting_status, accounting_entry_id, accounting_message;
  `;

  const result = await pool.query(query, [status, entryId, message, recordId]);
  return result.rows[0] || null;
}