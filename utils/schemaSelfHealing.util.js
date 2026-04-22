export function isUndefinedTableError(error) {
  return error?.code === "42P01";
}

export function isConcurrentCreateError(error, relationName) {
  const message = String(error?.message || "");
  const detail = String(error?.detail || "");

  return (
    error?.code === "42P07" ||
    (error?.code === "23505" &&
      (message.includes(relationName) || detail.includes(relationName)))
  );
}

export async function ensureTableSchema({ executor, relationName, createSql }) {
  try {
    await executor(createSql);
  } catch (error) {
    if (!isConcurrentCreateError(error, relationName)) {
      throw error;
    }
  }
}

export async function queryWithSchemaRetry({
  executor,
  ensureSchema,
  query,
  values = []
}) {
  try {
    return await executor(query, values);
  } catch (error) {
    if (!isUndefinedTableError(error)) {
      throw error;
    }

    await ensureSchema();
    return executor(query, values);
  }
}
