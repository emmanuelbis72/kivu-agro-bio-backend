export function normalizeInvoiceTitle(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length > 160 || /[\r\n\x00-\x1f]/.test(value)) {
    const error = new Error('Le titre facultatif doit être un texte sur une ligne, de 160 caractères maximum.');
    error.statusCode = 400;
    throw error;
  }
  return value.trim() || null;
}
