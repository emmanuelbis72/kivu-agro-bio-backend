function containsAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizePeriod(question) {
  const q = question.toLowerCase();

  if (
    containsAny(q, [
      "aujourd",
      "ce jour",
      "today"
    ])
  ) {
    return "today";
  }

  if (
    containsAny(q, [
      "cette semaine",
      "semaine",
      "this week"
    ])
  ) {
    return "this_week";
  }

  if (
    containsAny(q, [
      "ce mois",
      "mois",
      "this month"
    ])
  ) {
    return "this_month";
  }

  return "current";
}

export function detectIntent(question) {
  const normalizedQuestion = String(question || "").trim().toLowerCase();
  const period = normalizePeriod(normalizedQuestion);

  if (
    containsAny(normalizedQuestion, [
      "réapprovision",
      "rupture",
      "stock critique",
      "stock faible",
      "restock",
      "réappro"
    ])
  ) {
    return {
      intent: "stock_priority_restock",
      period,
      confidence: 0.9
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "clients me doivent",
      "client risque",
      "clients risqués",
      "impayé",
      "impayes",
      "créance",
      "creance",
      "débiteur",
      "debiteur"
    ])
  ) {
    return {
      intent: "customer_receivables_risk",
      period,
      confidence: 0.88
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "dépense",
      "depense",
      "charges",
      "coûts",
      "couts",
      "réduire les coûts",
      "réduire les couts"
    ])
  ) {
    return {
      intent: "expense_pressure_analysis",
      period,
      confidence: 0.86
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "trésorerie",
      "tresorerie",
      "cash",
      "encaissement",
      "liquidité",
      "liquidite"
    ])
  ) {
    return {
      intent: "cash_position_analysis",
      period,
      confidence: 0.87
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "comptable",
      "comptabilité",
      "comptabilite",
      "journal",
      "balance",
      "bilan",
      "résultat",
      "resultat",
      "reporting",
      "reporting comptable",
      "etat financier",
      "compte de resultat",
      "grand livre",
      "écriture",
      "ecriture"
    ])
  ) {
    return {
      intent: "accounting_summary",
      period,
      confidence: 0.9
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "pourquoi les ventes ont baissé",
      "pourquoi les ventes ont baissé",
      "pourquoi les ventes baissent",
      "baisse des ventes",
      "ventes ont baissé",
      "ventes baissent"
    ])
  ) {
    return {
      intent: "sales_variance_explanation",
      period,
      confidence: 0.9
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "ventes",
      "chiffre d'affaires",
      "chiffre d affaires",
      "ca",
      "revenu commercial"
    ])
  ) {
    return {
      intent: "sales_overview",
      period,
      confidence: 0.85
    };
  }

  return {
    intent: "business_overview",
    period,
    confidence: 0.6
  };
}
