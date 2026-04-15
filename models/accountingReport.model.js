import { pool } from "../config/db.js";

export async function getAccountSnapshot(accountId) {
  const query = `
    SELECT
      id,
      account_number,
      account_name,
      account_class,
      account_type,
      is_postable,
      is_active
    FROM accounts
    WHERE id = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [accountId]);
  return result.rows[0] || null;
}

export async function getGeneralLedger({
  account_id,
  start_date = null,
  end_date = null,
  status = "posted",
  journal_code = null
}) {
  const account = await getAccountSnapshot(account_id);

  if (!account) {
    return null;
  }

  let openingBalance = 0;

  if (start_date) {
    const openingQuery = `
      SELECT
        COALESCE(SUM(jel.debit), 0) AS total_debit,
        COALESCE(SUM(jel.credit), 0) AS total_credit
      FROM journal_entry_lines jel
      INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE jel.account_id = $1
        AND je.status = $2
        AND je.entry_date < $3
        ${journal_code ? "AND je.journal_code = $4" : ""}
    `;

    const openingValues = journal_code
      ? [account_id, status, start_date, journal_code]
      : [account_id, status, start_date];

    const openingResult = await pool.query(openingQuery, openingValues);
    const openingRow = openingResult.rows[0];

    openingBalance =
      Number(openingRow.total_debit || 0) - Number(openingRow.total_credit || 0);
  }

  const conditions = [];
  const values = [];
  let index = 1;

  if (status) {
    conditions.push(`je.status = $${index++}`);
    values.push(status);
  }

  if (start_date) {
    conditions.push(`je.entry_date >= $${index++}`);
    values.push(start_date);
  }

  if (end_date) {
    conditions.push(`je.entry_date <= $${index++}`);
    values.push(end_date);
  }

  if (journal_code) {
    conditions.push(`je.journal_code = $${index++}`);
    values.push(journal_code);
  }

  conditions.push(`jel.account_id = $${index++}`);
  values.push(account_id);

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const linesQuery = `
    SELECT
      je.id AS journal_entry_id,
      je.entry_number,
      je.entry_date,
      je.journal_code,
      je.description AS entry_description,
      je.reference_type,
      je.reference_id,
      je.source_module,
      jel.id AS line_id,
      jel.line_number,
      jel.description AS line_description,
      jel.debit,
      jel.credit,
      jel.partner_type,
      jel.partner_id
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    ${whereClause}
    ORDER BY je.entry_date ASC, je.created_at ASC, jel.line_number ASC;
  `;

  const linesResult = await pool.query(linesQuery, values);

  let runningBalance = openingBalance;

  const lines = linesResult.rows.map((row) => {
    runningBalance += Number(row.debit || 0) - Number(row.credit || 0);

    return {
      ...row,
      running_balance: runningBalance
    };
  });

  const periodDebit = lines.reduce(
    (sum, row) => sum + Number(row.debit || 0),
    0
  );
  const periodCredit = lines.reduce(
    (sum, row) => sum + Number(row.credit || 0),
    0
  );

  return {
    account,
    opening_balance: openingBalance,
    period_debit: periodDebit,
    period_credit: periodCredit,
    closing_balance: runningBalance,
    lines
  };
}

export async function getTrialBalance({
  start_date = null,
  end_date = null,
  status = "posted"
}) {
  const conditions = [];
  const values = [];
  let index = 1;

  if (status) {
    conditions.push(`je.status = $${index++}`);
    values.push(status);
  }

  if (start_date) {
    conditions.push(`je.entry_date >= $${index++}`);
    values.push(start_date);
  }

  if (end_date) {
    conditions.push(`je.entry_date <= $${index++}`);
    values.push(end_date);
  }

  const extraJoinFilter =
    conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      a.id AS account_id,
      a.account_number,
      a.account_name,
      a.account_class,
      a.account_type,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit,
      COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS balance
    FROM accounts a
    LEFT JOIN journal_entry_lines jel
      ON jel.account_id = a.id
    LEFT JOIN journal_entries je
      ON je.id = jel.journal_entry_id
      ${extraJoinFilter}
    WHERE a.is_active = TRUE
    GROUP BY
      a.id,
      a.account_number,
      a.account_name,
      a.account_class,
      a.account_type
    HAVING
      COALESCE(SUM(jel.debit), 0) <> 0
      OR COALESCE(SUM(jel.credit), 0) <> 0
    ORDER BY a.account_number ASC;
  `;

  const result = await pool.query(query, values);

  const rows = result.rows.map((row) => ({
    ...row,
    debit_balance: Number(row.balance) > 0 ? Number(row.balance) : 0,
    credit_balance: Number(row.balance) < 0 ? Math.abs(Number(row.balance)) : 0
  }));

  const totals = rows.reduce(
    (acc, row) => {
      acc.total_debit += Number(row.total_debit || 0);
      acc.total_credit += Number(row.total_credit || 0);
      acc.total_debit_balance += Number(row.debit_balance || 0);
      acc.total_credit_balance += Number(row.credit_balance || 0);
      return acc;
    },
    {
      total_debit: 0,
      total_credit: 0,
      total_debit_balance: 0,
      total_credit_balance: 0
    }
  );

  return {
    rows,
    totals
  };
}

