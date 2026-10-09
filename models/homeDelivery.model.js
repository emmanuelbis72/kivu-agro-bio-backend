import fs from 'node:fs/promises';
import { pool } from '../config/db.js';
import { ensureStockSchema, performStockExit, performStockEntry } from './stock.model.js';
import { calculateDeliveryDay, deliveryError, summarizeDeliveryDays } from '../utils/homeDelivery.util.js';

let schemaPromise;
export function ensureHomeDeliverySchema() {
  schemaPromise ||= fs.readFile(new URL('../sql/migrations/2026-10-09_home_deliveries.sql',import.meta.url),'utf8')
    .then(sql=>pool.query(sql)).catch(e=>{schemaPromise=undefined;throw e;});
  return schemaPromise;
}
export async function listHomeDeliveries(filters = {}) {
  await ensureHomeDeliverySchema();
  const values=[]; const conditions=[];
  for(const [key,column] of [['customer_id','d.customer_id'],['from','d.delivery_date'],['to','d.delivery_date'],['status','d.status']]) {
    if(filters[key]){ values.push(filters[key]); conditions.push(`${column} ${key==='from'?'>=':key==='to'?'<=':'='} $${values.length}`); }
  }
  const result=await pool.query(`SELECT d.*,d.delivery_date::text AS delivery_date,c.business_name AS customer_name,w.name AS warehouse_name
    FROM home_delivery_days d JOIN customers c ON c.id=d.customer_id JOIN warehouses w ON w.id=d.warehouse_id
    ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY d.delivery_date DESC,d.id DESC`,values);
  return { rows:result.rows.map(calculateDeliveryDay), summary:summarizeDeliveryDays(result.rows) };
}
export async function getHomeDelivery(id) {
  if(!Number.isInteger(Number(id)) || Number(id)<=0) throw deliveryError('ID de livraison invalide.');
  await ensureHomeDeliverySchema();
  const r=await pool.query(`SELECT d.*,d.delivery_date::text AS delivery_date,c.business_name AS customer_name,w.name AS warehouse_name
    FROM home_delivery_days d JOIN customers c ON c.id=d.customer_id JOIN warehouses w ON w.id=d.warehouse_id WHERE d.id=$1`,[id]);
  return r.rows[0]?calculateDeliveryDay(r.rows[0]):null;
}
async function validateReferences(client,data) {
  const r=await client.query(`SELECT c.id,c.warehouse_id,w.id AS depot FROM customers c JOIN warehouses w ON w.id=$2
    WHERE c.id=$1 AND c.archived_at IS NULL AND c.is_active AND upper(c.business_name) LIKE '%LIVRAISON%DOMICILE%'`,[data.customer_id,data.warehouse_id]);
  if(!r.rows[0]) throw deliveryError('Sélectionnez un compte LIVRAISON A DOMICILE et un dépôt existants.');
  if(r.rows[0].warehouse_id && r.rows[0].warehouse_id!==data.warehouse_id) throw deliveryError('Le dépôt doit correspondre au compte de livraison.');
  const ids=[...new Set(data.sales.flatMap(s=>s.items.map(i=>i.product_id).filter(Boolean)))];
  const products=await client.query('SELECT * FROM products WHERE id=ANY($1::int[])', [ids]);
  if(products.rows.length!==ids.length || products.rows.some(p=>p.product_role!=='finished_product')) throw deliveryError('Les produits vendus doivent être des produits finis existants.');
  const map=new Map(products.rows.map(p=>[p.id,p]));
  for(const s of data.sales) for(const i of s.items) if(i.product_id) i.description=map.get(i.product_id).name;
  return map;
}
async function lockWarehouseStock(client,warehouseId) {
  // Same rows used by the stock module: serialize read/update to avoid lost stock movements.
  await client.query('SELECT id FROM warehouse_stock WHERE warehouse_id=$1 ORDER BY id FOR UPDATE',[warehouseId]);
}
async function reverseDayStock(client,day,actor) {
  if(!day.stock_applied) return;
  await lockWarehouseStock(client,day.warehouse_id);
  const movements=await client.query(`SELECT * FROM stock_movements WHERE reference_type='home_delivery' AND reference_id=$1 ORDER BY id`,[day.id]);
  for(const m of movements.rows) await performStockEntry({client,skip_schema:true,warehouse_id:m.warehouse_id,product_id:m.product_id,
    quantity:Number(m.quantity),quantity_unit:m.quantity_unit,stock_form:m.stock_form,package_size:m.package_size,package_unit:m.package_unit,
    unit_cost:Number(m.unit_cost),reference_type:'home_delivery_reversal',reference_id:day.id,notes:`Correction livraison ${day.delivery_date}`,created_by:actor});
  // Preserve movements, and distinguish old generations from the replacement consumption.
  await client.query(`UPDATE stock_movements SET reference_type='home_delivery_reversed' WHERE reference_type='home_delivery' AND reference_id=$1`,[day.id]);
}
async function consumeDayStock(client,day,products,actor) {
  await lockWarehouseStock(client,day.warehouse_id);
  for(const sale of day.sales) for(const item of sale.items) {
    if(!item.product_id || !item.quantity) throw deliveryError('Complétez les produits et quantités avant de déduire le stock.');
    const product=products.get(item.product_id);
    const recipes=await client.query(`SELECT pr.*,p.cost_price FROM product_recipes pr JOIN products p ON p.id=pr.component_product_id
      WHERE finished_product_id=$1 ORDER BY component_product_id`,[item.product_id]);
    const components=recipes.rows.length ? recipes.rows.map(r=>({product_id:r.component_product_id,quantity:Number(r.quantity_required)*item.quantity,
      quantity_unit:r.quantity_unit,unit_cost:Number(r.cost_price),movement_type:'PRODUCTION_CONSUME'})) :
      [{product_id:item.product_id,quantity:item.quantity,unit_cost:Number(product.cost_price),movement_type:'OUT'}];
    for(const component of components) await performStockExit({...component,client,skip_schema:true,warehouse_id:day.warehouse_id,stock_form:'bulk',
      reference_type:'home_delivery',reference_id:day.id,notes:`Livraison à domicile ${day.delivery_date}`,created_by:actor});
  }
}
export async function saveHomeDelivery(data,{id=null,actor=null,version=null,imported=null}={}) {
  await ensureHomeDeliverySchema();
  if(data.apply_stock) await ensureStockSchema();
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    let previous=null;
    if(id){
      previous=(await client.query('SELECT * FROM home_delivery_days WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!previous) throw deliveryError('Journée introuvable.',404);
      if(previous.status==='cancelled') throw deliveryError('Cette journée est annulée.');
      if(Number(version)!==previous.version) throw deliveryError('Cette journée a été modifiée ailleurs. Rechargez-la.',409);
      if(previous.stock_applied) await reverseDayStock(client,previous,actor);
    }
    const products=await validateReferences(client,data);
    const status=imported?.status || data.status || 'recorded';
    if(!['recorded','needs_review'].includes(status)) throw deliveryError('Statut invalide.');
    const reasons=data.review_reasons || imported?.review_reasons || [];
    if(status==='recorded' && data.sales.some(s=>s.amount==null)) throw deliveryError('Complétez tous les montants avant de valider.');
    const vals=[data.customer_id,data.warehouse_id,data.delivery_date,data.courier_name,status,data.split_basis,data.fees_recipient,
      JSON.stringify(data.sales),JSON.stringify(data.expenses),data.notes || null,JSON.stringify(reasons),actor];
    let day;
    if(id){
      day=(await client.query(`UPDATE home_delivery_days SET customer_id=$1,warehouse_id=$2,delivery_date=$3,courier_name=$4,status=$5,
        split_basis=$6,fees_recipient=$7,sales=$8,expenses=$9,notes=$10,review_reasons=$11,version=version+1,updated_at=NOW(),stock_applied=FALSE
        WHERE id=$12 RETURNING *`,[...vals.slice(0,11),id])).rows[0];
    } else {
      day=(await client.query(`INSERT INTO home_delivery_days(customer_id,warehouse_id,delivery_date,courier_name,status,split_basis,fees_recipient,
        sales,expenses,notes,review_reasons,created_by,reported,source_evidence,source_key,source_file,source_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT(source_key) DO NOTHING RETURNING *`,[...vals,JSON.stringify(imported?.reported || {}),JSON.stringify(imported?.source_evidence || []),
        imported?.source_key || null,imported?.source_file || null,imported?.source_hash || null])).rows[0];
      if(!day){await client.query('ROLLBACK');return {skipped:true};}
    }
    if(data.apply_stock){await consumeDayStock(client,{...day,delivery_date:data.delivery_date},products,actor);
      await client.query('UPDATE home_delivery_days SET stock_applied=TRUE WHERE id=$1',[day.id]);day.stock_applied=true;}
    await client.query('COMMIT');
    return calculateDeliveryDay({...day,delivery_date:data.delivery_date});
  } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
}
export async function cancelHomeDelivery(id,version,actor) {
  if(!Number.isInteger(Number(id)) || Number(id)<=0) throw deliveryError('ID de livraison invalide.');
  await ensureHomeDeliverySchema(); await ensureStockSchema();
  const client=await pool.connect();
  try{await client.query('BEGIN');
    const day=(await client.query('SELECT * FROM home_delivery_days WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!day) throw deliveryError('Journée introuvable.',404);
    if(Number(version)!==day.version) throw deliveryError('Rechargez la journée avant de l’annuler.',409);
    if(day.status!=='cancelled'){await reverseDayStock(client,day,actor); await client.query(`UPDATE home_delivery_days SET status='cancelled',stock_applied=FALSE,version=version+1,updated_at=NOW() WHERE id=$1`,[id]);}
    await client.query('COMMIT');return day;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
