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

function drawSimpleRow(doc, y, values, widths, options = {}) {
  const startX = 45;
  const rowHeight = options.rowHeight || 22;
  const isHeader = Boolean(options.isHeader);

  let currentX = startX;

  if (isHeader) {
    doc
      .save()
      .roundedRect(
        startX,
        y - 3,
        widths.reduce((a, b) => a + b, 0),
        rowHeight,
        5
      )
      .fill("#EAF5EE")
      .restore();
  }

  for (let i = 0; i < values.length; i += 1) {
    doc
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .fillColor("#1F2937")
      .text(String(values[i] ?? ""), currentX + 5, y + 2, {
        width: widths[i] - 10,
        align: i >= 3 ? "right" : "left"
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

export function buildGeneralLedgerPdf(doc, ledger, filters = {}) {
  const pageWidth = doc.page.width;
  const marginX = 45;

  doc.info.Title = `Grand livre ${ledger.account.account_number}`;
  doc.info.Author = "KIVU AGRO BIO";
  doc.info.Subject = "Grand livre comptable";

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#166534");
  doc.text("KIVU AGRO BIO", marginX, 38);

  doc.font("Helvetica").fontSize(10).fillColor("#4B5563");
  doc.text("Grand livre comptable", marginX, 62);

  doc
    .roundedRect(pageWidth - 220, 36, 175, 54, 10)
    .fillAndStroke("#F0FDF4", "#BBF7D0");

  doc.fillColor("#166534").font("Helvetica-Bold").fontSize(15);
  doc.text("GRAND LIVRE", pageWidth - 195, 52);

  doc.fillColor("#111827").font("Helvetica").fontSize(10);
  doc.text(
    `${ledger.account.account_number} - ${ledger.account.account_name}`,
    marginX,
    108
  );

  doc.font("Helvetica").fontSize(9).fillColor("#374151");
  doc.text(`Période : ${filters.start_date || "-"} au ${filters.end_date || "-"}`, marginX, 126);
  doc.text(`Statut : ${filters.status || "posted"}`, marginX, 140);
  doc.text(`Journal : ${filters.journal_code || "Tous"}`, marginX, 154);

  doc.text(`Solde initial : ${formatMoney(ledger.opening_balance)}`, pageWidth - 230, 126);
  doc.text(`Débit période : ${formatMoney(ledger.period_debit)}`, pageWidth - 230, 140);
  doc.text(`Crédit période : ${formatMoney(ledger.period_credit)}`, pageWidth - 230, 154);
  doc.text(`Solde final : ${formatMoney(ledger.closing_balance)}`, pageWidth - 230, 168);

  let y = 195;
  const widths = [70, 65, 175, 65, 65, 75];

  y = drawSimpleRow(
    doc,
    y,
    ["Date", "Journal", "Libellé", "Débit", "Crédit", "Solde"],
    widths,
    { isHeader: true, rowHeight: 24 }
  );

  for (const line of ledger.lines) {
    if (y > 740) {
      doc.addPage();
      y = 50;
      y = drawSimpleRow(
        doc,
        y,
        ["Date", "Journal", "Libellé", "Débit", "Crédit", "Solde"],
        widths,
        { isHeader: true, rowHeight: 24 }
      );
    }

    const label = line.line_description || line.entry_description || "-";

    y = drawSimpleRow(
      doc,
      y,
      [
        formatDate(line.entry_date),
        line.journal_code,
        label,
        formatMoney(line.debit),
        formatMoney(line.credit),
        formatMoney(line.running_balance)
      ],
      widths
    );
  }

  doc
    .moveTo(marginX, doc.page.height - 60)
    .lineTo(pageWidth - marginX, doc.page.height - 60)
    .strokeColor("#D1D5DB")
    .stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
  doc.text(
    "KIVU AGRO BIO - Grand livre généré automatiquement",
    marginX,
    doc.page.height - 45,
    {
      width: pageWidth - marginX * 2,
      align: "center"
    }
  );
}

export function buildTrialBalancePdf(doc, balance, filters = {}) {
  const pageWidth = doc.page.width;
  const marginX = 35;

  doc.info.Title = "Balance générale";
  doc.info.Author = "KIVU AGRO BIO";
  doc.info.Subject = "Balance générale comptable";

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#166534");
  doc.text("KIVU AGRO BIO", marginX, 34);

  doc.font("Helvetica").fontSize(10).fillColor("#4B5563");
  doc.text("Balance générale comptable", marginX, 58);

  doc
    .roundedRect(pageWidth - 220, 32, 175, 54, 10)
    .fillAndStroke("#F0FDF4", "#BBF7D0");

  doc.fillColor("#166534").font("Helvetica-Bold").fontSize(15);
  doc.text("BALANCE", pageWidth - 185, 50);

  doc.font("Helvetica").fontSize(9).fillColor("#374151");
  doc.text(`Période : ${filters.start_date || "-"} au ${filters.end_date || "-"}`, marginX, 98);
  doc.text(`Statut : ${filters.status || "posted"}`, marginX, 112);

  doc.text(`Total débit : ${formatMoney(balance.totals.total_debit)}`, pageWidth - 220, 98);
  doc.text(`Total crédit : ${formatMoney(balance.totals.total_credit)}`, pageWidth - 220, 112);
  doc.text(`Solde débiteur : ${formatMoney(balance.totals.total_debit_balance)}`, pageWidth - 220, 126);
  doc.text(`Solde créditeur : ${formatMoney(balance.totals.total_credit_balance)}`, pageWidth - 220, 140);

  let y = 165;
  const widths = [60, 150, 45, 70, 70, 80, 80];

  y = drawSimpleRow(
    doc,
    y,
    ["Compte", "Intitulé", "Classe", "Débit", "Crédit", "Solde D", "Solde C"],
    widths,
    { isHeader: true, rowHeight: 24 }
  );

  for (const row of balance.rows) {
    if (y > 740) {
      doc.addPage();
      y = 50;
      y = drawSimpleRow(
        doc,
        y,
        ["Compte", "Intitulé", "Classe", "Débit", "Crédit", "Solde D", "Solde C"],
        widths,
        { isHeader: true, rowHeight: 24 }
      );
    }

    y = drawSimpleRow(
      doc,
      y,
      [
        row.account_number,
        row.account_name,
        row.account_class,
        formatMoney(row.total_debit),
        formatMoney(row.total_credit),
        formatMoney(row.debit_balance),
        formatMoney(row.credit_balance)
      ],
      widths
    );
  }

  doc
    .moveTo(marginX, doc.page.height - 60)
    .lineTo(pageWidth - marginX, doc.page.height - 60)
    .strokeColor("#D1D5DB")
    .stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#6B7280");
  doc.text(
    "KIVU AGRO BIO - Balance générale générée automatiquement",
    marginX,
    doc.page.height - 45,
    {
      width: pageWidth - marginX * 2,
      align: "center"
    }
  );
}

export function createGeneralLedgerPdfBuffer(ledger, filters = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    buildGeneralLedgerPdf(doc, ledger, filters);
    doc.end();
  });
}

export function createTrialBalancePdfBuffer(balance, filters = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 35
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    buildTrialBalancePdf(doc, balance, filters);
    doc.end();
  });
}