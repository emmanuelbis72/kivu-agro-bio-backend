import { getInvoiceById, recomputeInvoiceBalances } from "../models/invoice.model.js";
import {
  createPayment,
  getPaymentsByInvoiceId,
  getUnallocatedPaymentById,
  getUnallocatedPayments,
  markUnallocatedPaymentAllocated,
  updateUnallocatedPayment
} from "../models/payment.model.js";
import { autoPostPaymentEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

const ALLOWED_PAYMENT_METHODS = [
  "cash",
  "mobile_money",
  "bank_transfer",
  "card"
];

function shouldRetryPaymentAccounting(payment) {
  if (!payment || Number(payment.accounting_entry_id || 0) > 0) {
    return false;
  }

  const status = String(payment.accounting_status || "").trim().toLowerCase();
  return status === "" || status === "error" || status === "skipped";
}

async function ensurePaymentAccounting({
  payment,
  invoice,
  accounting = {},
  created_by = null
}) {
  if (!payment) {
    return null;
  }

  if (!shouldRetryPaymentAccounting(payment)) {
    return payment;
  }

  let accountingResult = {
    status: "skipped",
    reason: "Aucune tentative de comptabilisation."
  };

  try {
    accountingResult = await autoPostPaymentEntry({
      payment,
      invoice,
      accounting,
      created_by
    });
  } catch (accountingError) {
    accountingResult = {
      status: "error",
      reason: accountingError.message
    };
  }

  await persistAccountingStatus({
    tableName: "payments",
    recordId: payment.id,
    accountingResult
  });

  return {
    ...payment,
    accounting_status: accountingResult.status || null,
    accounting_entry_id: accountingResult.journal_entry_id || null,
    accounting_message: accountingResult.reason || null
  };
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isPositiveNumber(value) {
  return !Number.isNaN(Number(value)) && Number(value) > 0;
}

export async function createPaymentHandler(req, res, next) {
  try {
    const invoice_id = Number(req.body.invoice_id);
    const amount = Number(req.body.amount);
    const payment_date =
      req.body.payment_date || new Date().toISOString().split("T")[0];
    const payment_method = String(req.body.payment_method || "cash").trim();

    if (!isPositiveInteger(invoice_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'invoice_id' est invalide."
      });
    }

    if (!isPositiveNumber(amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'amount' doit etre > 0."
      });
    }

    if (!ALLOWED_PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        message:
          "Le champ 'payment_method' est invalide. Valeurs attendues : cash, mobile_money, bank_transfer, card."
      });
    }

    const invoice = await getInvoiceById(invoice_id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    if (String(invoice.status || "").trim().toLowerCase() === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cette facture est deja entierement payee."
      });
    }

    if (Number(invoice.balance_due) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Cette facture ne presente plus de solde a payer."
      });
    }

    if (Number(amount) > Number(invoice.balance_due)) {
      return res.status(400).json({
        success: false,
        message: "Le montant paye depasse le solde restant du."
      });
    }

    const payment = await createPayment({
      invoice_id,
      payment_date,
      amount,
      payment_method,
      reference: req.body.reference?.trim(),
      notes: req.body.notes?.trim(),
      received_by: req.body.received_by ? Number(req.body.received_by) : null
    });

    const updatedInvoice = await recomputeInvoiceBalances(invoice_id);

    const accountedPayment = await ensurePaymentAccounting({
      payment,
      invoice,
      accounting: req.body.accounting || {},
      created_by: req.body.received_by ? Number(req.body.received_by) : null
    });
    const accounting = {
      status: accountedPayment?.accounting_status || null,
      journal_entry_id: accountedPayment?.accounting_entry_id || null,
      reason: accountedPayment?.accounting_message || null
    };

    return res.status(201).json({
      success: true,
      message: "Paiement enregistre avec succes.",
      data: {
        payment: accountedPayment,
        invoice: updatedInvoice,
        accounting
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function getPaymentsByInvoiceIdHandler(req, res, next) {
  try {
    const invoiceId = Number(req.params.invoiceId);

    if (!isPositiveInteger(invoiceId)) {
      return res.status(400).json({
        success: false,
        message: "ID facture invalide."
      });
    }

    const invoice = await getInvoiceById(invoiceId);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    const payments = await getPaymentsByInvoiceId(invoiceId);
    const healedPayments = await Promise.all(
      payments.map((payment) =>
        ensurePaymentAccounting({
          payment,
          invoice
        })
      )
    );

    return res.status(200).json({
      success: true,
      count: healedPayments.length,
      data: healedPayments
    });
  } catch (error) {
    next(error);
  }
}

export async function getUnallocatedPaymentsHandler(req, res, next) {
  try {
    const limit = Number(req.query.limit || 100);
    const state = String(req.query.state || "pending").trim();

    const rows = await getUnallocatedPayments({
      state,
      limit: Number.isInteger(limit) && limit > 0 ? limit : 100
    });

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function updateUnallocatedPaymentHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID paiement importe invalide."
      });
    }

    const amount =
      req.body.amount !== undefined && req.body.amount !== null
        ? Number(req.body.amount)
        : null;

    if (amount !== null && !isPositiveNumber(amount)) {
      return res.status(400).json({
        success: false,
        message: "Le montant du paiement doit etre > 0."
      });
    }

    const payment_method = req.body.payment_method
      ? String(req.body.payment_method).trim()
      : null;

    if (
      payment_method &&
      payment_method !== "unknown" &&
      !ALLOWED_PAYMENT_METHODS.includes(payment_method)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Le champ 'payment_method' est invalide. Valeurs attendues : cash, mobile_money, bank_transfer, card."
      });
    }

    const updated = await updateUnallocatedPayment(id, {
      raw_customer_name: req.body.raw_customer_name?.trim(),
      payment_date: req.body.payment_date || null,
      amount,
      payment_method,
      reference: req.body.reference?.trim(),
      notes: req.body.notes?.trim()
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Paiement importe introuvable ou deja affecte."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Paiement importe mis a jour avec succes.",
      data: updated
    });
  } catch (error) {
    next(error);
  }
}

export async function allocateUnallocatedPaymentHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const invoice_id = Number(req.body.invoice_id);
    const amount =
      req.body.amount !== undefined && req.body.amount !== null
        ? Number(req.body.amount)
        : null;
    const payment_method = String(req.body.payment_method || "bank_transfer").trim();

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID paiement importe invalide."
      });
    }

    if (!isPositiveInteger(invoice_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'invoice_id' est invalide."
      });
    }

    if (!ALLOWED_PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        message:
          "Le champ 'payment_method' est invalide. Valeurs attendues : cash, mobile_money, bank_transfer, card."
      });
    }

    if (amount !== null && !isPositiveNumber(amount)) {
      return res.status(400).json({
        success: false,
        message: "Le montant du paiement doit etre > 0."
      });
    }

    const unallocatedPayment = await getUnallocatedPaymentById(id);

    if (!unallocatedPayment || unallocatedPayment.allocation_state !== "pending") {
      return res.status(404).json({
        success: false,
        message: "Paiement importe introuvable ou deja affecte."
      });
    }

    const invoice = await getInvoiceById(invoice_id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    if (String(invoice.status || "").trim().toLowerCase() === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cette facture est deja entierement payee."
      });
    }

    const finalAmount = amount ?? Number(unallocatedPayment.amount);

    if (Number(finalAmount) > Number(invoice.balance_due || 0)) {
      return res.status(400).json({
        success: false,
        message: "Le montant paye depasse le solde restant du."
      });
    }

    const updatedUnallocated = await updateUnallocatedPayment(id, {
      raw_customer_name: req.body.raw_customer_name?.trim(),
      payment_date: req.body.payment_date || unallocatedPayment.payment_date,
      amount: finalAmount,
      payment_method,
      reference: req.body.reference?.trim() || unallocatedPayment.reference,
      notes: req.body.notes?.trim() || unallocatedPayment.notes
    });

    const payment = await createPayment({
      invoice_id,
      payment_date: updatedUnallocated.payment_date,
      amount: finalAmount,
      payment_method,
      reference: updatedUnallocated.reference,
      notes:
        updatedUnallocated.notes ||
        `Rapprochement du paiement importe ${updatedUnallocated.id}`,
      received_by: req.body.received_by ? Number(req.body.received_by) : null
    });

    const updatedInvoice = await recomputeInvoiceBalances(invoice_id);
    await markUnallocatedPaymentAllocated(id, {
      invoice_id,
      payment_id: payment.id
    });

    const accountedPayment = await ensurePaymentAccounting({
      payment,
      invoice,
      accounting: req.body.accounting || {},
      created_by: req.body.received_by ? Number(req.body.received_by) : null
    });
    const accounting = {
      status: accountedPayment?.accounting_status || null,
      journal_entry_id: accountedPayment?.accounting_entry_id || null,
      reason: accountedPayment?.accounting_message || null
    };

    return res.status(201).json({
      success: true,
      message: "Paiement importe affecte a la facture avec succes.",
      data: {
        payment: accountedPayment,
        invoice: updatedInvoice,
        accounting
      }
    });
  } catch (error) {
    next(error);
  }
}
