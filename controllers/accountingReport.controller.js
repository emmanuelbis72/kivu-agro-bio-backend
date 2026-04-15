import {
  getGeneralLedger,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet
} from "../models/accountingReport.model.js";
import {
  createGeneralLedgerPdfBuffer,
  createTrialBalancePdfBuffer
} from "../services/accountingPdf.service.js";

const allowedStatuses = ["draft", "posted", "cancelled"];

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function getValidatedStatus(req, res) {
  const status = req.query.status?.trim() || "posted";

  if (!allowedStatuses.includes(status)) {
    res.status(400).json({
      success: false,
      message: "Le paramètre 'status' est invalide."
    });
    return null;
  }

  return status;
}

export async function getGeneralLedgerHandler(req, res, next) {
  try {
    const accountId = Number(req.query.account_id);

    if (!isPositiveInteger(accountId)) {
      return res.status(400).json({
        success: false,
        message:
          "Le paramètre 'account_id' est obligatoire et doit être un entier positif."
      });
    }

    const status = getValidatedStatus(req, res);
    if (!status) return;

    const result = await getGeneralLedger({
      account_id: accountId,
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status,
      journal_code: req.query.journal_code?.trim() || null
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Compte introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadGeneralLedgerPdfHandler(req, res, next) {
  try {
    const accountId = Number(req.query.account_id);

    if (!isPositiveInteger(accountId)) {
      return res.status(400).json({
        success: false,
        message:
          "Le paramètre 'account_id' est obligatoire et doit être un entier positif."
      });
    }

    const status = getValidatedStatus(req, res);
    if (!status) return;

    const result = await getGeneralLedger({
      account_id: accountId,
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status,
      journal_code: req.query.journal_code?.trim() || null
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Compte introuvable."
      });
    }

    const pdfBuffer = await createGeneralLedgerPdfBuffer(result, {
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status,
      journal_code: req.query.journal_code?.trim() || null
    });

    const filename = `grand-livre-${result.account.account_number}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    return res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
}

export async function getTrialBalanceHandler(req, res, next) {
  try {
    const status = getValidatedStatus(req, res);
    if (!status) return;

    const result = await getTrialBalance({
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status
    });

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadTrialBalancePdfHandler(req, res, next) {
  try {
    const status = getValidatedStatus(req, res);
    if (!status) return;

    const result = await getTrialBalance({
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status
    });

    const pdfBuffer = await createTrialBalancePdfBuffer(result, {
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status
    });

    const filename = "balance-generale.pdf";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    return res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
}

export async function getIncomeStatementHandler(req, res, next) {
  try {
    const status = getValidatedStatus(req, res);
    if (!status) return;

    const result = await getIncomeStatement({
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function getBalanceSheetHandler(req, res, next) {
  try {
    const status = getValidatedStatus(req, res);
    if (!status) return;

    const result = await getBalanceSheet({
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      status
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}