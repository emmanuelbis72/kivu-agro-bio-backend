import {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer
} from "../models/customer.model.js";

function validateCustomerPayload(body) {
  const errors = [];

  if (!body.business_name || String(body.business_name).trim() === "") {
    errors.push("Le champ 'business_name' est obligatoire.");
  }

  if (
    body.payment_terms_days !== undefined &&
    (!Number.isInteger(Number(body.payment_terms_days)) ||
      Number(body.payment_terms_days) < 0)
  ) {
    errors.push("Le champ 'payment_terms_days' doit etre un entier >= 0.");
  }

  if (
    body.credit_limit !== undefined &&
    (Number.isNaN(Number(body.credit_limit)) || Number(body.credit_limit) < 0)
  ) {
    errors.push("Le champ 'credit_limit' doit etre un nombre >= 0.");
  }

  if (
    body.receivable_account_id !== undefined &&
    body.receivable_account_id !== null &&
    body.receivable_account_id !== "" &&
    (!Number.isInteger(Number(body.receivable_account_id)) ||
      Number(body.receivable_account_id) <= 0)
  ) {
    errors.push(
      "Le champ 'receivable_account_id' doit etre un entier positif ou nul."
    );
  }

  if (
    body.warehouse_id !== undefined &&
    body.warehouse_id !== null &&
    body.warehouse_id !== "" &&
    (!Number.isInteger(Number(body.warehouse_id)) ||
      Number(body.warehouse_id) <= 0)
  ) {
    errors.push("Le champ 'warehouse_id' doit etre un entier positif ou nul.");
  }

  return errors;
}

export async function createCustomerHandler(req, res, next) {
  try {
    const errors = validateCustomerPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const customer = await createCustomer({
      customer_type: req.body.customer_type?.trim(),
      business_name: req.body.business_name.trim(),
      contact_name: req.body.contact_name?.trim(),
      phone: req.body.phone?.trim(),
      email: req.body.email?.trim(),
      city: req.body.city?.trim(),
      address: req.body.address?.trim(),
      payment_terms_days: Number(req.body.payment_terms_days ?? 0),
      credit_limit: Number(req.body.credit_limit ?? 0),
      notes: req.body.notes?.trim(),
      is_active:
        req.body.is_active === undefined ? true : Boolean(req.body.is_active),
      receivable_account_id:
        req.body.receivable_account_id === undefined ||
        req.body.receivable_account_id === null ||
        req.body.receivable_account_id === ""
          ? null
          : Number(req.body.receivable_account_id),
      warehouse_id:
        req.body.warehouse_id === undefined ||
        req.body.warehouse_id === null ||
        req.body.warehouse_id === ""
          ? null
          : Number(req.body.warehouse_id)
    });

    return res.status(201).json({
      success: true,
      message: "Client cree avec succes.",
      data: customer
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllCustomersHandler(req, res, next) {
  try {
    const customers = await getAllCustomers();

    return res.status(200).json({
      success: true,
      count: customers.length,
      data: customers
    });
  } catch (error) {
    next(error);
  }
}

export async function getCustomerByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID client invalide."
      });
    }

    const customer = await getCustomerById(id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Client introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: customer
    });
  } catch (error) {
    next(error);
  }
}

export async function updateCustomerHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID client invalide."
      });
    }

    const existingCustomer = await getCustomerById(id);

    if (!existingCustomer) {
      return res.status(404).json({
        success: false,
        message: "Client introuvable."
      });
    }

    const mergedPayload = {
      ...existingCustomer,
      ...req.body
    };

    const errors = validateCustomerPayload(mergedPayload);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const updatedCustomer = await updateCustomer(id, {
      customer_type: mergedPayload.customer_type?.trim(),
      business_name: String(mergedPayload.business_name).trim(),
      contact_name: mergedPayload.contact_name?.trim(),
      phone: mergedPayload.phone?.trim(),
      email: mergedPayload.email?.trim(),
      city: mergedPayload.city?.trim(),
      address: mergedPayload.address?.trim(),
      payment_terms_days: Number(mergedPayload.payment_terms_days ?? 0),
      credit_limit: Number(mergedPayload.credit_limit ?? 0),
      notes: mergedPayload.notes?.trim(),
      is_active:
        mergedPayload.is_active === undefined
          ? true
          : Boolean(mergedPayload.is_active),
      receivable_account_id:
        mergedPayload.receivable_account_id === undefined ||
        mergedPayload.receivable_account_id === null ||
        mergedPayload.receivable_account_id === ""
          ? null
          : Number(mergedPayload.receivable_account_id),
      warehouse_id:
        mergedPayload.warehouse_id === undefined ||
        mergedPayload.warehouse_id === null ||
        mergedPayload.warehouse_id === ""
          ? null
          : Number(mergedPayload.warehouse_id)
    });

    return res.status(200).json({
      success: true,
      message: "Client mis a jour avec succes.",
      data: updatedCustomer
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteCustomerHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID client invalide."
      });
    }

    const deletedCustomer = await deleteCustomer(id);

    if (!deletedCustomer) {
      return res.status(404).json({
        success: false,
        message: "Client introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Client supprime avec succes.",
      data: deletedCustomer
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        message: "Impossible de supprimer ce client car il est lie a des factures."
      });
    }

    next(error);
  }
}
