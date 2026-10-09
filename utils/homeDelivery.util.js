import { normalizeBusinessDate } from './businessDate.util.js';

export function deliveryError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
export function roundDelivery(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function money(value, label, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' ||
      !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 9999999999) {
    throw deliveryError(`${label} doit être un montant positif ou nul.`);
  }
  return roundDelivery(value);
}
function text(value, max = 500) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw deliveryError('Texte invalide ou trop long.');
  return value.trim();
}
export function normalizeDeliveryDay(body, { historical = false } = {}) {
  const date = normalizeBusinessDate(body.delivery_date, 'date de livraison', { required: true });
  if (date.error) throw deliveryError(date.error);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lubumbashi', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  if (date.value > today) throw deliveryError('La date de vente ne peut pas être dans le futur.');
  for (const key of ['customer_id','warehouse_id']) {
    if (!Number.isInteger(Number(body[key])) || Number(body[key]) <= 0) throw deliveryError(`Le champ ${key} est obligatoire.`);
  }
  if (!['sales','net_result'].includes(body.split_basis || 'sales')) throw deliveryError('Base de répartition invalide.');
  if (!['courier','kab','shared'].includes(body.fees_recipient || 'courier')) throw deliveryError('Bénéficiaire des frais invalide.');
  if (!Array.isArray(body.sales) || !body.sales.length || body.sales.length > 500) throw deliveryError('Ajoutez au moins une livraison.');
  if (!Array.isArray(body.expenses ?? []) || (body.expenses || []).length > 200) throw deliveryError('Dépenses invalides.');
  if (body.apply_stock !== undefined && typeof body.apply_stock !== 'boolean') throw deliveryError('Option de stock invalide.');
  const sales = body.sales.map((sale) => {
    if (!Array.isArray(sale.items) || sale.items.length > 100) throw deliveryError('Lignes de produits invalides.');
    const items = sale.items.map((item) => {
      const product_id = item.product_id ? Number(item.product_id) : null;
      if (product_id !== null && (!Number.isInteger(product_id) || product_id <= 0)) throw deliveryError('Produit invalide.');
      const quantity = money(item.quantity, 'Quantité', historical);
      const unit_price = money(item.unit_price, 'Prix unitaire', historical);
      if ((!historical && !product_id) || (quantity !== null && quantity <= 0)) throw deliveryError('Chaque produit doit avoir une quantité positive.');
      return { product_id, description: text(item.description, 250), quantity, unit_price,
        confidence: historical ? item.confidence || 'confirmation' : 'entered',
        stated_line_amount: historical ? money(item.stated_line_amount, 'Prix cité', true) : null,
        source_line: historical ? item.source_line || null : null,
        line_total: quantity !== null && unit_price !== null ? roundDelivery(quantity * unit_price) : null };
    });
    if (!historical && !items.length) throw deliveryError('Chaque livraison doit contenir au moins un produit.');
    const amount = historical ? money(sale.amount, 'Vente', true) : roundDelivery(items.reduce((s,i)=>s+i.line_total,0));
    return { ...sale, label: text(sale.label, 250) || 'Livraison', items, amount,
      extra_amount_cdf: historical ? money(sale.extra_amount_cdf, 'Complément de vente FC', true) : null,
      currency: ['USD','CDF'].includes(sale.currency || 'USD') ? sale.currency || 'USD' : (()=>{throw deliveryError('Devise invalide.');})(),
      fee_usd: money(sale.fee_usd, 'Frais de livraison USD', true), fee_cdf: money(sale.fee_cdf, 'Frais de livraison FC', true) };
  });
  const expenses = (body.expenses || []).map(e=>({category: ['transport','other'].includes(e.category) ? e.category : 'other',
    label: text(e.label,250) || 'Autre dépense', amount: money(e.amount, 'Dépense'),
    currency: ['USD','CDF'].includes(e.currency || 'USD') ? e.currency || 'USD' : (()=>{throw deliveryError('Devise invalide.');})()}));
  const courier_name = text(body.courier_name,160);
  if (!courier_name) throw deliveryError('Le nom du livreur est obligatoire.');
  return { customer_id:Number(body.customer_id), warehouse_id:Number(body.warehouse_id), delivery_date:date.value, courier_name,
    split_basis:body.split_basis || 'sales', fees_recipient:body.fees_recipient || 'courier', sales, expenses,
    notes:text(body.notes,4000), apply_stock:!historical && body.apply_stock === true };
}

