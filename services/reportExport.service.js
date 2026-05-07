import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

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
  if (!value) {
    return "-";
  }

  const normalized = String(value).trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  return new Intl.DateTimeFormat("fr-FR").format(date);
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "export";
}

function normalizeSheetName(value) {
  const raw = String(value || "Feuille")
    .replace(/[\\/*?:[\]]/g, " ")
    .trim();

  return raw.slice(0, 31) || "Feuille";
}

function extractCellValue(row, column) {
  if (typeof column.value === "function") {
    return column.value(row);
  }

  return row?.[column.key];
}

function buildRowsForColumns(rows, columns) {
  return rows.map((row) =>
    columns.map((column) => extractCellValue(row, column))
  );
}

function formatValueForPdf(value, type) {
  if (type === "money") {
    return formatMoney(value);
  }

  if (type === "date") {
    return formatDate(value);
  }

  if (type === "integer") {
    return Number(value || 0);
  }

  if (type === "number") {
    return roundAmount(value);
  }

  if (type === "boolean") {
    return value ? "Oui" : "Non";
  }

  return value ?? "-";
}

function addPdfHeader(doc, title, subtitle) {
  const pageWidth = doc.page.width;

  doc.info.Title = title;
  doc.info.Author = "KIVU AGRO BIO";
  doc.info.Subject = subtitle || title;

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#166534");
  doc.text("KIVU AGRO BIO", 40, 34);

  doc.font("Helvetica").fontSize(10).fillColor("#4B5563");
  doc.text(subtitle || title, 40, 58);

  doc
    .roundedRect(pageWidth - 220, 30, 175, 58, 10)
    .fillAndStroke("#F0FDF4", "#BBF7D0");

  doc.fillColor("#166534").font("Helvetica-Bold").fontSize(14);
  doc.text(title.toUpperCase(), pageWidth - 200, 50, {
    width: 140,
    align: "left"
  });

  doc.font("Helvetica").fontSize(9).fillColor("#111827");
  doc.text(
    `Genere le ${new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date())}`,
    pageWidth - 200,
    68,
    {
      width: 140,
      align: "left"
    }
  );
}

function drawPdfMetaLines(doc, lines, startX, startY, maxWidth) {
  let currentY = startY;

  lines.forEach((line) => {
    doc.font("Helvetica").fontSize(9).fillColor("#374151");
    doc.text(line, startX, currentY, {
      width: maxWidth
    });
    currentY += 14;
  });

  return currentY;
}

function drawPdfSummaryBlock(doc, items, startY) {
  if (!Array.isArray(items) || items.length === 0) {
    return startY;
  }

  const startX = 40;
  const blockWidth = doc.page.width - 80;
  const columns = 2;
  const columnWidth = blockWidth / columns;
  const rowHeight = 34;
  const rows = Math.ceil(items.length / columns);
  const blockHeight = rows * rowHeight + 16;

  doc
    .roundedRect(startX, startY, blockWidth, blockHeight, 10)
    .fillAndStroke("#F9FAFB", "#E5E7EB");

  items.forEach((item, index) => {
    const columnIndex = index % columns;
    const rowIndex = Math.floor(index / columns);
    const x = startX + columnIndex * columnWidth + 12;
    const y = startY + 10 + rowIndex * rowHeight;

    doc.font("Helvetica").fontSize(8).fillColor("#6B7280");
    doc.text(String(item.label || "-"), x, y, {
      width: columnWidth - 24
    });

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
    doc.text(String(item.value || "-"), x, y + 12, {
      width: columnWidth - 24
    });
  });

  return startY + blockHeight + 18;
}

function computePdfRowHeight(doc, columns, values, fontSize = 9) {
  const minHeight = 22;
  let rowHeight = minHeight;

  columns.forEach((column, index) => {
    const cellValue = String(values[index] ?? "-");
    const height = doc.heightOfString(cellValue, {
      width: column.width - 10,
      align: column.align || "left"
    });

    rowHeight = Math.max(rowHeight, Math.ceil(height + 8));
  });

  return rowHeight;
}

function drawPdfTableRow(doc, columns, values, y, options = {}) {
  const startX = 40;
  const rowHeight = options.rowHeight || 24;
  const isHeader = Boolean(options.isHeader);
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  let currentX = startX;

  if (isHeader) {
    doc
      .save()
      .roundedRect(startX, y - 3, totalWidth, rowHeight, 6)
      .fill("#EAF5EE")
      .restore();
  }

  columns.forEach((column, index) => {
    doc
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .fontSize(isHeader ? 9 : 8.5)
      .fillColor("#1F2937")
      .text(String(values[index] ?? "-"), currentX + 5, y + 4, {
        width: column.width - 10,
        align: column.align || "left"
      });

    currentX += column.width;
  });

  doc
    .moveTo(startX, y + rowHeight)
    .lineTo(startX + totalWidth, y + rowHeight)
    .strokeColor("#E5E7EB")
    .stroke();

  return y + rowHeight;
}

function drawPdfTable(doc, title, columns, rows, startY) {
  let currentY = startY;

  if (title) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
    doc.text(title, 40, currentY);
    currentY += 18;
  }

  const headerValues = columns.map((column) => column.header);
  currentY = drawPdfTableRow(doc, columns, headerValues, currentY, {
    isHeader: true,
    rowHeight: 24
  });

  for (const rowValues of rows) {
    const rowHeight = computePdfRowHeight(doc, columns, rowValues);

    if (currentY + rowHeight > doc.page.height - 55) {
      doc.addPage();
      currentY = 42;

      if (title) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
        doc.text(title, 40, currentY);
        currentY += 18;
      }

      currentY = drawPdfTableRow(doc, columns, headerValues, currentY, {
        isHeader: true,
        rowHeight: 24
      });
    }

    currentY = drawPdfTableRow(doc, columns, rowValues, currentY, {
      rowHeight
    });
  }

  return currentY + 14;
}

function addWorksheetHeader(worksheet, title, subtitle, generatedLabel) {
  worksheet.mergeCells("A1:F1");
  worksheet.getCell("A1").value = title;
  worksheet.getCell("A1").font = {
    name: "Calibri",
    size: 16,
    bold: true,
    color: { argb: "166534" }
  };

  worksheet.mergeCells("A2:F2");
  worksheet.getCell("A2").value = subtitle;
  worksheet.getCell("A2").font = {
    name: "Calibri",
    size: 10,
    color: { argb: "4B5563" }
  };

  worksheet.mergeCells("A3:F3");
  worksheet.getCell("A3").value = generatedLabel;
  worksheet.getCell("A3").font = {
    name: "Calibri",
    size: 9,
    color: { argb: "6B7280" }
  };
}

function applyWorksheetHeaderStyle(row) {
  row.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: "FFFFFF" }
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "166534" }
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true
    };
    cell.border = {
      top: { style: "thin", color: { argb: "D1D5DB" } },
      left: { style: "thin", color: { argb: "D1D5DB" } },
      bottom: { style: "thin", color: { argb: "D1D5DB" } },
      right: { style: "thin", color: { argb: "D1D5DB" } }
    };
  });
}

function applyBodyRowStyle(row) {
  row.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "E5E7EB" } },
      left: { style: "thin", color: { argb: "E5E7EB" } },
      bottom: { style: "thin", color: { argb: "E5E7EB" } },
      right: { style: "thin", color: { argb: "E5E7EB" } }
    };
    cell.alignment = {
      vertical: "top",
      wrapText: true
    };
  });
}

function applyColumnNumberFormat(cell, type) {
  if (type === "money") {
    cell.numFmt = '#,##0.00 "USD"';
    cell.alignment = {
      vertical: "top",
      horizontal: "right"
    };
    return;
  }

  if (type === "number") {
    cell.numFmt = "#,##0.00";
    cell.alignment = {
      vertical: "top",
      horizontal: "right"
    };
    return;
  }

  if (type === "integer") {
    cell.numFmt = "#,##0";
    cell.alignment = {
      vertical: "top",
      horizontal: "right"
    };
    return;
  }

  cell.alignment = {
    vertical: "top",
    wrapText: true
  };
}

function addSummaryWorksheetSection(worksheet, summaryItems, startRow = 5) {
  let currentRow = startRow;

  worksheet.getCell(`A${currentRow}`).value = "Synthese";
  worksheet.getCell(`A${currentRow}`).font = {
    name: "Calibri",
    size: 12,
    bold: true,
    color: { argb: "111827" }
  };
  currentRow += 1;

  summaryItems.forEach((item) => {
    worksheet.getCell(`A${currentRow}`).value = item.label;
    worksheet.getCell(`A${currentRow}`).font = {
      name: "Calibri",
      size: 10,
      bold: true
    };
    worksheet.getCell(`B${currentRow}`).value = item.rawValue ?? item.value;
    if (item.type === "money") {
      worksheet.getCell(`B${currentRow}`).numFmt = '#,##0.00 "USD"';
    } else if (item.type === "number") {
      worksheet.getCell(`B${currentRow}`).numFmt = "#,##0.00";
    } else if (item.type === "integer") {
      worksheet.getCell(`B${currentRow}`).numFmt = "#,##0";
    }
    currentRow += 1;
  });

  return currentRow + 1;
}

function addWorksheetTable(
  worksheet,
  {
    title,
    startRow = 5,
    headers = [],
    rows = [],
    columnTypes = [],
    columnWidths = []
  }
) {
  let currentRow = startRow;

  if (title) {
    worksheet.getCell(`A${currentRow}`).value = title;
    worksheet.getCell(`A${currentRow}`).font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: "111827" }
    };
    currentRow += 1;
  }

  const headerRow = worksheet.getRow(currentRow);
  headers.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  applyWorksheetHeaderStyle(headerRow);
  headerRow.height = 22;
  currentRow += 1;

  rows.forEach((rowValues) => {
    const row = worksheet.addRow(rowValues);
    applyBodyRowStyle(row);

    columnTypes.forEach((type, index) => {
      applyColumnNumberFormat(row.getCell(index + 1), type);
    });
  });

  if (columnWidths.length > 0) {
    worksheet.columns = columnWidths.map((width) => ({ width }));
  }

  return currentRow + rows.length + 1;
}

function finalizeWorksheetLayout(worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 6 }];
  worksheet.properties.defaultRowHeight = 18;
}

async function buildWorkbookBuffer(workbook) {
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

export function sendDownloadBuffer(res, buffer, filename, contentType) {
  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`
  );
  res.setHeader("Content-Length", buffer.length);
  res.status(200).send(buffer);
}

export async function createTabularReportPdfBuffer(reportDefinition, reportData, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: reportDefinition.pdfLayout || "landscape",
      margin: 40
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    addPdfHeader(doc, reportDefinition.title, reportDefinition.subtitle);

    const metadataLines = [];
    const filters = reportData.filters || {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        metadataLines.push(`${key}: ${value}`);
      }
    });

    let currentY = 104;

    if (metadataLines.length > 0) {
      currentY = drawPdfMetaLines(
        doc,
        metadataLines,
        40,
        currentY,
        doc.page.width - 80
      );
      currentY += 8;
    }

    currentY = drawPdfSummaryBlock(
      doc,
      reportDefinition.summaryItems(reportData.summary || {}),
      currentY
    );

    const rows = (reportData.rows || []).map((row) =>
      reportDefinition.columns.map((column) =>
        formatValueForPdf(extractCellValue(row, column), column.type)
      )
    );
    currentY = drawPdfTable(
      doc,
      reportDefinition.tableTitle || reportDefinition.title,
      reportDefinition.columns,
      rows,
      currentY
    );

    if (currentY < doc.page.height - 40) {
      doc.font("Helvetica").fontSize(8).fillColor("#6B7280");
      doc.text("KIVU AGRO BIO - Export automatique", 40, doc.page.height - 38, {
        width: doc.page.width - 80,
        align: "center"
      });
    }

    doc.end();
  });
}

export async function createTabularReportXlsxBuffer(reportDefinition, reportData, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KIVU AGRO BIO";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(normalizeSheetName(reportDefinition.title));
  const generatedLabel = `Genere le ${new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date())}`;

  addWorksheetHeader(
    worksheet,
    reportDefinition.title,
    reportDefinition.subtitle,
    generatedLabel
  );

  let currentRow = addSummaryWorksheetSection(
    worksheet,
    reportDefinition.summaryItems(reportData.summary || {}),
    5
  );

  const filters = reportData.filters || {};
  const filterEntries = Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );

  if (filterEntries.length > 0) {
    worksheet.getCell(`A${currentRow}`).value = "Filtres";
    worksheet.getCell(`A${currentRow}`).font = {
      name: "Calibri",
      size: 12,
      bold: true
    };
    currentRow += 1;

    filterEntries.forEach(([key, value]) => {
      worksheet.getCell(`A${currentRow}`).value = key;
      worksheet.getCell(`A${currentRow}`).font = {
        name: "Calibri",
        size: 10,
        bold: true
      };
      worksheet.getCell(`B${currentRow}`).value = String(value);
      currentRow += 1;
    });

    currentRow += 1;
  }

  worksheet.getCell(`A${currentRow}`).value =
    reportDefinition.tableTitle || reportDefinition.title;
  worksheet.getCell(`A${currentRow}`).font = {
    name: "Calibri",
    size: 12,
    bold: true
  };
  currentRow += 1;

  const headerRowIndex = currentRow;
  const headerRow = worksheet.getRow(headerRowIndex);
  reportDefinition.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
  });
  applyWorksheetHeaderStyle(headerRow);
  headerRow.height = 22;

  const rows = reportData.rows || [];

  rows.forEach((rowData) => {
    const rowValues = reportDefinition.columns.map((column) =>
      extractCellValue(rowData, column)
    );
    const row = worksheet.addRow(rowValues);
    applyBodyRowStyle(row);

    reportDefinition.columns.forEach((column, index) => {
      applyColumnNumberFormat(row.getCell(index + 1), column.type);
    });
  });

  worksheet.columns = reportDefinition.columns.map((column) => ({
    width: column.xlsxWidth || 18
  }));

  finalizeWorksheetLayout(worksheet);
  return buildWorkbookBuffer(workbook);
}

export async function createCashForecastPdfBuffer(forecast, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margin: 40
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    addPdfHeader(
      doc,
      "Tresorerie previsionnelle",
      "Projection des encaissements, decaissements et solde a 7, 30 et 60 jours"
    );

    let currentY = 108;
    const summary = forecast.summary || {};
    currentY = drawPdfSummaryBlock(
      doc,
      [
        {
          label: "Base cash observee",
          value: formatMoney(summary.current_cash_base),
          rawValue: summary.current_cash_base,
          type: "money"
        },
        {
          label: "Creances ouvertes",
          value: formatMoney(summary.open_receivables),
          rawValue: summary.open_receivables,
          type: "money"
        },
        {
          label: "Dettes fournisseurs",
          value: formatMoney(summary.open_payables),
          rawValue: summary.open_payables,
          type: "money"
        },
        {
          label: "Creances echues",
          value: formatMoney(summary.overdue_receivables),
          rawValue: summary.overdue_receivables,
          type: "money"
        },
        {
          label: "Dettes echues",
          value: formatMoney(summary.overdue_payables),
          rawValue: summary.overdue_payables,
          type: "money"
        }
      ],
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Horizons de projection",
      [
        { header: "Horizon", width: 90, align: "left" },
        { header: "Encaissements", width: 120, align: "right" },
        { header: "Nb", width: 50, align: "right" },
        { header: "Decaissements", width: 120, align: "right" },
        { header: "Nb", width: 50, align: "right" },
        { header: "Solde projete", width: 120, align: "right" }
      ],
      (forecast.horizons || []).map((row) => [
        `J+${row.horizon_days}`,
        formatMoney(row.expected_inflows),
        Number(row.due_receivables_count || 0),
        formatMoney(row.expected_outflows),
        Number(row.due_payables_count || 0),
        formatMoney(row.projected_balance)
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Encaissements attendus",
      [
        { header: "Piece", width: 90, align: "left" },
        { header: "Client", width: 150, align: "left" },
        { header: "Echeance", width: 72, align: "left" },
        { header: "Jours", width: 45, align: "right" },
        { header: "Solde", width: 90, align: "right" }
      ],
      (forecast.receivables || []).map((row) => [
        row.invoice_number,
        row.customer_name,
        formatDate(row.due_date),
        Number(row.days_from_today || 0),
        formatMoney(row.balance_due)
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Decaissements a planifier",
      [
        { header: "Piece", width: 90, align: "left" },
        { header: "Fournisseur", width: 150, align: "left" },
        { header: "Echeance", width: 72, align: "left" },
        { header: "Jours", width: 45, align: "right" },
        { header: "Solde", width: 90, align: "right" }
      ],
      (forecast.payables || []).map((row) => [
        row.purchase_invoice_number,
        row.supplier_name,
        formatDate(row.due_date),
        Number(row.days_from_today || 0),
        formatMoney(row.balance_due)
      ]),
      currentY
    );

    doc.end();
  });
}

export async function createCashForecastXlsxBuffer(forecast, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KIVU AGRO BIO";
  workbook.created = new Date();
  workbook.modified = new Date();

  const generatedLabel = `Genere le ${new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date())}`;

  const summarySheet = workbook.addWorksheet("Synthese");
  addWorksheetHeader(
    summarySheet,
    "Tresorerie previsionnelle",
    "Projection des encaissements et decaissements",
    generatedLabel
  );

  let currentRow = addSummaryWorksheetSection(
    summarySheet,
    [
      {
        label: "Base cash observee",
        value: formatMoney(forecast.summary?.current_cash_base),
        rawValue: forecast.summary?.current_cash_base,
        type: "money"
      },
      {
        label: "Creances ouvertes",
        value: formatMoney(forecast.summary?.open_receivables),
        rawValue: forecast.summary?.open_receivables,
        type: "money"
      },
      {
        label: "Dettes ouvertes",
        value: formatMoney(forecast.summary?.open_payables),
        rawValue: forecast.summary?.open_payables,
        type: "money"
      },
      {
        label: "Creances echues",
        value: formatMoney(forecast.summary?.overdue_receivables),
        rawValue: forecast.summary?.overdue_receivables,
        type: "money"
      },
      {
        label: "Dettes echues",
        value: formatMoney(forecast.summary?.overdue_payables),
        rawValue: forecast.summary?.overdue_payables,
        type: "money"
      }
    ],
    5
  );

  summarySheet.getCell(`A${currentRow}`).value = "Horizons";
  summarySheet.getCell(`A${currentRow}`).font = {
    name: "Calibri",
    size: 12,
    bold: true
  };
  currentRow += 1;

  const horizonHeader = summarySheet.getRow(currentRow);
  ["Horizon", "Encaissements", "Nb encaissements", "Decaissements", "Nb decaissements", "Solde projete"].forEach(
    (header, index) => {
      horizonHeader.getCell(index + 1).value = header;
    }
  );
  applyWorksheetHeaderStyle(horizonHeader);
  currentRow += 1;

  (forecast.horizons || []).forEach((row) => {
    const addedRow = summarySheet.addRow([
      `J+${row.horizon_days}`,
      row.expected_inflows,
      Number(row.due_receivables_count || 0),
      row.expected_outflows,
      Number(row.due_payables_count || 0),
      row.projected_balance
    ]);
    applyBodyRowStyle(addedRow);
    [2, 4, 6].forEach((index) => {
      applyColumnNumberFormat(addedRow.getCell(index), "money");
    });
    [3, 5].forEach((index) => {
      applyColumnNumberFormat(addedRow.getCell(index), "integer");
    });
  });

  summarySheet.columns = [
    { width: 15 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 }
  ];
  finalizeWorksheetLayout(summarySheet);

  const receivablesSheet = workbook.addWorksheet("Encaissements");
  addWorksheetHeader(
    receivablesSheet,
    "Encaissements attendus",
    "Factures clients ouvertes a recouvrer",
    generatedLabel
  );
  const receivableHeader = receivablesSheet.getRow(5);
  ["Facture", "Client", "Ville", "Date facture", "Echeance", "Jours", "Solde du"].forEach(
    (header, index) => {
      receivableHeader.getCell(index + 1).value = header;
    }
  );
  applyWorksheetHeaderStyle(receivableHeader);

  (forecast.receivables || []).forEach((row) => {
    const addedRow = receivablesSheet.addRow([
      row.invoice_number,
      row.customer_name,
      row.customer_city || "",
      formatDate(row.invoice_date),
      formatDate(row.due_date),
      Number(row.days_from_today || 0),
      row.balance_due
    ]);
    applyBodyRowStyle(addedRow);
    applyColumnNumberFormat(addedRow.getCell(6), "integer");
    applyColumnNumberFormat(addedRow.getCell(7), "money");
  });
  receivablesSheet.columns = [
    { width: 18 },
    { width: 28 },
    { width: 16 },
    { width: 15 },
    { width: 15 },
    { width: 10 },
    { width: 16 }
  ];
  finalizeWorksheetLayout(receivablesSheet);

  const payablesSheet = workbook.addWorksheet("Decaissements");
  addWorksheetHeader(
    payablesSheet,
    "Decaissements a planifier",
    "Factures fournisseurs ouvertes a regler",
    generatedLabel
  );
  const payableHeader = payablesSheet.getRow(5);
  ["Facture", "Fournisseur", "Ville", "Date facture", "Echeance", "Jours", "Solde du"].forEach(
    (header, index) => {
      payableHeader.getCell(index + 1).value = header;
    }
  );
  applyWorksheetHeaderStyle(payableHeader);

  (forecast.payables || []).forEach((row) => {
    const addedRow = payablesSheet.addRow([
      row.purchase_invoice_number,
      row.supplier_name,
      row.supplier_city || "",
      formatDate(row.invoice_date),
      formatDate(row.due_date),
      Number(row.days_from_today || 0),
      row.balance_due
    ]);
    applyBodyRowStyle(addedRow);
    applyColumnNumberFormat(addedRow.getCell(6), "integer");
    applyColumnNumberFormat(addedRow.getCell(7), "money");
  });
  payablesSheet.columns = [
    { width: 18 },
    { width: 28 },
    { width: 16 },
    { width: 15 },
    { width: 15 },
    { width: 10 },
    { width: 16 }
  ];
  finalizeWorksheetLayout(payablesSheet);

  return buildWorkbookBuffer(workbook);
}

function buildStatementSummaryItems(statement, type) {
  if (type === "supplier") {
    return [
      {
        label: "Total achats",
        value: formatMoney(statement.summary?.total_purchased),
        rawValue: statement.summary?.total_purchased,
        type: "money"
      },
      {
        label: "Total paye",
        value: formatMoney(statement.summary?.total_paid),
        rawValue: statement.summary?.total_paid,
        type: "money"
      },
      {
        label: "Solde du",
        value: formatMoney(statement.summary?.balance_due),
        rawValue: statement.summary?.balance_due,
        type: "money"
      },
      {
        label: "Echeances en retard",
        value: formatMoney(statement.summary?.overdue_balance),
        rawValue: statement.summary?.overdue_balance,
        type: "money"
      }
    ];
  }

  return [
    {
      label: "Total facture",
      value: formatMoney(statement.summary?.total_invoiced),
      rawValue: statement.summary?.total_invoiced,
      type: "money"
    },
    {
      label: "Total paye",
      value: formatMoney(statement.summary?.total_paid),
      rawValue: statement.summary?.total_paid,
      type: "money"
    },
    {
      label: "Solde du",
      value: formatMoney(statement.summary?.balance_due),
      rawValue: statement.summary?.balance_due,
      type: "money"
    },
    {
      label: "Echeances en retard",
      value: formatMoney(statement.summary?.overdue_balance),
      rawValue: statement.summary?.overdue_balance,
      type: "money"
    }
  ];
}

async function createAccountStatementPdfBuffer(statement, options = {}) {
  const isSupplier = options.type === "supplier";
  const entity = isSupplier ? statement.supplier : statement.customer;
  const title = isSupplier
    ? "Etat de compte fournisseur"
    : "Etat de compte client";
  const subtitle = isSupplier
    ? `Compte courant de ${entity?.business_name || "fournisseur"}`
    : `Compte courant de ${entity?.business_name || "client"}`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    addPdfHeader(doc, title, subtitle);

    const metaLines = [
      `${isSupplier ? "Fournisseur" : "Client"}: ${entity?.business_name || "-"}`,
      `Ville: ${entity?.city || "-"}`,
      `Telephone: ${entity?.phone || "-"}`,
      isSupplier
        ? `Compte fournisseur: ${
            entity?.payable_account_number
              ? `${entity.payable_account_number} - ${entity.payable_account_name}`
              : "-"
          }`
        : `Compte client: ${
            entity?.receivable_account_number
              ? `${entity.receivable_account_number} - ${entity.receivable_account_name}`
              : "-"
          }`
    ];

    let currentY = drawPdfMetaLines(
      doc,
      metaLines,
      40,
      104,
      doc.page.width - 80
    );
    currentY += 8;

    currentY = drawPdfSummaryBlock(
      doc,
      buildStatementSummaryItems(statement, isSupplier ? "supplier" : "customer"),
      currentY
    );

    const tableColumns = [
      { header: "Date", width: 74, align: "left" },
      { header: "Type", width: 85, align: "left" },
      { header: "Piece", width: 100, align: "left" },
      { header: "Libelle", width: 240, align: "left" },
      { header: "Debit", width: 90, align: "right" },
      { header: "Credit", width: 90, align: "right" },
      { header: "Solde", width: 90, align: "right" }
    ];

    currentY = drawPdfTable(
      doc,
      "Mouvements",
      tableColumns,
      (statement.movements || []).map((movement) => [
        formatDate(movement.movement_date),
        movement.movement_label || "-",
        movement.reference || "-",
        movement.description || "-",
        formatMoney(movement.debit),
        formatMoney(movement.credit),
        formatMoney(movement.running_balance)
      ]),
      currentY
    );

    doc.end();
  });
}

export function createCustomerAccountStatementPdfBuffer(statement) {
  return createAccountStatementPdfBuffer(statement, { type: "customer" });
}

export function createSupplierAccountStatementPdfBuffer(statement) {
  return createAccountStatementPdfBuffer(statement, { type: "supplier" });
}

function formatChecklistStatus(status) {
  if (status === "done") {
    return "OK";
  }

  if (status === "critical") {
    return "Critique";
  }

  return "Attention";
}

export async function createBudgetVsActualPdfBuffer(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    addPdfHeader(
      doc,
      "Budget vs realise",
      `${report.budget?.name || "Budget"} - ${report.budget?.fiscal_year || ""}`
    );

    const metaLines = [
      `Budget: ${report.budget?.name || "-"}`,
      `Annee: ${report.budget?.fiscal_year || "-"}`,
      `Depot: ${report.budget?.warehouse_name || "Global"}`,
      `Statut: ${report.budget?.is_active ? "Actif" : "Inactif"}`,
      `Notes: ${report.budget?.notes || "-"}`,
      report.budget?.scope_note || ""
    ].filter(Boolean);

    let currentY = drawPdfMetaLines(
      doc,
      metaLines,
      40,
      104,
      doc.page.width - 80
    );
    currentY += 8;

    currentY = drawPdfSummaryBlock(
      doc,
      [
        {
          label: "Budget annuel",
          value: formatMoney(report.summary?.total_planned),
          rawValue: report.summary?.total_planned,
          type: "money"
        },
        {
          label: "Realise annuel",
          value: formatMoney(report.summary?.total_actual),
          rawValue: report.summary?.total_actual,
          type: "money"
        },
        {
          label: "Ecart",
          value: formatMoney(report.summary?.total_variance),
          rawValue: report.summary?.total_variance,
          type: "money"
        },
        {
          label: "Taux d'atteinte",
          value: `${Number(report.summary?.attainment_percent || 0).toFixed(2)} %`,
          rawValue: report.summary?.attainment_percent,
          type: "number"
        }
      ],
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Synthese par categorie",
      [
        { header: "Categorie", width: 180, align: "left" },
        { header: "Type", width: 90, align: "left" },
        { header: "Budget", width: 95, align: "right" },
        { header: "Realise", width: 95, align: "right" },
        { header: "Ecart", width: 95, align: "right" },
        { header: "Atteinte %", width: 80, align: "right" }
      ],
      (report.rows || []).map((row) => [
        row.category_label,
        row.category_type,
        formatMoney(row.planned_total),
        formatMoney(row.actual_total),
        formatMoney(row.variance_total),
        `${Number(row.attainment_percent || 0).toFixed(2)} %`
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Synthese mensuelle",
      [
        { header: "Mois", width: 120, align: "left" },
        { header: "Budget", width: 95, align: "right" },
        { header: "Realise", width: 95, align: "right" },
        { header: "Ecart", width: 95, align: "right" }
      ],
      (report.month_rows || []).map((row) => [
        row.month_label,
        formatMoney(row.planned_total),
        formatMoney(row.actual_total),
        formatMoney(row.variance_total)
      ]),
      currentY
    );

    doc.end();
  });
}

export async function createBudgetVsActualXlsxBuffer(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KIVU AGRO BIO";
  workbook.created = new Date();
  workbook.modified = new Date();

  const generatedLabel = `Genere le ${new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date())}`;

  const summarySheet = workbook.addWorksheet("Synthese");
  addWorksheetHeader(
    summarySheet,
    "Budget vs realise",
    `${report.budget?.name || "Budget"} - ${report.budget?.fiscal_year || ""}`,
    generatedLabel
  );

  let currentRow = addSummaryWorksheetSection(
    summarySheet,
    [
      {
        label: "Budget annuel",
        value: formatMoney(report.summary?.total_planned),
        rawValue: report.summary?.total_planned,
        type: "money"
      },
      {
        label: "Realise annuel",
        value: formatMoney(report.summary?.total_actual),
        rawValue: report.summary?.total_actual,
        type: "money"
      },
      {
        label: "Ecart",
        value: formatMoney(report.summary?.total_variance),
        rawValue: report.summary?.total_variance,
        type: "money"
      },
      {
        label: "Taux d'atteinte",
        value: Number(report.summary?.attainment_percent || 0),
        rawValue: report.summary?.attainment_percent,
        type: "number"
      }
    ],
    5
  );

  currentRow = addWorksheetTable(summarySheet, {
    title: "Synthese par categorie",
    startRow: currentRow,
    headers: [
      "Categorie",
      "Type",
      "Budget annuel",
      "Realise annuel",
      "Ecart",
      "Atteinte %"
    ],
    rows: (report.rows || []).map((row) => [
      row.category_label,
      row.category_type,
      row.planned_total,
      row.actual_total,
      row.variance_total,
      Number(row.attainment_percent || 0)
    ]),
    columnTypes: ["text", "text", "money", "money", "money", "number"],
    columnWidths: [26, 16, 18, 18, 18, 14]
  });

  addWorksheetTable(summarySheet, {
    title: "Synthese mensuelle",
    startRow: currentRow,
    headers: ["Mois", "Budget", "Realise", "Ecart"],
    rows: (report.month_rows || []).map((row) => [
      row.month_label,
      row.planned_total,
      row.actual_total,
      row.variance_total
    ]),
    columnTypes: ["text", "money", "money", "money"],
    columnWidths: [18, 18, 18, 18]
  });
  finalizeWorksheetLayout(summarySheet);

  const budgetDetailSheet = workbook.addWorksheet("Budget detail");
  addWorksheetHeader(
    budgetDetailSheet,
    "Budget detail",
    "Montants planifies par categorie et par mois",
    generatedLabel
  );
  const monthHeaders = (report.month_rows || []).map(
    (row) => row.month_label || `M${row.month_number}`
  );
  addWorksheetTable(budgetDetailSheet, {
    title: "Montants planifies",
    startRow: 5,
    headers: [
      "Categorie",
      "Type",
      ...monthHeaders,
      "Total budget"
    ],
    rows: (report.rows || []).map((row) => [
      row.category_label,
      row.category_type,
      ...(report.month_rows || []).map(
        (monthRow) => row.planned_by_month?.[monthRow.month_number] || 0
      ),
      row.planned_total
    ]),
    columnTypes: [
      "text",
      "text",
      ...monthHeaders.map(() => "money"),
      "money"
    ],
    columnWidths: [26, 16, ...monthHeaders.map(() => 14), 18]
  });
  finalizeWorksheetLayout(budgetDetailSheet);

  const actualDetailSheet = workbook.addWorksheet("Realise detail");
  addWorksheetHeader(
    actualDetailSheet,
    "Realise detail",
    "Montants realises par categorie et par mois",
    generatedLabel
  );
  addWorksheetTable(actualDetailSheet, {
    title: "Montants realises",
    startRow: 5,
    headers: [
      "Categorie",
      "Type",
      ...monthHeaders,
      "Total realise",
      "Ecart"
    ],
    rows: (report.rows || []).map((row) => [
      row.category_label,
      row.category_type,
      ...(report.month_rows || []).map(
        (monthRow) => row.actual_by_month?.[monthRow.month_number] || 0
      ),
      row.actual_total,
      row.variance_total
    ]),
    columnTypes: [
      "text",
      "text",
      ...monthHeaders.map(() => "money"),
      "money",
      "money"
    ],
    columnWidths: [26, 16, ...monthHeaders.map(() => 14), 18, 18]
  });
  finalizeWorksheetLayout(actualDetailSheet);

  return buildWorkbookBuffer(workbook);
}

export async function createMonthlyClosePackPdfBuffer(pack) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 40
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    addPdfHeader(
      doc,
      "Pack de cloture mensuelle",
      `Direction & compta - ${pack.period?.label || ""}`
    );

    const metaLines = [
      `Periode: ${pack.period?.label || "-"} (${formatDate(
        pack.period?.start_date
      )} au ${formatDate(pack.period?.end_date)})`,
      `Genere le: ${formatDate(pack.period?.generated_at)}`,
      pack.period?.scope_note || ""
    ].filter(Boolean);

    let currentY = drawPdfMetaLines(
      doc,
      metaLines,
      40,
      104,
      doc.page.width - 80
    );
    currentY += 8;

    currentY = drawPdfSummaryBlock(
      doc,
      [
        {
          label: "Ventes du mois",
          value: formatMoney(pack.executive_summary?.period_sales_amount),
          rawValue: pack.executive_summary?.period_sales_amount,
          type: "money"
        },
        {
          label: "Encaissements du mois",
          value: formatMoney(pack.executive_summary?.period_collections_amount),
          rawValue: pack.executive_summary?.period_collections_amount,
          type: "money"
        },
        {
          label: "Profit brut du mois",
          value: formatMoney(pack.executive_summary?.period_gross_profit_amount),
          rawValue: pack.executive_summary?.period_gross_profit_amount,
          type: "money"
        },
        {
          label: "Resultat net comptable",
          value: formatMoney(pack.executive_summary?.accounting_net_result),
          rawValue: pack.executive_summary?.accounting_net_result,
          type: "money"
        },
        {
          label: "Creances a la cloture",
          value: formatMoney(pack.executive_summary?.receivables_at_close),
          rawValue: pack.executive_summary?.receivables_at_close,
          type: "money"
        },
        {
          label: "Dettes a la cloture",
          value: formatMoney(pack.executive_summary?.payables_at_close),
          rawValue: pack.executive_summary?.payables_at_close,
          type: "money"
        },
        {
          label: "Base cash a la cloture",
          value: formatMoney(pack.executive_summary?.cash_base_at_close),
          rawValue: pack.executive_summary?.cash_base_at_close,
          type: "money"
        },
        {
          label: "Projection cash J+30",
          value: formatMoney(pack.executive_summary?.projected_cash_30d),
          rawValue: pack.executive_summary?.projected_cash_30d,
          type: "money"
        }
      ],
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Checklist de cloture",
      [
        { header: "Controle", width: 260, align: "left" },
        { header: "Statut", width: 80, align: "left" },
        { header: "Detail", width: 360, align: "left" }
      ],
      (pack.close_checklist?.items || []).map((item) => [
        item.label,
        formatChecklistStatus(item.status),
        item.detail
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Synthese comptable",
      [
        { header: "Indicateur", width: 250, align: "left" },
        { header: "Valeur", width: 120, align: "right" }
      ],
      [
        ["Ecritures du mois", Number(pack.accounting_snapshot?.total_entries || 0)],
        ["Ecritures postees", Number(pack.accounting_snapshot?.posted_entries || 0)],
        ["Ecritures brouillon", Number(pack.accounting_snapshot?.draft_entries || 0)],
        ["Ecritures annulees", Number(pack.accounting_snapshot?.cancelled_entries || 0)],
        [
          "Ecritures desequilibrees",
          Number(pack.accounting_snapshot?.imbalanced_entries || 0)
        ],
        [
          "Total produits comptables",
          formatMoney(pack.income_statement?.totals?.total_revenue)
        ],
        [
          "Total charges comptables",
          formatMoney(pack.income_statement?.totals?.total_expense)
        ],
        ["Actif total", formatMoney(pack.balance_sheet?.totals?.total_assets)],
        [
          "Passif + capitaux propres",
          formatMoney(pack.balance_sheet?.totals?.total_liabilities_and_equity)
        ],
        ["Ecart bilan", formatMoney(pack.balance_sheet?.totals?.gap)]
      ],
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Horizons de tresorerie",
      [
        { header: "Horizon", width: 80, align: "left" },
        { header: "Encaissements", width: 110, align: "right" },
        { header: "Nb enc.", width: 70, align: "right" },
        { header: "Decaissements", width: 110, align: "right" },
        { header: "Nb dec.", width: 70, align: "right" },
        { header: "Solde projete", width: 120, align: "right" }
      ],
      (pack.cash_projection?.horizons || []).map((row) => [
        `J+${row.horizon_days}`,
        formatMoney(row.expected_inflows),
        Number(row.due_receivables_count || 0),
        formatMoney(row.expected_outflows),
        Number(row.due_payables_count || 0),
        formatMoney(row.projected_balance)
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Top clients du mois",
      [
        { header: "Client", width: 220, align: "left" },
        { header: "Ville", width: 90, align: "left" },
        { header: "Fact.", width: 60, align: "right" },
        { header: "Facture", width: 95, align: "right" },
        { header: "Paye", width: 95, align: "right" },
        { header: "Solde", width: 95, align: "right" }
      ],
      (pack.top_customers || []).map((row) => [
        row.business_name,
        row.city || "-",
        Number(row.total_invoices || 0),
        formatMoney(row.total_billed),
        formatMoney(row.total_paid),
        formatMoney(row.total_balance_due)
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Top produits du mois",
      [
        { header: "Produit", width: 260, align: "left" },
        { header: "Qte", width: 70, align: "right" },
        { header: "CA", width: 95, align: "right" },
        { header: "Cout", width: 95, align: "right" },
        { header: "Profit brut", width: 110, align: "right" }
      ],
      (pack.top_products || []).map((row) => [
        row.product_name,
        Number(row.total_quantity_sold || 0),
        formatMoney(row.total_sales_value),
        formatMoney(row.total_cogs_amount),
        formatMoney(row.gross_profit_amount)
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Creances dues ou en retard",
      [
        { header: "Facture", width: 100, align: "left" },
        { header: "Client", width: 220, align: "left" },
        { header: "Echeance", width: 80, align: "left" },
        { header: "Jours", width: 60, align: "right" },
        { header: "Solde", width: 100, align: "right" }
      ],
      (pack.cash_projection?.receivables_due || []).map((row) => [
        row.invoice_number,
        row.customer_name,
        formatDate(row.due_date),
        Number(row.days_from_cutoff || 0),
        formatMoney(row.balance_due)
      ]),
      currentY
    );

    currentY = drawPdfTable(
      doc,
      "Dettes dues ou en retard",
      [
        { header: "Facture", width: 100, align: "left" },
        { header: "Fournisseur", width: 220, align: "left" },
        { header: "Echeance", width: 80, align: "left" },
        { header: "Jours", width: 60, align: "right" },
        { header: "Solde", width: 100, align: "right" }
      ],
      (pack.cash_projection?.payables_due || []).map((row) => [
        row.purchase_invoice_number,
        row.supplier_name,
        formatDate(row.due_date),
        Number(row.days_from_cutoff || 0),
        formatMoney(row.balance_due)
      ]),
      currentY
    );

    doc.end();
  });
}

export async function createMonthlyClosePackXlsxBuffer(pack) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KIVU AGRO BIO";
  workbook.created = new Date();
  workbook.modified = new Date();

  const generatedLabel = `Genere le ${new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date())}`;

  const summarySheet = workbook.addWorksheet("Synthese");
  addWorksheetHeader(
    summarySheet,
    "Pack de cloture mensuelle",
    `Direction & compta - ${pack.period?.label || ""}`,
    generatedLabel
  );

  let currentRow = addSummaryWorksheetSection(
    summarySheet,
    [
      {
        label: "Ventes du mois",
        value: formatMoney(pack.executive_summary?.period_sales_amount),
        rawValue: pack.executive_summary?.period_sales_amount,
        type: "money"
      },
      {
        label: "Encaissements du mois",
        value: formatMoney(pack.executive_summary?.period_collections_amount),
        rawValue: pack.executive_summary?.period_collections_amount,
        type: "money"
      },
      {
        label: "Profit brut du mois",
        value: formatMoney(pack.executive_summary?.period_gross_profit_amount),
        rawValue: pack.executive_summary?.period_gross_profit_amount,
        type: "money"
      },
      {
        label: "Resultat net comptable",
        value: formatMoney(pack.executive_summary?.accounting_net_result),
        rawValue: pack.executive_summary?.accounting_net_result,
        type: "money"
      },
      {
        label: "Creances a la cloture",
        value: formatMoney(pack.executive_summary?.receivables_at_close),
        rawValue: pack.executive_summary?.receivables_at_close,
        type: "money"
      },
      {
        label: "Dettes a la cloture",
        value: formatMoney(pack.executive_summary?.payables_at_close),
        rawValue: pack.executive_summary?.payables_at_close,
        type: "money"
      },
      {
        label: "Base cash a la cloture",
        value: formatMoney(pack.executive_summary?.cash_base_at_close),
        rawValue: pack.executive_summary?.cash_base_at_close,
        type: "money"
      },
      {
        label: "Projection cash J+30",
        value: formatMoney(pack.executive_summary?.projected_cash_30d),
        rawValue: pack.executive_summary?.projected_cash_30d,
        type: "money"
      }
    ],
    5
  );

  currentRow = addWorksheetTable(summarySheet, {
    title: "Synthese comptable",
    startRow: currentRow,
    headers: ["Indicateur", "Valeur"],
    rows: [
      ["Ecritures du mois", Number(pack.accounting_snapshot?.total_entries || 0)],
      ["Ecritures postees", Number(pack.accounting_snapshot?.posted_entries || 0)],
      ["Ecritures brouillon", Number(pack.accounting_snapshot?.draft_entries || 0)],
      ["Ecritures annulees", Number(pack.accounting_snapshot?.cancelled_entries || 0)],
      [
        "Ecritures desequilibrees",
        Number(pack.accounting_snapshot?.imbalanced_entries || 0)
      ],
      ["Total produits comptables", pack.income_statement?.totals?.total_revenue || 0],
      ["Total charges comptables", pack.income_statement?.totals?.total_expense || 0],
      ["Resultat net", pack.income_statement?.totals?.net_result || 0],
      ["Actif total", pack.balance_sheet?.totals?.total_assets || 0],
      [
        "Passif + capitaux propres",
        pack.balance_sheet?.totals?.total_liabilities_and_equity || 0
      ],
      ["Ecart bilan", pack.balance_sheet?.totals?.gap || 0]
    ],
    columnTypes: ["text", "money"],
    columnWidths: [34, 20]
  });

  addWorksheetTable(summarySheet, {
    title: "Compte de resultat - comptes majeurs",
    startRow: currentRow,
    headers: ["Type", "Compte", "Libelle", "Montant net"],
    rows: [
      ...(pack.income_statement?.top_revenue_accounts || []).map((row) => [
        "Produit",
        row.account_number,
        row.account_name,
        row.net_amount
      ]),
      ...(pack.income_statement?.top_expense_accounts || []).map((row) => [
        "Charge",
        row.account_number,
        row.account_name,
        row.net_amount
      ])
    ],
    columnTypes: ["text", "text", "text", "money"],
    columnWidths: [16, 14, 34, 18]
  });
  finalizeWorksheetLayout(summarySheet);

  const checklistSheet = workbook.addWorksheet("Checklist");
  addWorksheetHeader(
    checklistSheet,
    "Checklist de cloture",
    pack.period?.label || "",
    generatedLabel
  );
  addWorksheetTable(checklistSheet, {
    title: "Controles",
    startRow: 5,
    headers: ["Controle", "Statut", "Detail"],
    rows: (pack.close_checklist?.items || []).map((item) => [
      item.label,
      formatChecklistStatus(item.status),
      item.detail
    ]),
    columnTypes: ["text", "text", "text"],
    columnWidths: [40, 14, 70]
  });
  finalizeWorksheetLayout(checklistSheet);

  const horizonsSheet = workbook.addWorksheet("Tresorerie");
  addWorksheetHeader(
    horizonsSheet,
    "Tresorerie de cloture",
    `Coupe au ${formatDate(pack.period?.end_date)}`,
    generatedLabel
  );
  let horizonRow = addWorksheetTable(horizonsSheet, {
    title: "Horizons",
    startRow: 5,
    headers: [
      "Horizon",
      "Encaissements",
      "Nb encaissements",
      "Decaissements",
      "Nb decaissements",
      "Solde projete"
    ],
    rows: (pack.cash_projection?.horizons || []).map((row) => [
      `J+${row.horizon_days}`,
      row.expected_inflows,
      Number(row.due_receivables_count || 0),
      row.expected_outflows,
      Number(row.due_payables_count || 0),
      row.projected_balance
    ]),
    columnTypes: ["text", "money", "integer", "money", "integer", "money"],
    columnWidths: [12, 18, 18, 18, 18, 18]
  });

  horizonRow = addWorksheetTable(horizonsSheet, {
    title: "Creances dues ou en retard",
    startRow: horizonRow,
    headers: ["Facture", "Client", "Ville", "Echeance", "Jours", "Solde"],
    rows: (pack.cash_projection?.receivables_due || []).map((row) => [
      row.invoice_number,
      row.customer_name,
      row.customer_city || "",
      formatDate(row.due_date),
      Number(row.days_from_cutoff || 0),
      row.balance_due
    ]),
    columnTypes: ["text", "text", "text", "text", "integer", "money"],
    columnWidths: [16, 30, 18, 14, 10, 16]
  });

  addWorksheetTable(horizonsSheet, {
    title: "Dettes dues ou en retard",
    startRow: horizonRow,
    headers: ["Facture", "Fournisseur", "Ville", "Echeance", "Jours", "Solde"],
    rows: (pack.cash_projection?.payables_due || []).map((row) => [
      row.purchase_invoice_number,
      row.supplier_name,
      row.supplier_city || "",
      formatDate(row.due_date),
      Number(row.days_from_cutoff || 0),
      row.balance_due
    ]),
    columnTypes: ["text", "text", "text", "text", "integer", "money"],
    columnWidths: [16, 30, 18, 14, 10, 16]
  });
  finalizeWorksheetLayout(horizonsSheet);

  const salesSheet = workbook.addWorksheet("Commercial");
  addWorksheetHeader(
    salesSheet,
    "Synthese commerciale du mois",
    pack.period?.label || "",
    generatedLabel
  );
  let salesRow = addWorksheetTable(salesSheet, {
    title: "Top clients",
    startRow: 5,
    headers: ["Client", "Ville", "Factures", "Facture", "Paye", "Solde"],
    rows: (pack.top_customers || []).map((row) => [
      row.business_name,
      row.city || "",
      Number(row.total_invoices || 0),
      row.total_billed,
      row.total_paid,
      row.total_balance_due
    ]),
    columnTypes: ["text", "text", "integer", "money", "money", "money"],
    columnWidths: [30, 16, 12, 16, 16, 16]
  });

  addWorksheetTable(salesSheet, {
    title: "Top produits",
    startRow: salesRow,
    headers: ["Produit", "SKU", "Barcode", "Qte", "CA", "Cout", "Profit brut"],
    rows: (pack.top_products || []).map((row) => [
      row.product_name,
      row.sku || "",
      row.barcode || "",
      row.total_quantity_sold,
      row.total_sales_value,
      row.total_cogs_amount,
      row.gross_profit_amount
    ]),
    columnTypes: ["text", "text", "text", "number", "money", "money", "money"],
    columnWidths: [32, 16, 20, 12, 16, 16, 16]
  });
  finalizeWorksheetLayout(salesSheet);

  const stockSheet = workbook.addWorksheet("Stock");
  addWorksheetHeader(
    stockSheet,
    "Points de vigilance stock",
    "Etat actuel au moment de generation",
    generatedLabel
  );
  let stockRow = addWorksheetTable(stockSheet, {
    title: "Alertes stock",
    startRow: 5,
    headers: ["Depot", "Produit", "SKU", "Stock", "Seuil", "Unite"],
    rows: (pack.stock_alerts || []).map((row) => [
      row.warehouse_name,
      row.product_name,
      row.sku || "",
      Number(row.quantity || 0),
      Number(row.alert_threshold || 0),
      row.unit || ""
    ]),
    columnTypes: ["text", "text", "text", "number", "number", "text"],
    columnWidths: [20, 30, 16, 12, 12, 12]
  });

  addWorksheetTable(stockSheet, {
    title: "Faible rotation",
    startRow: stockRow,
    headers: ["Produit", "SKU", "Categorie", "Quantite vendue"],
    rows: (pack.low_rotation_products || []).map((row) => [
      row.product_name,
      row.sku || "",
      row.category || "",
      Number(row.total_quantity_sold || 0)
    ]),
    columnTypes: ["text", "text", "text", "number"],
    columnWidths: [30, 16, 18, 16]
  });
  finalizeWorksheetLayout(stockSheet);

  return buildWorkbookBuffer(workbook);
}

export function buildExportFilename(baseName, extension) {
  return `${sanitizeFilenamePart(baseName)}.${extension}`;
}
