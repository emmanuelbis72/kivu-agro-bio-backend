export function roundCustomerAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function normalizeCustomerBalanceRow(row = {}) {
  const invoicedAmount = roundCustomerAmount(row.invoiced_amount);
  const paidAmount = roundCustomerAmount(row.paid_amount);
  const balanceAmount = roundCustomerAmount(
    row.balance_due_amount ?? row.balance_amount ?? invoicedAmount - paidAmount
  );

  return {
    ...row,
    invoices_count: Number(row.invoices_count || 0),
    payments_count: Number(row.payments_count || 0),
    invoiced_amount: invoicedAmount,
    paid_amount: paidAmount,
    balance_due_amount: balanceAmount,
    balance_amount: balanceAmount
  };
}
