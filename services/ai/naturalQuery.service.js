function containsAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizePeriod(question) {
  const q = question.toLowerCase();

  if (containsAny(q, ["aujourd", "ce jour", "today"])) {
    return "today";
  }

  if (containsAny(q, ["cette semaine", "semaine", "this week"])) {
    return "this_week";
  }

  if (containsAny(q, ["ce mois", "mois", "this month"])) {
    return "this_month";
  }

  return "current";
}

export function detectIntent(question) {
  const normalizedQuestion = String(question || "").trim().toLowerCase();
  const period = normalizePeriod(normalizedQuestion);

  if (
    containsAny(normalizedQuestion, [
      "reapprovision",
      "réapprovision",
      "rupture",
      "stock critique",
      "stock faible",
      "restock",
      "reappro",
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
      "rentabilite",
      "rentable",
      "rentables",
      "marge brute",
      "marge nette",
      "produit profitable",
      "produits profitables",
      "profitabilite",
      "profitability"
    ])
  ) {
    return {
      intent: "profitability_analysis",
      period,
      confidence: 0.91
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "clients me doivent",
      "client risque",
      "clients risques",
      "clients risqués",
      "impaye",
      "impayé",
      "impayes",
      "impayés",
      "creance",
      "recouvrer",
      "recouvrement",
      "relancer",
      "créance",
      "debiteur",
      "débiteur"
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
      "depense",
      "dépense",
      "charges",
      "couts",
      "coûts",
      "reduire les couts",
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
      "achat",
      "achats",
      "fournisseur",
      "fournisseurs",
      "approvisionnement",
      "commande d'achat",
      "commande d achat",
      "facture fournisseur",
      "dettes fournisseurs",
      "dettes fournisseur"
    ])
  ) {
    return {
      intent: "procurement_overview",
      period,
      confidence: 0.87
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "production",
      "batch",
      "fabrication",
      "rendement",
      "recette",
      "matiere premiere",
      "matière première",
      "matieres premieres",
      "matières premières"
    ])
  ) {
    return {
      intent: "production_performance",
      period,
      confidence: 0.86
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "budget",
      "realise",
      "réalisé",
      "vs reel",
      "vs réel",
      "ecart budget",
      "écart budget",
      "depassement budget",
      "dépassement budget"
    ])
  ) {
    return {
      intent: "budget_vs_actual_analysis",
      period,
      confidence: 0.88
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "prevision",
      "prévision",
      "projection",
      "projeter",
      "forecast",
      "scenario",
      "scénario",
      "plan de tresorerie",
      "plan de trésorerie",
      "predire",
      "prédire"
    ])
  ) {
    return {
      intent: "forecast_projection",
      period,
      confidence: 0.88
    };
  }

  if (
    containsAny(normalizedQuestion, [
      "tresorerie",
      "trésorerie",
      "cash",
      "encaissement",
      "liquidite",
      "liquidité"
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
      "comptabilite",
      "comptabilité",
      "journal",
      "balance",
      "bilan",
      "resultat",
      "résultat",
      "reporting",
      "reporting comptable",
      "etat financier",
      "état financier",
      "compte de resultat",
      "compte de résultat",
      "grand livre",
      "ecriture",
      "écriture"
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
      "pourquoi les ventes ont baisse",
      "pourquoi les ventes ont baissé",
      "pourquoi les ventes baissent",
      "baisse des ventes",
      "ventes ont baisse",
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
