import {
  getAllExpenseCategoryAccounts,
  getAllPaymentMethodAccounts,
  upsertExpenseCategoryAccount,
  upsertPaymentMethodAccount
} from "../models/accountingSettings.model.js";

const allowedPaymentMethods = [
  "cash",
  "mobile_money",
  "bank_transfer",
  "card"
];

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

export async function getAccountingSettingsOverviewHandler(req, res, next) {
  try {
    const [expenseCategoryAccounts, paymentMethodAccounts] = await Promise.all([
      getAllExpenseCategoryAccounts(),
      getAllPaymentMethodAccounts()
    ]);

    return res.status(200).json({
      success: true,
      data: {
        expense_category_accounts: expenseCategoryAccounts,
        payment_method_accounts: paymentMethodAccounts
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function upsertExpenseCategoryAccountHandler(req, res, next) {
  try {
    const category = String(req.body.category || "").trim();
    const expenseAccountId = Number(req.body.expense_account_id);

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'category' est obligatoire."
      });
    }

    if (!isPositiveInteger(expenseAccountId)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'expense_account_id' doit être un entier positif."
      });
    }

    const row = await upsertExpenseCategoryAccount({
      category,
      expense_account_id: expenseAccountId
    });

    return res.status(200).json({
      success: true,
      message: "Paramétrage catégorie de dépense enregistré avec succès.",
      data: row
    });
  } catch (error) {
    next(error);
  }
}

export async function upsertPaymentMethodAccountHandler(req, res, next) {
  try {
    const paymentMethod = String(req.body.payment_method || "").trim();
    const treasuryAccountId = Number(req.body.treasury_account_id);

    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'payment_method' est invalide."
      });
    }

    if (!isPositiveInteger(treasuryAccountId)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'treasury_account_id' doit être un entier positif."
      });
    }

    const row = await upsertPaymentMethodAccount({
      payment_method: paymentMethod,
      treasury_account_id: treasuryAccountId
    });

    return res.status(200).json({
      success: true,
      message: "Paramétrage mode de paiement enregistré avec succès.",
      data: row
    });
  } catch (error) {
    next(error);
  }
}