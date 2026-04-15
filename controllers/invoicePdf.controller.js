import { getInvoiceById } from "../models/invoice.model.js";
import { createInvoicePdfBuffer } from "../services/invoicePdf.service.js";

export async function downloadInvoicePdfHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID facture invalide."
      });
    }

    const invoice = await getInvoiceById(id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    const pdfBuffer = await createInvoicePdfBuffer(invoice);
    const filename = `${invoice.invoice_number}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    return res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
}