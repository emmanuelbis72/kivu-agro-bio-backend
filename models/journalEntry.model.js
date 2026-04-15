import { pool } from "../config/db.js";

export async function getJournalEntryById(id) {
  const entryQuery = `
    SELECT
      je.*,
      fp.code AS fiscal_period_code,
      fp.label AS fiscal_period_label
    FROM journal_entries je
    LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
    WHERE je.id = $1
    LIMIT 1;
  `;

  const linesQuery = `
    SELECT
      jel.*,
      a.account_number,
      a.account_name,
      a.account_class,
      a.account_type
    FROM journal_entry_lines jel
    INNER JOIN accounts a ON a.id = jel.account_id
    WHERE jel.journal_entry_id = $1
    ORDER BY jel.line_number ASC;
  `;

  const [entryResult, linesResult] = await Promise.all([
    pool.query(entryQuery, [id]),
    pool.query(linesQuery, [id])
  ]);

  const entry = entryResult.rows[0] || null;

  if (!entry) {
    return null;
  }

  return {
    ...entry,
    lines: linesResult.rows
  };
}

export async function getAllJournalEntries({
  status = null,
  journal_code = null,
  start_date = null,
  end_date = null,
  limit = 100
} = {}) {
  const conditions = [];
  const values = [];
  let index = 1;

  if (status) {
    conditions.push(`je.status = $${index++}`);
    values.push(status);
  }

  if (journal_code) {
    conditions.push(`je.journal_code = $${index++}`);
    values.push(journal_code);
  }

  if (start_date) {
    conditions.push(`je.entry_date >= $${index++}`);
    values.push(start_date);
  }

  if (end_date) {
    conditions.push(`je.entry_date <= $${index++}`);
    values.push(end_date);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  values.push(limit);

  const query = `
    SELECT
      je.id,
      je.entry_number,
      je.entry_date,
      je.journal_code,
      je.description,
      je.reference_type,
      je.reference_id,
      je.source_module,
      je.status,
      je.fiscal_period_id,
      je.created_by,
      je.validated_by,
      je.validated_at,
      je.created_at,
      je.updated_at,
      fp.code AS fiscal_period_code,
      fp.label AS fiscal_period_label,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit,
      COUNT(jel.id)::int AS lines_count
    FROM journal_entries je
    LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
    LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    ${whereClause}
    GROUP BY je.id, fp.code, fp.label
    ORDER BY je.entry_date DESC, je.created_at DESC
    LIMIT $${index};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

export async function getNextJournalEntryNumber(journalCode, entryDate) {
  const year = new Date(entryDate).getFullYear();

  const query = `
    SELECT COUNT(*)::int AS count
    FROM journal_entries
    WHERE journal_code = $1
      AND EXTRACT(YEAR FROM entry_date) = $2;
  `;

  const result = await pool.query(query, [journalCode, year]);
  const nextNumber = result.rows[0].count + 1;

  return `${journalCode}-${year}-${String(nextNumber).padStart(5, "0")}`;
}

export async function createJournalEntryWithLines(data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const entryInsertQuery = `
      INSERT INTO journal_entries (
        entry_number,
        entry_date,
        journal_code,
        description,
        reference_type,
        reference_id,
        source_module,
        status,
        fiscal_period_id,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *;
    `;

    const entryValues = [
      data.entry_number,
      data.entry_date,
      data.journal_code,
      data.description,
      data.reference_type || null,
      data.reference_id || null,
      data.source_module || null,
      data.status || "draft",
      data.fiscal_period_id || null,
      data.created_by || null
    ];

    const entryResult = await client.query(entryInsertQuery, entryValues);
    const entry = entryResult.rows[0];

    const insertedLines = [];

    for (const line of data.lines) {
      const lineQuery = `
        INSERT INTO journal_entry_lines (
          journal_entry_id,
          account_id,
          line_number,
          description,
          debit,
          credit,
          partner_type,
          partner_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
      `;

      const lineValues = [
        entry.id,
        line.account_id,
        line.line_number,
        line.description || null,
        line.debit ?? 0,
        line.credit ?? 0,
        line.partner_type || null,
        line.partner_id || null
      ];

      const lineResult = await client.query(lineQuery, lineValues);
      insertedLines.push(lineResult.rows[0]);
    }

    await client.query("COMMIT");

    return {
      ...entry,
      lines: insertedLines
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function postJournalEntry(id, validatedBy = null) {
  const query = `
    UPDATE journal_entries
    SET
      status = 'posted',
      validated_by = $1,
      validated_at = NOW(),
      updated_at = NOW()
    WHERE id = $2
      AND status = 'draft'
    RETURNING *;
  `;

  const result = await pool.query(query, [validatedBy, id]);
  return result.rows[0] || null;
}