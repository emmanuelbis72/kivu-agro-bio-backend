import {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier
} from "../models/supplier.model.js";
import { getSupplierAccountStatement } from "../models/purchaseInvoice.model.js";
import {
  buildExportFilename,
  createSupplierAccountStatementPdfBuffer,
  sendDownloadBuffer
} from "../services/reportExport.service.js";

const allowedSupplierTypes = [
  "vendor",
  "service_provider",
  "transporter",
  "landlord",
  "other"
];

function validateSupplierPayload(body) {
  const errors = [];

  if (!body.business_name || String(body.business_name).trim() === "") {
    errors.push("Le champ 'business_name' est obligatoire.");
  }

  if (
    body.supplier_type &&
    !allowedSupplierTypes.includes(String(body.supplier_type).trim())
  ) {
    errors.push(
      "Le champ 'supplier_type' est invalide. Valeurs attendues : vendor, service_provider, transporter, landlord, other."
    );
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
    body.payable_account_id !== undefined &&
    body.payable_account_id !== null &&
    body.payable_account_id !== "" &&
    (!Number.isInteger(Number(body.payable_account_id)) ||
      Number(body.payable_account_id) <= 0)
  ) {
    errors.push(
      "Le champ 'payable_account_id' doit etre un entier positif ou nul."
    );
  }

  return errors;
}

function normalizeSupplierPayload(body) {
  return {
    supplier_type: body.supplier_type?.trim() || "vendor",
    business_name: body.business_name.trim(),
    contact_name: body.contact_name?.trim(),
    phone: body.phone?.trim(),
    email: body.email?.trim(),
    city: body.city?.trim(),
    address: body.address?.trim(),
    payment_terms_days: Number(body.payment_terms_days ?? 0),
    credit_limit: Number(body.credit_limit ?? 0),
    notes: body.notes?.trim(),
    is_active:
      body.is_active === undefined ? true : Boolean(body.is_active),
    payable_account_id:
      body.payable_account_id === undefined ||
      body.payable_account_id === null ||
      body.payable_account_id === ""
        ? null
        : Number(body.payable_account_id)
  };
}

export async function createSupplierHandler(req, res, next) {
  try {
    const errors = validateSupplierPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const supplier = await createSupplier(normalizeSupplierPayload(req.body));

    return res.status(201).json({
      success: true,
      message: "Fournisseur cree avec succes.",
      data: supplier
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Un fournisseur avec ce nom existe deja."
      });
    }

    next(error);
  }
}

export async function getAllSuppliersHandler(req, res, next) {
  try {
    const suppliers = await getAllSuppliers();

    return res.status(200).json({
      success: true,
      count: suppliers.length,
      data: suppliers
    });
  } catch (error) {
    next(error);
  }
}

export async function getSupplierByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID fournisseur invalide."
      });
    }

    const supplier = await getSupplierById(id);

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Fournisseur introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: supplier
    });
  } catch (error) {
    next(error);
  }
}

export async function getSupplierAccountStatementHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID fournisseur invalide."
      });
    }

    const statement = await getSupplierAccountStatement(id);

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Fournisseur introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: statement
    });
  } catch (error) {
    next(error);
  }
}

export async function exportSupplierAccountStatementPdfHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID fournisseur invalide."
      });
    }

    const statement = await getSupplierAccountStatement(id);

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Fournisseur introuvable."
      });
    }

    const buffer = await createSupplierAccountStatementPdfBuffer(statement);
    const filename = buildExportFilename(
      `etat-compte-fournisseur-${statement.supplier?.business_name || id}`,
      "pdf"
    );

    return sendDownloadBuffer(res, buffer, filename, "application/pdf");
  } catch (error) {
    next(error);
  }
}

export async function updateSupplierHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID fournisseur invalide."
      });
    }

    const existingSupplier = await getSupplierById(id);

    if (!existingSupplier) {
      return res.status(404).json({
        success: false,
        message: "Fournisseur introuvable."
      });
    }

    const mergedPayload = {
      ...existingSupplier,
      ...req.body
    };

    const errors = validateSupplierPayload(mergedPayload);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const supplier = await updateSupplier(id, normalizeSupplierPayload(mergedPayload));

    return res.status(200).json({
      success: true,
      message: "Fournisseur mis a jour avec succes.",
      data: supplier
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Un fournisseur avec ce nom existe deja."
      });
    }

    next(error);
  }
}

export async function deleteSupplierHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID fournisseur invalide."
      });
    }

    const deletedSupplier = await deleteSupplier(id);

    if (!deletedSupplier) {
      return res.status(404).json({
        success: false,
        message: "Fournisseur introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Fournisseur supprime avec succes.",
      data: deletedSupplier
    });
  } catch (error) {
    next(error);
  }
}
