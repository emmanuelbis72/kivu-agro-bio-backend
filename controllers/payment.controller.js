import { getInvoiceById, recomputeInvoiceBalances } from "../models/invoice.model.js";
import { createPayment, getPaymentsByInvoiceId } from "../models/payment.model.js";
import { autoPostPaymentEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isPositiveNumber(value) {
  return !isNaN(value) && Number(value) > 0;
}

export async function createPaymentHandler(req, res, next) {
  try {
    const invoice_id = Number(req.body.invoice_id);
    const amount = Number(req.body.amount);
    const payment_date =
      req.body.payment_date || new Date().toISOString().split("T")[0];

    if (!isPositiveInteger(invoice_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'invoice_id' est invalide."
      });
    }

    if (!isPositiveNumber(amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'amount' doit être > 0."
      });
    }

    const invoice = await getInvoiceById(invoice_id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    if (Number(amount) > Number(invoice.balance_due)) {
      return res.status(400).json({
        success: false,
        message: "Le montant payé dépasse le solde restant dû."
      });
    }

    const payment = await createPayment({
      invoice_id,
      payment_date,
      amount,
      payment_method: req.body.payment_method?.trim() || "cash",
      reference: req.body.reference?.trim(),
      notes: req.body.notes?.trim(),
      received_by: req.body.received_by ? Number(req.body.received_by) : null
    });

    const updatedInvoice = await recomputeInvoiceBalances(invoice_id);

    let accounting = {
      status: "skipped",
      reason: "Aucune tentative de comptabilisation."
    };

    try {
      accounting = await autoPostPaymentEntry({
        payment,
        invoice,
        accounting: req.body.accounting || {},
        created_by: req.body.received_by ? Number(req.body.received_by) : null
      });
    } catch (accountingError) {
      accounting = {
        status: "error",
        reason: accountingError.message
      };
    }

    await persistAccountingStatus({
      tableName: "payments",
      recordId: payment.id,
      accountingResult: accounting
    });

    return res.status(201).json({
      success: true,
      message: "Paiement enregistré avec succès.",
      data: {
        payment: {
          ...payment,
          accounting_status: accounting.status || null,
          accounting_entry_id: accounting.journal_entry_id || null,
          accounting_message: accounting.reason || null
        },
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

    return res.status(200).json({
      success: true,
      count: payments.length,
      data: payments
    });
  } catch (error) {
    next(error);
  }
}