// USD and CDF remain separate: an undocumented exchange rate must never change a ledger.
export function calculateDeliveryDay(day) {
  const totals = {};
  for (const currency of ['USD','CDF']) {
    const sales = roundDelivery((day.sales || []).reduce((sum,s)=>sum+((s.currency || 'USD')===currency?Number(s.amount || 0):0)+
      (currency==='CDF'?Number(s.extra_amount_cdf || 0):0),0));
    const fees = roundDelivery((day.sales || []).reduce((sum,s)=>sum+Number(s[currency==='USD'?'fee_usd':'fee_cdf'] || 0),0));
    const expenses = roundDelivery((day.expenses || []).filter(e=>(e.currency || 'USD')===currency).reduce((sum,e)=>sum+Number(e.amount || 0),0));
    const sharedFees = day.fees_recipient==='shared' ? fees : 0;
    const splitBase = roundDelivery(sales + sharedFees - (day.split_basis==='net_result' ? expenses : 0));
    const commission = roundDelivery(splitBase * 0.15);
    const kab = roundDelivery(splitBase - commission - (day.split_basis!=='net_result' ? expenses : 0) + (day.fees_recipient==='kab' ? fees : 0));
    totals[currency] = { sales,fees,expenses,split_base:splitBase,commission,kab,courier:roundDelivery(commission+(day.fees_recipient==='courier'?fees:0)) };
  }
  const reported = day.reported || {};
  return { ...day, totals, delivery_count:(day.sales || []).filter(s=>!['aggregate','undocumented'].includes(s.source_kind)).length,
    aggregate_sales:(day.sales || []).filter(s=>['aggregate','undocumented'].includes(s.source_kind)).length,
    unknown_sales:(day.sales || []).filter(s=>s.amount===null).length,
    unknown_fees:(day.sales || []).filter(s=>s.fee_usd==null && s.fee_cdf==null).length,
    commission_difference: reported.commission_usd == null ? null : roundDelivery(reported.commission_usd - totals.USD.commission),
    remittance_difference: reported.remittance_usd == null ? null : roundDelivery(reported.remittance_usd - totals.USD.kab) };
}
export function summarizeDeliveryDays(days) {
  const summary = { days:days.length,deliveries:0,needs_review:0,cancelled:0,unknown_sales:0,unknown_fees:0, currencies:{} };
  for (const c of ['USD','CDF']) summary.currencies[c] = {sales:0,fees:0,expenses:0,commission:0,kab:0,courier:0,review_sales:0};
  for (const day of days) {
    if(day.status==='cancelled'){summary.cancelled++;continue;}
    const d=calculateDeliveryDay(day);
    summary.deliveries+=d.delivery_count; summary.unknown_sales+=d.unknown_sales; summary.unknown_fees+=d.unknown_fees;
    if(day.status==='needs_review') summary.needs_review++;
    for(const c of ['USD','CDF']) {
      if(day.status==='needs_review'){summary.currencies[c].review_sales+=d.totals[c].sales;continue;}
      for(const k of ['sales','fees','expenses','commission','kab','courier']) summary.currencies[c][k]+=d.totals[c][k];
    }
  }
  for(const c of ['USD','CDF']) for(const k in summary.currencies[c]) summary.currencies[c][k]=roundDelivery(summary.currencies[c][k]);
  return summary;
}
