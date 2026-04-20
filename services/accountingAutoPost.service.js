import dotenv from "dotenv";
import { getAccountById, getAccountByNumber } from "../models/account.model.js";
import { getCustomerById } from "../models/customer.model.js";
import { getProductById } from "../models/product.model.js";
import {
  getExpenseCategoryAccountByCategory,
  getPaymentMethodAccountByMethod
} from "../models/accountingSettings.model.js";
import {
  createJournalEntryWithLines,
  getNextJournalEntryNumber,
  postJournalEntry
} from "../models/journalEntry.model.js";

dotenv.config();

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function resolvePostableAccountById(accountId) {
  if (!accountId) {
    return null;
  }

  const account = await getAccountById(Number(accountId));

  if (!account || !account.is_active || !account.is_postable) {
    return null;
  }

  return account;
}

async function resolvePostableAccount(accountNumber) {
  if (!accountNumber) {
    return null;
  }

  const account = await getAccountByNumber(String(accountNumber).trim());

  if (!account || !account.is_active || !account.is_postable) {
    return null;
  }

  return account;
}

async function resolveCustomerReceivableAccount(customerId, overrides = {}) {
  const overrideAccount = await resolvePostableAccount(
    overrides.customer_account_number || null
  );

  if (overrideAccount) {
    return overrideAccount;
  }

  const customer = await getCustomerById(customerId);
  const customerAccount = await resolvePostableAccountById(
    customer?.receivable_account_id || null
  );

  if (customerAccount) {
    return customerAccount;
  }

  return resolvePostableAccount(
    process.env.ACCOUNTING_CUSTOMER_ACCOUNT_NUMBER || null
  );
}

async function resolveProductSalesAccount(productId, overrides = {}) {
  const overrideAccount = await resolvePostableAccount(
    overrides.sales_account_number || null
  );

  if (overrideAccount) {
    return overrideAccount;
  }

  const product = await getProductById(productId);
  const productAccount = await resolvePostableAccountById(
    product?.sales_account_id || null
  );

  if (productAccount) {
    return productAccount;
  }

  return resolvePostableAccount(
    process.env.ACCOUNTING_SALES_ACCOUNT_NUMBER || null
  );
}

async function resolveExpenseAccount(category, overrides = {}) {
  const overrideAccount = await resolvePostableAccount(
    overrides.expense_account_number || null
  );

  if (overrideAccount) {
    return overrideAccount;
  }

  const categoryMapping = await getExpenseCategoryAccountByCategory(
    String(category || "").trim()
  );

  const categoryAccount = await resolvePostableAccountById(
    categoryMapping?.expense_account_id || null
  );

  if (categoryAccount) {
    return categoryAccount;
  }

  return resolvePostableAccount(
    process.env.ACCOUNTING_DEFAULT_EXPENSE_ACCOUNT_NUMBER || null
  );
}

async function resolvePaymentAccount(paymentMethod, overrides = {}) {
  const method = String(paymentMethod || "cash").trim();

  const overrideMapping = {
    cash: overrides.cash_account_number || null,
    mobile_money: overrides.mobile_money_account_number || null,
    bank_transfer: overrides.bank_account_number || null,
    card: overrides.card_account_number || null
  };

  const overrideAccount = await resolvePostableAccount(
    overrideMapping[method] || null
  );

  if (overrideAccount) {
    return overrideAccount;
  }

  const methodMapping = await getPaymentMethodAccountByMethod(method);
  const methodAccount = await resolvePostableAccountById(
    methodMapping?.treasury_account_id || null
  );

  if (methodAccount) {
    return methodAccount;
  }

  const envMapping = {
    cash: process.env.ACCOUNTING_CASH_ACCOUNT_NUMBER || null,
    mobile_money: process.env.ACCOUNTING_MOBILE_MONEY_ACCOUNT_NUMBER || null,
    bank_transfer: process.env.ACCOUNTING_BANK_ACCOUNT_NUMBER || null,
    card: process.env.ACCOUNTING_CARD_ACCOUNT_NUMBER || null
  };

  return resolvePostableAccount(envMapping[method] || null);
}

async function resolveCogsAccount(overrides = {}) {
  const overrideAccount = await resolvePostableAccount(
    overrides.cogs_account_number || null
  );

  if (overrideAccount) {
    return overrideAccount;
  }

  return resolvePostableAccount(
    process.env.ACCOUNTING_COGS_ACCOUNT_NUMBER || null
  );
}

