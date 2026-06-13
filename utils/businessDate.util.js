export function normalizeBusinessDate(
  value,
  fieldLabel,
  { required = false, minYear = 2000, maxYear = 2100 } = {}
) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) {
      return {
        error: `Le champ '${fieldLabel}' est obligatoire.`
      };
    }

    return { value: null };
  }

  const normalized = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return {
      error: `Le champ '${fieldLabel}' doit etre au format YYYY-MM-DD.`
    };
  }

  const [year, month, day] = normalized.split("-").map(Number);

  if (year < minYear || year > maxYear) {
    return {
      error: `Le champ '${fieldLabel}' doit avoir une annee comprise entre ${minYear} et ${maxYear}.`
    };
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return {
      error: `Le champ '${fieldLabel}' contient une date invalide.`
    };
  }

  return { value: normalized };
}
