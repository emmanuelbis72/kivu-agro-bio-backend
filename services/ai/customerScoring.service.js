import { pool } from "../../config/db.js";
import {
  isPriorityChannel,
  isPriorityCity
} from "./businessRules.service.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function riskLevel(score) {
  if (score >= 75) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "watch";
  return "low";
}

function deadlineDays(level) {
  if (level === "critical") return 0;
  if (level === "high") return 2;
  if (level === "watch") return 7;
  return 14;
}

function buildRecommendedAction(row, level) {
  const balance = round2(row.total_balance_due);
  const overdue = round2(row.overdue_balance);

  if (balance <= 0) {
    return {
      recommendation: "Aucune relance requise. Maintenir le suivi commercial normal.",
      credit_decision: "Maintenir les conditions de credit actuelles.",
      target_collection_amount: 0,
      first_step: "Verifier le compte lors de la prochaine commande."
    };
  }

  if (level === "critical") {
    return {
      recommendation: `Obtenir aujourd'hui un engagement de paiement sur ${balance} USD, en priorite sur les ${overdue} USD echus.`,
      credit_decision:
        "Suspendre toute nouvelle vente a credit jusqu'a engagement valide par la finance.",
      target_collection_amount: balance,
      first_step: "Appeler le decisionnaire client et confirmer un montant et une date de paiement."
    };
  }

  if (level === "high") {
    return {
      recommendation: `Negocier sous 48 heures un calendrier de paiement couvrant ${balance} USD.`,
      credit_decision:
        "Soumettre toute nouvelle vente a credit a validation de la direction financiere.",
      target_collection_amount: balance,
      first_step: "Envoyer le releve du compte puis appeler le client le meme jour."
    };
  }

  if (level === "watch") {
    return {
      recommendation: `Planifier une relance cette semaine sur le solde de ${balance} USD.`,
      credit_decision: "Maintenir le credit dans la limite actuelle, sans augmentation.",
      target_collection_amount: overdue > 0 ? overdue : balance,
      first_step: "Confirmer la reception des factures ouvertes et leur date de paiement."
    };
  }

  return {
    recommendation: `Suivre le solde courant de ${balance} USD jusqu'a son echeance.`,
    credit_decision: "Maintenir les conditions actuelles.",
    target_collection_amount: balance,
    first_step: "Programmer une relance automatique deux jours avant l'echeance."
  };
}