async function resolveInventoryAccount(overrides = {}) {
  const overrideAccount = await resolvePostableAccount(
    overrides.inventory_account_number || null
  );

  if (overrideAccount) {
    return overrideAccount;
  }

  return resolvePostableAccount(
    process.env.ACCOUNTING_INVENTORY_ACCOUNT_NUMBER || null
  );
}

async function createAndPostEntry({
  entry_date,
  journal_code,
  description,
  reference_type,
  reference_id,
  source_module,
  created_by,
  validated_by,
  lines
}) {
  const entry_number = await getNextJournalEntryNumber(journal_code, entry_date);

  const entry = await createJournalEntryWithLines({
    entry_number,
    entry_date,
    journal_code,
    description,
    reference_type,
    reference_id,
    source_module,
    status: "draft",
    fiscal_period_id: null,
    created_by: created_by || null,
    lines: lines.map((line, index) => ({
      ...line,
      line_number: index + 1
    }))
  });

  const posted = await postJournalEntry(
    entry.id,
    validated_by || created_by || null
  );

  return {
    entry,
    posted
  };
}

export async function autoPostInvoiceEntry({
  invoice,
  accounting = {},
  created_by = null
}) {
  const customerAccount = await resolveCustomerReceivableAccount(
    invoice.customer_id,
    accounting
  );

  if (!customerAccount) {
    return {
      status: "skipped",
      reason:
        "Paramétrage comptable vente incomplet : compte client manquant/invalide sur le client ou en fallback."
    };
  }

  const taxAmount = roundAmount(invoice.tax_amount || 0);
  const totalAmount = roundAmount(invoice.total_amount || 0);

  const salesGroups = new Map();

  for (const item of invoice.items || []) {
    const salesAccount = await resolveProductSalesAccount(
      item.product_id,
      accounting
    );

    if (!salesAccount) {
      return {
        status: "skipped",
        reason: `Paramétrage comptable vente incomplet : compte de vente manquant/invalide pour le produit ID ${item.product_id}.`
      };
    }

    const currentAmount = Number(salesGroups.get(salesAccount.id)?.amount || 0);
    const nextAmount = roundAmount(
      currentAmount + Number(item.line_total || 0)
    );

    salesGroups.set(salesAccount.id, {
      account: salesAccount,
      amount: nextAmount
    });
  }

  const salesTotal = roundAmount(
    Array.from(salesGroups.values()).reduce(
      (sum, group) => sum + Number(group.amount || 0),
      0
    )
  );

  const netExpectedSales = roundAmount(
    Number(invoice.total_amount || 0) - Number(invoice.tax_amount || 0)
  );

  if (salesTotal !== netExpectedSales) {
    return {
      status: "error",
      reason:
        "Incohérence comptable facture : total des ventes par produit différent du total attendu hors taxe."
    };
  }

  let taxAccount = null;

  if (taxAmount > 0) {
    const taxAccountNumber =
      accounting.tax_account_number ||
      process.env.ACCOUNTING_TAX_ACCOUNT_NUMBER ||
      null;

    taxAccount = await resolvePostableAccount(taxAccountNumber);

    if (!taxAccount) {
      return {
        status: "skipped",
        reason: "Taxe détectée mais compte de taxe manquant/invalide."
      };
    }
  }

  const salesLines = [
    {
      account_id: customerAccount.id,
      description: "Débit client",
      debit: totalAmount,
      credit: 0,
      partner_type: "customer",
      partner_id: invoice.customer_id
    }
  ];

  for (const group of salesGroups.values()) {
    salesLines.push({
      account_id: group.account.id,
      description: `Crédit vente ${group.account.account_number}`,
      debit: 0,
      credit: roundAmount(group.amount),
      partner_type: "customer",
      partner_id: invoice.customer_id
    });
  }

  if (taxAmount > 0) {
    salesLines.push({
      account_id: taxAccount.id,
      description: "Crédit taxe",
      debit: 0,
      credit: taxAmount,
      partner_type: "customer",
      partner_id: invoice.customer_id
    });
  }

  const salesResult = await createAndPostEntry({
    entry_date: invoice.invoice_date,
    journal_code: "VE",
    description: `Vente liée à la facture ${invoice.invoice_number}`,
    reference_type: "invoice",
    reference_id: invoice.id,
    source_module: "invoice",
    created_by,
    validated_by: created_by,
    lines: salesLines
  });

  const hasCogsData = Array.isArray(invoice.items) && invoice.items.some(
    (item) => Number(item.quantity || 0) > 0 && Number(item.unit_cost || 0) > 0
  );

  if (!hasCogsData) {
    return {
      status: "posted",
      journal_entry_id: salesResult.entry.id,
      entry_number: salesResult.entry.entry_number,
      cogs_status: "skipped",
      cogs_reason: "Aucun coût unitaire exploitable pour générer le coût des ventes."
    };
  }

  const cogsAccount = await resolveCogsAccount(accounting);
  const inventoryAccount = await resolveInventoryAccount(accounting);

  if (!cogsAccount || !inventoryAccount) {
    return {
      status: "posted",
      journal_entry_id: salesResult.entry.id,
      entry_number: salesResult.entry.entry_number,
      cogs_status: "skipped",
      cogs_reason:
        "Comptes COGS / stock manquants ou invalides. Vente comptabilisée sans coût des ventes."
    };
  }

  const totalCogs = roundAmount(
    (invoice.items || []).reduce((sum, item) => {
      return (
        sum +
        Number(item.quantity || 0) * Number(item.unit_cost || 0)
      );
    }, 0)
  );

  if (totalCogs > 0) {
    await createAndPostEntry({
      entry_date: invoice.invoice_date,
      journal_code: "ST",
      description: `Coût des ventes lié à la facture ${invoice.invoice_number}`,
      reference_type: "invoice",
      reference_id: invoice.id,
      source_module: "invoice_cogs",
      created_by,
      validated_by: created_by,
      lines: [
        {
          account_id: cogsAccount.id,
          description: "Débit coût des ventes",
          debit: totalCogs,
          credit: 0,
          partner_type: "customer",
          partner_id: invoice.customer_id
        },
        {
          account_id: inventoryAccount.id,
          description: "Crédit stock",
          debit: 0,
          credit: totalCogs,
          partner_type: "customer",
          partner_id: invoice.customer_id
        }
      ]
    });
  }

  return {
    status: "posted",
    journal_entry_id: salesResult.entry.id,
    entry_number: salesResult.entry.entry_number,
    cogs_status: totalCogs > 0 ? "posted" : "skipped",
    cogs_amount: totalCogs
  };
}

