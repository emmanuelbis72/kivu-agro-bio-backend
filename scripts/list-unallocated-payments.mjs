import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

function parseArgs(argv) {
  const args = {
    limit: 100,
    state: "pending"
  };
  const positional = [];

  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];

    if (item === "--limit" && argv[index + 1]) {
      args.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (item === "--state" && argv[index + 1]) {
      args.state = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    positional.push(item);
  }

  args.limit = Number(positional[0]) || args.limit;
  args.state = positional[1] || args.state;

  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    args.limit = 100;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL manquant dans .env ou les variables d'environnement.");
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
  });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        up.id AS payment_id,
        up.payment_date,
        up.raw_customer_name,
        c.business_name AS matched_customer_name,
        up.amount,
        up.allocation_state,
        up.reference
      FROM unallocated_payments up
      LEFT JOIN customers c ON c.id = up.matched_customer_id
      WHERE up.allocation_state = $1
      ORDER BY up.payment_date ASC, up.id ASC
      LIMIT $2;
      `,
      [args.state, args.limit]
    );

    console.table(rows);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Lecture des paiements en attente impossible:", error);
  process.exit(1);
});
