import {
  createAccount,
  getAllAccounts,
  getAccountById,
  updateAccount,
  deleteAccount
} from "../models/account.model.js";

const allowedAccountTypes = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
  "off_balance"
];

function inferAccountClass(accountNumber) {
  const firstChar = String(accountNumber).trim().charAt(0);

  if (!/^[1-9]$/.test(firstChar)) {
    return null;
  }

  return firstChar;
}

function validateAccountPayload(body) {
  const errors = [];

  if (!body.account_number || String(body.account_number).trim() === "") {
    errors.push("Le champ 'account_number' est obligatoire.");
  }

  if (!body.account_name || String(body.account_name).trim() === "") {
    errors.push("Le champ 'account_name' est obligatoire.");
  }

  if (!body.account_type || String(body.account_type).trim() === "") {
    errors.push("Le champ 'account_type' est obligatoire.");
  }

  if (
    body.account_type &&
    !allowedAccountTypes.includes(String(body.account_type).trim())
  ) {
    errors.push(
      "Le champ 'account_type' doit être : asset, liability, equity, income, expense ou off_balance."
    );
  }

  if (
    body.parent_account_id !== undefined &&
    body.parent_account_id !== null &&
    body.parent_account_id !== "" &&
    (!Number.isInteger(Number(body.parent_account_id)) ||
      Number(body.parent_account_id) <= 0)
  ) {
    errors.push("Le champ 'parent_account_id' doit être un entier positif.");
  }

  return errors;
}

export async function createAccountHandler(req, res, next) {
  try {
    const errors = validateAccountPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const accountNumber = String(req.body.account_number).trim();
    const inferredClass = inferAccountClass(accountNumber);

    if (!inferredClass) {
      return res.status(400).json({
        success: false,
        message:
          "Le numéro de compte doit commencer par une classe valide (1 à 9)."
      });
    }

    const account = await createAccount({
      account_number: accountNumber,
      account_name: String(req.body.account_name).trim(),
      account_class: inferredClass,
      account_type: String(req.body.account_type).trim(),
      parent_account_id:
        req.body.parent_account_id === undefined ||
        req.body.parent_account_id === null ||
        req.body.parent_account_id === ""
          ? null
          : Number(req.body.parent_account_id),
      is_postable:
        req.body.is_postable === undefined
          ? true
          : Boolean(req.body.is_postable),
      is_active:
        req.body.is_active === undefined ? true : Boolean(req.body.is_active),
      ohada_category: req.body.ohada_category?.trim()
    });

    return res.status(201).json({
      success: true,
      message: "Compte comptable créé avec succès.",
      data: account
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllAccountsHandler(req, res, next) {
  try {
    const accounts = await getAllAccounts();

    return res.status(200).json({
      success: true,
      count: accounts.length,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
}

export async function getAccountByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID compte invalide."
      });
    }

    const account = await getAccountById(id);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Compte introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
}

export async function updateAccountHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID compte invalide."
      });
    }

    const existingAccount = await getAccountById(id);

    if (!existingAccount) {
      return res.status(404).json({
        success: false,
        message: "Compte introuvable."
      });
    }

    const mergedPayload = {
      ...existingAccount,
      ...req.body
    };

    const errors = validateAccountPayload(mergedPayload);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const accountNumber = String(mergedPayload.account_number).trim();
    const inferredClass = inferAccountClass(accountNumber);

    if (!inferredClass) {
      return res.status(400).json({
        success: false,
        message:
          "Le numéro de compte doit commencer par une classe valide (1 à 9)."
      });
    }

    const updatedAccount = await updateAccount(id, {
      account_number: accountNumber,
      account_name: String(mergedPayload.account_name).trim(),
      account_class: inferredClass,
      account_type: String(mergedPayload.account_type).trim(),
      parent_account_id:
        mergedPayload.parent_account_id === undefined ||
        mergedPayload.parent_account_id === null ||
        mergedPayload.parent_account_id === ""
          ? null
          : Number(mergedPayload.parent_account_id),
      is_postable:
        mergedPayload.is_postable === undefined
          ? true
          : Boolean(mergedPayload.is_postable),
      is_active:
        mergedPayload.is_active === undefined
          ? true
          : Boolean(mergedPayload.is_active),
      ohada_category: mergedPayload.ohada_category?.trim()
    });

    return res.status(200).json({
      success: true,
      message: "Compte comptable mis à jour avec succès.",
      data: updatedAccount
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteAccountHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID compte invalide."
      });
    }

    const deletedAccount = await deleteAccount(id);

    if (!deletedAccount) {
      return res.status(404).json({
        success: false,
        message: "Compte introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Compte comptable supprimé avec succès.",
      data: deletedAccount
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        message:
          "Impossible de supprimer ce compte car il est lié à d'autres enregistrements."
      });
    }

    next(error);
  }
}