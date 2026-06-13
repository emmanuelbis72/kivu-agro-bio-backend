export const COLLECTION_PAYMENT_STATUSES = [
  "all",
  "open",
  "unpaid",
  "partial",
  "paid"
];

export const COLLECTION_ALERT_LEVELS = [
  "all",
  "green",
  "light_green",
  "orange",
  "red"
];

export function resolveCollectionPaymentStatus(invoice = {}) {
  const paidAmount = Number(invoice.paid_amount || 0);
  const balanceDue = Number(invoice.balance_due || 0);

  if (balanceDue <= 0) {
    return "paid";
  }

  return paidAmount > 0 ? "partial" : "unpaid";
}

export function resolveCollectionAlert(ageDays, paymentStatus = "unpaid") {
  if (paymentStatus === "paid") {
    return {
      level: "paid",
      label: "Payee",
      color: "blue"
    };
  }

  const normalizedAge = Math.max(0, Number(ageDays || 0));

  if (normalizedAge >= 45) {
    return {
      level: "red",
      label: "Critique - 45 j et plus",
      color: "red"
    };
  }

  if (normalizedAge >= 30) {
    return {
      level: "orange",
      label: "A relancer - 30 a 44 j",
      color: "orange"
    };
  }

  if (normalizedAge >= 22) {
    return {
      level: "light_green",
      label: "A surveiller - 22 a 29 j",
      color: "light_green"
    };
  }

  return {
    level: "green",
    label: "Dans le delai - 0 a 21 j",
    color: "green"
  };
}

export function normalizeCollectionInvoice(row = {}) {
  const paymentStatus = resolveCollectionPaymentStatus(row);
  const collectionAgeDays = Math.max(
    0,
    Number(row.collection_age_days || 0)
  );
  const alert = resolveCollectionAlert(collectionAgeDays, paymentStatus);

  return {
    ...row,
    total_amount: Number(row.total_amount || 0),
    paid_amount: Number(row.paid_amount || 0),
    balance_due: Number(row.balance_due || 0),
    collection_age_days: collectionAgeDays,
    payment_status: paymentStatus,
    payment_status_label:
      paymentStatus === "paid"
        ? "Payee"
        : paymentStatus === "partial"
          ? "Partiellement payee"
          : "Non payee",
    alert_level: alert.level,
    alert_label: alert.label,
    alert_color: alert.color
  };
}
