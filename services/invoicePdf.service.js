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
  const startX = options.startX || 36;
  const rowHeight = options.rowHeight || 22;
  const isHeader = Boolean(options.isHeader);
  const fontSize = options.fontSize || 9;
  const verticalPadding = options.verticalPadding || 5;
  const lineGap = options.lineGap || 2;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const alignments = options.alignments || [];

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
        align: alignments[i] || (i >= 2 ? "right" : "left"),
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
  const warehouseName = String(invoice.warehouse_name || "")
    .trim()
    .toLowerCase();

  return [
    invoice.customer_name,
    invoice.customer_address,
    invoice.customer_phone,
    invoice.customer_email
  ]
    .filter(
      (value) =>
        value && String(value).trim() && String(value).trim() !== "-"
    )
    .filter((value, index) => {
      if (index === 0) {
        return true;
      }

      const normalized = String(value).trim().toLowerCase();

      if (warehouseName && normalized === warehouseName) {
        return false;
      }

      if (
        normalized.startsWith("depot ") ||
        normalized.startsWith("dépôt ")
      ) {
        return false;
      }

      return true;
    });
}

export function buildInvoicePdf(doc, invoice) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const marginX = 36;
  const topMargin = 34;
  const bottomLimit = pageHeight - 18;

  doc.info.Title = `Facture ${invoice.invoice_number}`;
  doc.info.Author = "KIVU AGRO BIO";
  doc.info.Subject = "Facture client";

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#166534");
  doc.text("KIVU AGRO BIO", marginX, topMargin);

  doc.font("Helvetica").fontSize(9).fillColor("#4B5563");
  doc.text(
    "Produits naturels de sante et superaliments",
    marginX,
    topMargin + 24
  );

  const badgeWidth = 132;
  const badgeHeight = 34;
  const badgeX = pageWidth - marginX - badgeWidth;

  doc.roundedRect(badgeX, topMargin, badgeWidth, badgeHeight, 8).fillAndStroke(
    "#F0FDF4",
    "#BBF7D0"
  );

  doc.fillColor("#166534").font("Helvetica-Bold").fontSize(10);
  doc.text("FACTURE", badgeX + 10, topMargin + 7);

  doc.fillColor("#111827").font("Helvetica").fontSize(9);
  doc.text(invoice.invoice_number, badgeX + 10, topMargin + 18, {
    width: badgeWidth - 20,
    align: "left"
  });

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  doc.text("Facturé à", marginX, topMargin + 52);

  doc.font("Helvetica").fontSize(9).fillColor("#374151");
  const customerLines = getCustomerLines(invoice);
  let customerY = topMargin + 68;

  customerLines.forEach((line) => {
    doc.text(String(line), marginX, customerY, { width: 240 });
    customerY += 14;
  });

  const infoX = pageWidth - 160;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151");
  doc.text("Date facture", infoX, topMargin + 52, {
    width: 120,
    align: "left"
  });
  doc.font("Helvetica").fontSize(9).fillColor("#111827");
  doc.text(formatDate(invoice.invoice_date), infoX, topMargin + 66, {
    width: 120,
    align: "left"
  });

  let tableY = Math.max(customerY + 10, topMargin + 100);

  const colWidths = [96, 174, 30, 92, 117];
  const tableHeader = ["Barcode", "Produit", "Qte", "Prix unitaire", "Total ligne"];

  tableY = drawTableRow(doc, tableY, tableHeader, colWidths, {
    startX: marginX,
    isHeader: true,
    rowHeight: 24,
    fontSize: 9,
    verticalPadding: 6
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
    const rowHeight = Math.max(
      22,
      Math.ceil(Math.max(barcodeHeight, productHeight) + 8)
    );

    if (tableY + rowHeight > bottomLimit - 44) {
      doc.addPage();
      tableY = 28;
    }

    tableY = drawTableRow(doc, tableY, rowValues, colWidths, {
      startX: marginX,
      rowHeight,
      fontSize: 9,
      verticalPadding: 4
    });
  }

  const requiredBottomSpace = 34;

  if (tableY + requiredBottomSpace > bottomLimit) {
    doc.addPage();
    tableY = 32;
  }

  const summaryY = Math.min(tableY + 12, bottomLimit - 20);
  const summaryX = pageWidth - marginX - 210;
  const summaryW = 210;

  doc
    .moveTo(summaryX, summaryY - 6)
    .lineTo(summaryX + summaryW, summaryY - 6)
    .strokeColor("#D1D5DB")
    .stroke();

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827");
  doc.text("Solde du", summaryX, summaryY, { width: 80 });
  doc.text(formatMoney(invoice.balance_due), summaryX + 80, summaryY, {
    width: summaryW - 80,
    align: "right"
  });
}

export function createInvoicePdfBuffer(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 36
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    buildInvoicePdf(doc, invoice);
    doc.end();
  });
}
