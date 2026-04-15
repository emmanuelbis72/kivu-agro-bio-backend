import { getAccountById } from "../models/account.model.js";
import {
  createJournalEntryWithLines,
  getAllJournalEntries,
  getJournalEntryById,
  getNextJournalEntryNumber,
  postJournalEntry
} from "../models/journalEntry.model.js";

const allowedStatuses = ["draft", "posted", "cancelled"];

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isNonNegativeNumber(value) {
  return !Number.isNaN(Number(value)) && Number(value) >= 0;
}

function roundAmount(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function validateLines(lines) {
  const errors = [];
  const normalizedLines = [];

  if (!Array.isArray(lines) || lines.length < 2) {
    errors.push("L'écriture doit contenir au moins 2 lignes.");
    return { errors, normalizedLines };
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNumber = i + 1;
    const accountId = Number(rawLine.account_id);
    const debit = Number(rawLine.debit ?? 0);
    const credit = Number(rawLine.credit ?? 0);

    if (!isPositiveInteger(accountId)) {
      errors.push(`La ligne ${lineNumber} doit avoir un 'account_id' valide.`);
      continue;
    }

    if (!isNonNegativeNumber(debit)) {
      errors.push(`La ligne ${lineNumber} a un débit invalide.`);
      continue;
    }

    if (!isNonNegativeNumber(credit)) {
      errors.push(`La ligne ${lineNumber} a un crédit invalide.`);
      continue;
    }

    if (debit === 0 && credit === 0) {
      errors.push(`La ligne ${lineNumber} doit avoir un débit ou un crédit.`);
      continue;
    }

    if (debit > 0 && credit > 0) {
      errors.push(
        `La ligne ${lineNumber} ne peut pas avoir un débit et un crédit en même temps.`
      );
      continue;
    }

    const account = await getAccountById(accountId);

    if (!account) {
      errors.push(`Compte introuvable pour la ligne ${lineNumber}.`);
      continue;
    }

    if (!account.is_active) {
      errors.push(
        `Le compte ${account.account_number} est inactif (ligne ${lineNumber}).`
      );
      continue;
    }

    if (!account.is_postable) {
      errors.push(
        `Le compte ${account.account_number} n'est pas mouvementable (ligne ${lineNumber}).`
      );
      continue;
    }

    const normalizedDebit = roundAmount(debit);
    const normalizedCredit = roundAmount(credit);

    totalDebit += normalizedDebit;
    totalCredit += normalizedCredit;

    normalizedLines.push({
      account_id: accountId,
      line_number: lineNumber,
      description: rawLine.description?.trim() || null,
      debit: normalizedDebit,
      credit: normalizedCredit,
      partner_type: rawLine.partner_type?.trim() || null,
      partner_id: rawLine.partner_id ? Number(rawLine.partner_id) : null
    });
  }

  totalDebit = roundAmount(totalDebit);
  totalCredit = roundAmount(totalCredit);

  if (errors.length === 0 && totalDebit !== totalCredit) {
    errors.push(
      `Écriture non équilibrée : débit=${totalDebit} et crédit=${totalCredit}.`
    );
  }

  return {
    errors,
    normalizedLines,
    totalDebit,
    totalCredit
  };
}

export async function createJournalEntryHandler(req, res, next) {
  try {
    const entry_date =
      req.body.entry_date || new Date().toISOString().split("T")[0];
    const journal_code = req.body.journal_code?.trim();
    const description = req.body.description?.trim();
    const status = req.body.status?.trim() || "draft";
    const fiscal_period_id = req.body.fiscal_period_id
      ? Number(req.body.fiscal_period_id)
      : null;

    if (!journal_code) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'journal_code' est obligatoire."
      });
    }

    if (!description) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'description' est obligatoire."
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'status' est invalide."
      });
    }

    if (status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "La création directe d'une écriture doit se faire en statut 'draft'."
      });
    }

    if (fiscal_period_id !== null && !isPositiveInteger(fiscal_period_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'fiscal_period_id' est invalide."
      });
    }

    const { errors, normalizedLines, totalDebit, totalCredit } =
      await validateLines(req.body.lines);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const entry_number =
      req.body.entry_number?.trim() ||
      (await getNextJournalEntryNumber(journal_code, entry_date));

    const entry = await createJournalEntryWithLines({
      entry_number,
      entry_date,
      journal_code,
      description,
      reference_type: req.body.reference_type?.trim(),
      reference_id: req.body.reference_id ? Number(req.body.reference_id) : null,
      source_module: req.body.source_module?.trim(),
      status: "draft",
      fiscal_period_id,
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      lines: normalizedLines
    });

    return res.status(201).json({
      success: true,
      message: "Écriture comptable créée avec succès.",
      data: {
        ...entry,
        total_debit: totalDebit,
        total_credit: totalCredit
      }
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Le numéro d'écriture existe déjà."
      });
    }

    next(error);
  }
}

export async function getAllJournalEntriesHandler(req, res, next) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;

    if (!isPositiveInteger(limit)) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'limit' doit être un entier positif."
      });
    }

    if (
      req.query.status &&
      !allowedStatuses.includes(String(req.query.status).trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'status' est invalide."
      });
    }

    const rows = await getAllJournalEntries({
      status: req.query.status?.trim() || null,
      journal_code: req.query.journal_code?.trim() || null,
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      limit
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

export async function getJournalEntryByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID écriture invalide."
      });
    }

    const entry = await getJournalEntryById(id);

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Écriture introuvable."
      });
    }

    const totalDebit = roundAmount(
      entry.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
    );

    const totalCredit = roundAmount(
      entry.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0)
    );

    return res.status(200).json({
      success: true,
      data: {
        ...entry,
        total_debit: totalDebit,
        total_credit: totalCredit
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function postJournalEntryHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID écriture invalide."
      });
    }

    const existingEntry = await getJournalEntryById(id);

    if (!existingEntry) {
      return res.status(404).json({
        success: false,
        message: "Écriture introuvable."
      });
    }

    if (existingEntry.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Seule une écriture en brouillon peut être validée."
      });
    }

    const totalDebit = roundAmount(
      existingEntry.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
    );

    const totalCredit = roundAmount(
      existingEntry.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0)
    );

    if (totalDebit !== totalCredit) {
      return res.status(400).json({
        success: false,
        message: "Impossible de valider une écriture non équilibrée."
      });
    }

    const postedEntry = await postJournalEntry(
      id,
      req.body.validated_by ? Number(req.body.validated_by) : null
    );

    if (!postedEntry) {
      return res.status(400).json({
        success: false,
        message: "Validation impossible pour cette écriture."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Écriture validée avec succès.",
      data: postedEntry
    });
  } catch (error) {
    next(error);
  }
}