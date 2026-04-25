import PDFDocument from "pdfkit";

function formatMoney(value) {
  const amount = Number(value || 0);
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const fixed = absolute.toFixed(2);
  const [integerPart, decimalPart] = fixed.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${groupedInteger},${decimalPart} $US`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR");
}

function drawTableRow(doc, y, values, widths, options = {}) {
  const startX = 50;
  const rowHeight = options.rowHeight || 24;
  const isHeader = Boolean(options.isHeader);
  const fontSize = options.fontSize || 10;
  const verticalPadding = options.verticalPadding || 6;
  const lineGap = options.lineGap || 2;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  let currentX = startX;

  if (isHeader) {
    doc
      .save()
      .roundedRect(startX, y - 4, totalWidth, rowHeight, 6)
      .fill("#EAF5EE")
      .restore();
  }

  for (let i = 0; i < values.length; i += 1) {
    doc
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .fontSize(fontSize)
      .fillColor("#1F2937")
      .text(String(values[i] ?? ""), currentX + 6, y + verticalPadding - 1, {
        width: widths[i] - 12,
        align: i >= 2 ? "right" : "left",
        lineGap
      });

    currentX += widths[i];
  }

  doc
    .moveTo(startX, y + rowHeight)
    .lineTo(startX + totalWidth, y + rowHeight)
    .strokeColor("#E5E7EB")
    .stroke();

  return y + rowHeight;
}

function getCustomerLines(invoice) {
  return [
    invoice.customer_name,
    invoice.customer_address,
    invoice.customer_phone,
    invoice.customer_email
  ].filter((value) => value && String(value).trim() && String(value).trim() !== "-");
}

export function buildInvoicePdf(doc, invoice) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginX = 50;
  const footerTopY = pageHeight - 70;

  doc.info.Title = `Facture ${invoice.invoice_number}`;
  doc.info.Author = "KIVU AGRO BIO";
  doc.info.Subject = "Facture client";

  doc.font("Helvetica-Bold").fontSize(22).fillColor("#166534");
  doc.text("KIVU AGRO BIO", marginX, 45);

  doc.font("Helvetica").fontSize(10).fillColor("#4B5563");
  doc.text("Produits naturels de sante et superaliments", marginX, 74);
  doc.text("Republique Democratique du Congo", marginX, 88);

  doc
    .roundedRect(pageWidth - 220, 42, 170, 58, 10)
    .fillAndStroke("#F0FDF4", "#BBF7D0");

  doc.fillColor("#166534").font("Helvetica-Bold").fontSize(16);
  doc.text("FACTURE", pageWidth - 195, 58);

  doc.fillColor("#111827").font("Helvetica").fontSize(10);
  doc.text(invoice.invoice_number, pageWidth - 195, 80);

  doc
    .moveTo(marginX, 118)
    .lineTo(pageWidth - marginX, 118)
    .strokeColor("#D1D5DB")
    .stroke();

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  doc.text("Facture a", marginX, 136);

  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  const customerLines = getCustomerLines(invoice);
  let customerY = 154;

  customerLines.forEach((line) => {
    doc.text(String(line), marginX, customerY, { width: 220 });
    customerY += 16;
  });

  const infoX = pageWidth - 250;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  doc.text("Informations facture", infoX, 136);

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151");
  doc.text("Date facture :", infoX, 154, { continued: true });
  doc.font("Helvetica").fillColor("#111827");
  doc.text(` ${formatDate(invoice.invoice_date)}`);

  let tableY = Math.max(customerY + 18, 192);

  const colWidths = [105, 165, 40, 85, 100];
  const tableHeader = ["Barcode", "Produit", "Qte", "Prix unitaire", "Total ligne"];

  tableY = drawTableRow(doc, tableY, tableHeader, colWidths, {
    isHeader: true,
    rowHeight: 26,
    fontSize: 9,
    verticalPadding: 7
  });

  const items = Array.isArray(invoice.items) ? invoice.items : [];

  for (const item of items) {
    const rowValues = [
      item.barcode || "-",
      item.product_name || "-",
      item.quantity ?? "-",
      formatMoney(item.unit_price),
      formatMoney(item.line_total)
    ];

    const barcodeHeight = doc.heightOfString(String(rowValues[0]), {
      width: colWidths[0] - 12,
      lineGap: 2
    });
    const productHeight = doc.heightOfString(String(rowValues[1]), {
      width: colWidths[1] - 12,
      lineGap: 2
    });
    const rowHeight = Math.max(24, Math.ceil(Math.max(barcodeHeight, productHeight) + 10));

    if (tableY + rowHeight > 690) {
      doc.addPage();
      tableY = 60;
      tableY = drawTableRow(doc, tableY, tableHeader, colWidths, {
        isHeader: true,
        rowHeight: 26,
        fontSize: 9,
        verticalPadding: 7
      });
    }

    tableY = drawTableRow(doc, tableY, rowValues, colWidths, {
      rowHeight,
      fontSize: 9,
      verticalPadding: 5
    });
  }

  const noteText = invoice.notes || "Merci pour votre confiance.";
  const noteHeight = doc.heightOfString(noteText, {
    width: pageWidth - marginX * 2,
    lineGap: 2
  });
  const requiredBottomSpace = 24 + 52 + 20 + 18 + noteHeight + 24;

  if (tableY + requiredBottomSpace > footerTopY - 12) {
    doc.addPage();
    tableY = 60;
  }

  const summaryBoxY = tableY + 24;
  const summaryX = pageWidth - 250;
  const summaryW = 200;

  doc
    .roundedRect(summaryX, summaryBoxY, summaryW, 52, 10)
    .fillAndStroke("#F9FAFB", "#E5E7EB");

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827");
  doc.text("Solde du", summaryX + 12, summaryBoxY + 17, { width: 90 });
  doc.text(formatMoney(invoice.balance_due), summaryX + 92, summaryBoxY + 17, {
    width: 96,
    align: "right"
  });

  const noteY = Math.max(summaryBoxY + 72, tableY + 24);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  doc.text("Notes", marginX, noteY);

  doc.font("Helvetica").fontSize(10).fillColor("#4B5563");
  doc.text(noteText, marginX, noteY + 18, {
    width: pageWidth - marginX * 2
  });

  doc
    .moveTo(marginX, footerTopY)
    .lineTo(pageWidth - marginX, footerTopY)
    .strokeColor("#D1D5DB")
    .stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
  doc.text(
    "KIVU AGRO BIO - Facture generee automatiquement",
    marginX,
    pageHeight - 55,
    {
      width: pageWidth - marginX * 2,
      align: "center"
    }
  );
}

export function createInvoicePdfBuffer(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    buildInvoicePdf(doc, invoice);
    doc.end();
  });
}