export async function getCustomerScores(businessRules = {}) {
  const result = await pool.query(`
    SELECT
      c.id AS customer_id,
      c.business_name,
      c.city,
      COUNT(i.id) FILTER (
        WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      )::int AS total_invoices,
      COALESCE(SUM(i.total_amount) FILTER (
        WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      ), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount) FILTER (
        WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      ), 0) AS total_paid_amount,
      COALESCE(SUM(i.balance_due) FILTER (
        WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      ), 0) AS total_balance_due,
      COUNT(i.id) FILTER (
        WHERE i.status IN ('issued', 'partial')
          AND COALESCE(i.balance_due, 0) > 0
      )::int AS open_invoices_count,
      COUNT(i.id) FILTER (
        WHERE i.status IN ('issued', 'partial')
          AND COALESCE(i.balance_due, 0) > 0
          AND i.due_date < CURRENT_DATE
      )::int AS overdue_invoices_count,
      COALESCE(SUM(i.balance_due) FILTER (
        WHERE i.status IN ('issued', 'partial')
          AND COALESCE(i.balance_due, 0) > 0
          AND i.due_date < CURRENT_DATE
      ), 0) AS overdue_balance,
      COALESCE(MAX(
        CASE
          WHEN i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
            AND i.due_date < CURRENT_DATE
          THEN CURRENT_DATE - i.due_date
          ELSE 0
        END
      ), 0)::int AS max_days_overdue,
      MAX(i.invoice_date) FILTER (
        WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      ) AS last_invoice_date
    FROM customers c
    LEFT JOIN invoices i ON i.customer_id = c.id
    WHERE c.archived_at IS NULL
    GROUP BY c.id, c.business_name, c.city
    HAVING COUNT(i.id) FILTER (
      WHERE COALESCE(i.status, 'issued') <> 'cancelled'
    ) > 0
    ORDER BY total_balance_due DESC, total_sales_amount DESC;
  `);

  const maximumSales = Math.max(
    1,
    ...result.rows.map((row) => Number(row.total_sales_amount || 0))
  );

  return result.rows
    .map((row) => {
      const sales = Number(row.total_sales_amount || 0);
      const paid = Number(row.total_paid_amount || 0);
      const balance = Number(row.total_balance_due || 0);
      const overdueBalance = Number(row.overdue_balance || 0);
      const maxDaysOverdue = Number(row.max_days_overdue || 0);
      const paymentRatio = sales > 0 ? paid / sales : 1;
      const exposureRatio = sales > 0 ? balance / sales : 0;
      const overdueShare = balance > 0 ? overdueBalance / balance : 0;
      const priorityCity = isPriorityCity(row.city, businessRules);
      const priorityChannel = isPriorityChannel(
        row.business_name,
        businessRules
      );

      const exposureScore = Math.min(25, exposureRatio * 35);
      const overdueScore = Math.min(30, maxDaysOverdue * 0.45);
      const overdueShareScore = Math.min(20, overdueShare * 20);
      const paymentBehaviorScore = Math.min(
        20,
        Math.max(0, (1 - paymentRatio) * 20)
      );
      const openInvoiceScore = Math.min(
        5,
        Number(row.overdue_invoices_count || 0)
      );
      const paymentRiskScore = clampScore(
        exposureScore +
          overdueScore +
          overdueShareScore +
          paymentBehaviorScore +
          openInvoiceScore
      );

      const salesWeight = Math.min(70, (sales / maximumSales) * 70);
      const strategicValueScore = clampScore(
        salesWeight + (priorityCity ? 10 : 0) + (priorityChannel ? 20 : 0)
      );
      const collectionPriorityScore =
        balance > 0
          ? clampScore(paymentRiskScore * 0.7 + strategicValueScore * 0.3)
          : 0;
      const level = riskLevel(paymentRiskScore);
      const action = buildRecommendedAction(row, level);

      return {
        customer_id: Number(row.customer_id),
        business_name: row.business_name,
        city: row.city || null,
        total_invoices: Number(row.total_invoices || 0),
        total_sales_amount: round2(sales),
        total_paid_amount: round2(paid),
        total_balance_due: round2(balance),
        open_invoices_count: Number(row.open_invoices_count || 0),
        overdue_invoices_count: Number(row.overdue_invoices_count || 0),
        overdue_balance: round2(overdueBalance),
        max_days_overdue: maxDaysOverdue,
        payment_ratio_percent: round2(paymentRatio * 100),
        exposure_ratio_percent: round2(exposureRatio * 100),
        is_priority_city: priorityCity,
        is_priority_channel: priorityChannel,
        customer_risk_score: paymentRiskScore,
        payment_risk_score: paymentRiskScore,
        customer_value_score: strategicValueScore,
        strategic_value_score: strategicValueScore,
        collection_priority_score: collectionPriorityScore,
        risk_level: level,
        status: level,
        score_breakdown: {
          exposure: round2(exposureScore),
          lateness: round2(overdueScore),
          overdue_share: round2(overdueShareScore),
          payment_behavior: round2(paymentBehaviorScore),
          overdue_invoice_count: round2(openInvoiceScore)
        },
        explanation:
          `Risque ${paymentRiskScore}/100: ${round2(balance)} USD ouverts, ` +
          `${round2(overdueBalance)} USD echus, retard maximum ${maxDaysOverdue} jour(s), ` +
          `taux de paiement ${round2(paymentRatio * 100)} %.`,
        owner_role: "Finance / Recouvrement",
        deadline_days: deadlineDays(level),
        ...action
      };
    })
    .sort(
      (left, right) =>
        right.collection_priority_score - left.collection_priority_score
    );
}
