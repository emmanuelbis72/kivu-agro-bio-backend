import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

import healthRoutes from "./routes/health.routes.js";
import productRoutes from "./routes/product.routes.js";
import warehouseRoutes from "./routes/warehouse.routes.js";
import stockRoutes from "./routes/stock.routes.js";
import customerRoutes from "./routes/customer.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import invoicePdfRoutes from "./routes/invoicePdf.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import expenseRoutes from "./routes/expense.routes.js";
import accountRoutes from "./routes/account.routes.js";
import journalEntryRoutes from "./routes/journalEntry.routes.js";
import accountingReportRoutes from "./routes/accountingReport.routes.js";
import accountingSettingsRoutes from "./routes/accountingSettings.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import aiScoringRoutes from "./routes/aiScoring.routes.js";
import kabotRoutes from "./routes/kabot.routes.js";
import companyKnowledgeRoutes from "./routes/companyKnowledge.routes.js";
import productionRoutes from "./routes/production.routes.js";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
    credentials: true
  })
);

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Bienvenue sur l'API de gestion KIVU AGRO BIO"
  });
});

app.use("/api/health", healthRoutes);
app.use("/api/products", productRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/invoices", invoicePdfRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/journal-entries", journalEntryRoutes);
app.use("/api/accounting-reports", accountingReportRoutes);
app.use("/api/accounting-settings", accountingSettingsRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/ai-scoring", aiScoringRoutes);
app.use("/api/kabot", kabotRoutes);
app.use("/api/company-knowledge", companyKnowledgeRoutes);
app.use("/api/production", productionRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;