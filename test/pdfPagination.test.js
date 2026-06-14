import test from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerAccountStatementPdfBuffer,
  createTabularReportPdfBuffer
} from "../services/reportExport.service.js";
import {
  createGeneralLedgerPdfBuffer,
  createTrialBalancePdfBuffer
} from "../services/accountingPdf.service.js";

function countPdfPages(buffer) {
  return [...buffer.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length;
}

test("tabular report does not append a blank PDF page", async () => {
  const definition = {
    title: "Etat de recouvrement clients",
    subtitle: "Test pagination",
    pdfLayout: "landscape",
    summaryItems: () => [],
    columns: [{ header: "Client", key: "customer_name", width: 220 }]
  };

  const buffer = await createTabularReportPdfBuffer(definition, {
    filters: {},
    summary: {},
    rows: [{ customer_name: "KSC SUPERMARCHE" }]
  });

  assert.equal(countPdfPages(buffer), 1);
});

test("customer account statement does not append a blank PDF page", async () => {
  const buffer = await createCustomerAccountStatementPdfBuffer({
    customer: {
      business_name: "KSC SUPERMARCHE",
      city: "Goma"
    },
    summary: {
      total_invoiced: 100,
      total_paid: 50,
      balance_due: 50
    },
    invoices: [
      {
        invoice_date: "2026-03-01",
        invoice_number: "008/03-2026",
        total_amount: 100
      }
    ],
    payments: [
      {
        payment_date: "2026-03-05",
        reference: "PAIEMENT-TEST",
        amount: 50
      }
    ]
  });

  assert.equal(countPdfPages(buffer), 1);
});

test("accounting reports do not append a blank PDF page", async () => {
  const ledgerBuffer = await createGeneralLedgerPdfBuffer({
    account: {
      account_number: "411100",
      account_name: "Clients"
    },
    opening_balance: 0,
    period_debit: 100,
    period_credit: 50,
    closing_balance: 50,
    lines: [
      {
        entry_date: "2026-03-01",
        journal_code: "VE",
        line_description: "Facture client",
        debit: 100,
        credit: 0,
        running_balance: 100
      }
    ]
  });

  const balanceBuffer = await createTrialBalancePdfBuffer({
    totals: {
      total_debit: 100,
      total_credit: 100,
      total_debit_balance: 0,
      total_credit_balance: 0
    },
    rows: [
      {
        account_number: "411100",
        account_name: "Clients",
        account_class: 4,
        total_debit: 100,
        total_credit: 100,
        debit_balance: 0,
        credit_balance: 0
      }
    ]
  });

  assert.equal(countPdfPages(ledgerBuffer), 1);
  assert.equal(countPdfPages(balanceBuffer), 1);
});
