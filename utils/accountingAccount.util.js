export function isIncomeAccount(account) {
  if (!account || !account.is_active || !account.is_postable) {
    return false;
  }

  const accountClass = String(account.account_class || "").trim();
  const accountType = String(account.account_type || "").trim().toLowerCase();

  return (
    accountClass.startsWith("7") ||
    accountType === "income" ||
    accountType === "revenue"
  );
}