export async function getIncomeStatement({
  start_date = null,
  end_date = null,
  status = "posted"
}) {
  const conditions = [
    `a.is_active = TRUE`,
    `a.account_type IN ('income', 'expense')`
  ];
  const values = [];
  let index = 1;

  if (status) {
    conditions.push(`je.status = $${index++}`);
    values.push(status);
  }

  if (start_date) {
    conditions.push(`je.entry_date >= $${index++}`);
    values.push(start_date);
  }

  if (end_date) {
    conditions.push(`je.entry_date <= $${index++}`);
    values.push(end_date);
  }

  const query = `
    SELECT
      a.id AS account_id,
      a.account_number,
      a.account_name,
      a.account_class,
      a.account_type,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY
      a.id,
      a.account_number,
      a.account_name,
      a.account_class,
      a.account_type
    HAVING
      COALESCE(SUM(jel.debit), 0) <> 0
      OR COALESCE(SUM(jel.credit), 0) <> 0
    ORDER BY a.account_number ASC;
  `;

  const result = await pool.query(query, values);

  const rows = result.rows.map((row) => {
    const debit = Number(row.total_debit || 0);
    const credit = Number(row.total_credit || 0);

    const net_amount =
      row.account_type === "expense"
        ? debit - credit
        : credit - debit;

    return {
      ...row,
      net_amount
    };
  });

  const revenues = rows.filter((row) => row.account_type === "income");
  const expenses = rows.filter((row) => row.account_type === "expense");

  const totalRevenue = revenues.reduce(
    (sum, row) => sum + Number(row.net_amount || 0),
    0
  );
  const totalExpense = expenses.reduce(
    (sum, row) => sum + Number(row.net_amount || 0),
    0
  );

  return {
    revenues,
    expenses,
    totals: {
      total_revenue: totalRevenue,
      total_expense: totalExpense,
      net_result: totalRevenue - totalExpense
    }
  };
}

export async function getBalanceSheet({
  start_date = null,
  end_date = null,
  status = "posted"
}) {
  const conditions = [
    `a.is_active = TRUE`,
    `a.account_type IN ('asset', 'liability', 'equity')`
  ];
  const values = [];
  let index = 1;

  if (status) {
    conditions.push(`je.status = $${index++}`);
    values.push(status);
  }

  if (start_date) {
    conditions.push(`je.entry_date >= $${index++}`);
    values.push(start_date);
  }

  if (end_date) {
    conditions.push(`je.entry_date <= $${index++}`);
    values.push(end_date);
  }

  const query = `
    SELECT
      a.id AS account_id,
      a.account_number,
      a.account_name,
      a.account_class,
      a.account_type,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY
      a.id,
      a.account_number,
      a.account_name,
      a.account_class,
      a.account_type
    HAVING
      COALESCE(SUM(jel.debit), 0) <> 0
      OR COALESCE(SUM(jel.credit), 0) <> 0
    ORDER BY a.account_number ASC;
  `;

  const result = await pool.query(query, values);

  const rows = result.rows.map((row) => {
    const debit = Number(row.total_debit || 0);
    const credit = Number(row.total_credit || 0);

    const balance_amount =
      row.account_type === "asset"
        ? debit - credit
        : credit - debit;

    return {
      ...row,
      balance_amount
    };
  });

  const assets = rows.filter(
    (row) => row.account_type === "asset" && Number(row.balance_amount) !== 0
  );
  const liabilities = rows.filter(
    (row) => row.account_type === "liability" && Number(row.balance_amount) !== 0
  );
  const equity = rows.filter(
    (row) => row.account_type === "equity" && Number(row.balance_amount) !== 0
  );

  const totalAssets = assets.reduce(
    (sum, row) => sum + Number(row.balance_amount || 0),
    0
  );
  const totalLiabilities = liabilities.reduce(
    (sum, row) => sum + Number(row.balance_amount || 0),
    0
  );
  const totalEquity = equity.reduce(
    (sum, row) => sum + Number(row.balance_amount || 0),
    0
  );

  return {
    assets,
    liabilities,
    equity,
    totals: {
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      total_equity: totalEquity,
      total_liabilities_and_equity: totalLiabilities + totalEquity,
      gap: totalAssets - (totalLiabilities + totalEquity)
    }
  };
}