export async function autoPostPaymentEntry({
  payment,
  invoice,
  accounting = {},
  created_by = null
}) {
  const customerAccount = await resolveCustomerReceivableAccount(
    invoice.customer_id,
    accounting
  );
  const paymentAccount = await resolvePaymentAccount(
    payment.payment_method,
    accounting
  );

  if (!customerAccount || !paymentAccount) {
    return {
      status: "skipped",
      reason:
        "Paramétrage comptable paiement incomplet : compte client ou compte d'encaissement manquant/invalide."
    };
  }

  const amount = roundAmount(payment.amount);

  const result = await createAndPostEntry({
    entry_date: payment.payment_date,
    journal_code: "TR",
    description: `Encaissement facture ${invoice.invoice_number}`,
    reference_type: "payment",
    reference_id: payment.id,
    source_module: "payment",
    created_by,
    validated_by: created_by,
    lines: [
      {
        account_id: paymentAccount.id,
        description: "Débit encaissement",
        debit: amount,
        credit: 0,
        partner_type: "customer",
        partner_id: invoice.customer_id
      },
      {
        account_id: customerAccount.id,
        description: "Crédit client",
        debit: 0,
        credit: amount,
        partner_type: "customer",
        partner_id: invoice.customer_id
      }
    ]
  });

  return {
    status: "posted",
    journal_entry_id: result.entry.id,
    entry_number: result.entry.entry_number
  };
}

export async function autoPostExpenseEntry({
  expense,
  accounting = {},
  created_by = null
}) {
  const expenseAccount = await resolveExpenseAccount(
    expense.category,
    accounting
  );
  const paymentAccount = await resolvePaymentAccount(
    expense.payment_method,
    accounting
  );

  if (!expenseAccount || !paymentAccount) {
    return {
      status: "skipped",
      reason:
        "Paramétrage comptable dépense incomplet : compte de charge ou compte de règlement manquant/invalide."
    };
  }

  const amount = roundAmount(expense.amount);

  const result = await createAndPostEntry({
    entry_date: expense.expense_date,
    journal_code: "AC",
    description: `Dépense: ${expense.description}`,
    reference_type: "expense",
    reference_id: expense.id,
    source_module: "expense",
    created_by,
    validated_by: created_by,
    lines: [
      {
        account_id: expenseAccount.id,
        description: "Débit charge",
        debit: amount,
        credit: 0,
        partner_type: "supplier",
        partner_id: null
      },
      {
        account_id: paymentAccount.id,
        description: "Crédit règlement",
        debit: 0,
        credit: amount,
        partner_type: "supplier",
        partner_id: null
      }
    ]
  });

  return {
    status: "posted",
    journal_entry_id: result.entry.id,
    entry_number: result.entry.entry_number
  };
}