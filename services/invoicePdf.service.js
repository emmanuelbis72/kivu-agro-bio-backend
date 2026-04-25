import PDFDocument from "pdfkit";

function formatMoney(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD"
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR");
}

function drawTableRow(doc, y, values, widths, options = {}) {
  const startX = 50;
  const rowHeight = options.rowHeight || 24;
  const isHeader = Boolean(options.isHeader);

  let currentX = startX;

  if (isHeader) {
    doc
      .save()
      .roundedRect(startX, y - 4, widths.reduce((a, b) => a + b, 0), rowHeight, 6)
      .fill("#EAF5EE")
      .restore();
  }

  for (let i = 0; i < values.length; i += 1) {
    doc
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10)
      .fillColor("#1F2937")
      .text(String(values[i] ?? ""), currentX + 6, y + 2, {
        width: widths[i] - 12,
        align: i >= 2 ? "right" : "left"
      });

    currentX += widths[i];
  }

  doc
    .moveTo(startX, y + rowHeight)
    .lineTo(startX + widths.reduce((a, b) => a + b, 0), y + rowHeight)
    .strokeColor("#E5E7EB")
    .stroke();

  return y + rowHeight;
}

export function buildInvoicePdf(doc, invoice) {
  const pageWidth = doc.page.width;
  const marginX = 50;

  doc.info.Title = `Facture ${invoice.invoice_number}`;
  doc.info.Author = "KIVU AGRO BIO";
  doc.info.Subject = "Facture client";

  doc.font("Helvetica-Bold").fontSize(22).fillColor("#166534");
  doc.text("KIVU AGRO BIO", marginX, 45);

  doc.font("Helvetica").fontSize(10).fillColor("#4B5563");
  doc.text("Produits naturels de santé & superaliments", marginX, 74);
  doc.text("République Démocratique du Congo", marginX, 88);

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
  doc.text("Facturé à", marginX, 136);

  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  doc.text(invoice.customer_name || "-", marginX, 154);
  doc.text(invoice.customer_address || "-", marginX, 170, { width: 220 });
  doc.text(invoice.customer_phone || "-", marginX, 198);
  doc.text(invoice.customer_email || "-", marginX, 214);

  const infoX = pageWidth - 250;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  doc.text("Informations facture", infoX, 136);

  const infoRows = [
    ["Date facture", formatDate(invoice.invoice_date)]
  ];

  let infoY = 154;
  for (const [label, value] of infoRows) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151");
    doc.text(`${label} :`, infoX, infoY, { continued: true });
    doc.font("Helvetica").fillColor("#111827");
    doc.text(` ${value}`);
    infoY += 18;
  }

  let tableY = 250;

  const colWidths = [135, 195, 55, 75, 90];
  tableY = drawTableRow(
    doc,
    tableY,
    ["Barcode", "Produit", "Qté", "Prix unitaire", "Total ligne"],
    colWidths,
    { isHeader: true, rowHeight: 26 }
  );

  const items = Array.isArray(invoice.items) ? invoice.items : [];

  for (const item of items) {
    if (tableY > 720) {
      doc.addPage();
      tableY = 60;
      tableY = drawTableRow(
        doc,
        tableY,
        ["Barcode", "Produit", "Qté", "Prix unitaire", "Total ligne"],
        colWidths,
        { isHeader: true, rowHeight: 26 }
      );
    }

    tableY = drawTableRow(
      doc,
      tableY,
      [
        item.barcode || "-",
        item.product_name || "-",
        item.quantity ?? "-",
        formatMoney(item.unit_price),
        formatMoney(item.line_total)
      ],
      colWidths,
      { rowHeight: 26 }
    );
  }

  const summaryBoxY = tableY + 24;
  const summaryX = pageWidth - 250;
  const summaryW = 200;

  doc
    .roundedRect(summaryX, summaryBoxY, summaryW, 120, 10)
    .fillAndStroke("#F9FAFB", "#E5E7EB");

  const totals = [
    ["Sous-total", formatMoney(invoice.subtotal)],
    ["Remise", formatMoney(invoice.discount_amount)],
    ["Taxe", formatMoney(invoice.tax_amount)],
    ["Total", formatMoney(invoice.total_amount)],
    ["Payé", formatMoney(invoice.paid_amount)],
    ["Solde dû", formatMoney(invoice.balance_due)]
  ];

  let totalY = summaryBoxY + 12;
  totals.forEach(([label, value], index) => {
    const isStrong = label === "Total" || label === "Solde dû";

    doc.font(isStrong ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#111827");
    doc.text(label, summaryX + 12, totalY, { width: 90 });

    doc
      .font(isStrong ? "Helvetica-Bold" : "Helvetica")
      .text(value, summaryX + 100, totalY, {
        width: 88,
        align: "right"
      });

    totalY += index === 2 ? 22 : 16;
  });

  const noteY = Math.max(summaryBoxY + 140, tableY + 24);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  doc.text("Notes", marginX, noteY);

  doc.font("Helvetica").fontSize(10).fillColor("#4B5563");
  doc.text(invoice.notes || "Merci pour votre confiance.", marginX, noteY + 18, {
    width: pageWidth - marginX * 2
  });

  doc
    .moveTo(marginX, doc.page.height - 70)
    .lineTo(pageWidth - marginX, doc.page.height - 70)
    .strokeColor("#D1D5DB")
    .stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
  doc.text(
    "KIVU AGRO BIO - Facture générée automatiquement",
    marginX,
    doc.page.height - 55,
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
