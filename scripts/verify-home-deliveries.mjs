import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pool } from '../config/db.js';
import { ensureHomeDeliverySchema } from '../models/homeDelivery.model.js';
import { ensureStockSchema } from '../models/stock.model.js';
import app from '../app.js';

// Every fixture, stock movement, title edit and audit row is rolled back together.
await ensureHomeDeliverySchema();await ensureStockSchema();
const client=await pool.connect();await client.query('BEGIN');
const originalQuery=pool.query.bind(pool),originalConnect=pool.connect.bind(pool);
const wrapper={query:(sql,values)=>{
  if(sql==='BEGIN')return client.query('SAVEPOINT delivery_verification_call');
  if(sql==='COMMIT')return client.query('RELEASE SAVEPOINT delivery_verification_call');
  if(sql==='ROLLBACK')return client.query('ROLLBACK TO SAVEPOINT delivery_verification_call');
  return client.query(sql,values);
},release(){}};
pool.query=(...args)=>client.query(...args);pool.connect=async()=>wrapper;
let server;
try {
  const account=(await client.query(`SELECT id,warehouse_id FROM customers WHERE business_name='LIVRAISON A DOMICILE KINSHASA'`)).rows[0];
  const product=(await client.query(`SELECT p.id,ws.quantity FROM products p JOIN warehouse_stock ws ON ws.product_id=p.id
    WHERE ws.warehouse_id=$1 AND ws.stock_form='bulk' AND ws.quantity>5 AND p.product_role='finished_product'
      AND NOT EXISTS(SELECT 1 FROM product_recipes r WHERE r.finished_product_id=p.id) ORDER BY p.id LIMIT 1`,[account.warehouse_id])).rows[0];
  assert.ok(product,'A stocked product without a recipe is required for this integration check.');
  const countsBefore=(await client.query('SELECT (SELECT count(*) FROM invoices)::int AS invoices,(SELECT count(*) FROM payments)::int AS payments')).rows[0];
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api`;
  const request=async(route,method='GET',body=null)=>{const res=await fetch(url+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=(res.headers.get('content-type') || '').includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer());return {status:res.status,data};};
  const body={customer_id:account.id,warehouse_id:account.warehouse_id,delivery_date:'2026-10-09',courier_name:'Vérification temporaire',
    split_basis:'sales',fees_recipient:'courier',apply_stock:true,sales:[{label:'Livraison temporaire',items:[{product_id:product.id,quantity:2,unit_price:10}],fee_cdf:5000}],
    expenses:[{category:'transport',label:'Transport',amount:4,currency:'USD'}]};
  const created=await request('/home-deliveries','POST',body);assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal(created.data.data.customer_name,'LIVRAISON A DOMICILE KINSHASA');
  assert.equal(created.data.data.totals.USD.kab,13);assert.equal(created.data.data.totals.CDF.courier,5000);
  const id=created.data.data.id;
  const stock=async()=>Number((await client.query(`SELECT quantity FROM warehouse_stock WHERE warehouse_id=$1 AND product_id=$2 AND stock_form='bulk'`,[account.warehouse_id,product.id])).rows[0].quantity);
  assert.equal(await stock(),Number(product.quantity)-2);
  const updated=await request(`/home-deliveries/${id}`,'PUT',{...body,version:1,sales:[{...body.sales[0],items:[{product_id:product.id,quantity:1,unit_price:30}]}]});
  assert.equal(updated.status,200,JSON.stringify(updated.data));assert.equal(updated.data.data.version,2);assert.equal(await stock(),Number(product.quantity)-1);
  const stale=await request(`/home-deliveries/${id}`,'PUT',{...body,version:1});assert.equal(stale.status,409);assert.equal(await stock(),Number(product.quantity)-1);
  const fetched=await request(`/home-deliveries/${id}`);assert.equal(fetched.data.data.sales[0].amount,30);
  const exportResult=await request('/home-deliveries/export/pdf?from=2026-10-09&to=2026-10-09');assert.equal(exportResult.status,200);
  assert.ok(exportResult.data.subarray(0,4).toString()==='%PDF');await fs.writeFile('tmp/home-delivery-verification.pdf',exportResult.data);
  const cancelled=await request(`/home-deliveries/${id}/cancel`,'POST',{version:2});assert.equal(cancelled.status,200);assert.equal(await stock(),Number(product.quantity));
  const invoice=(await client.query('SELECT * FROM invoices WHERE paid_amount>0 AND archived_at IS NULL ORDER BY id LIMIT 1')).rows[0];
  if(invoice){const title=await request(`/invoices/${invoice.id}/title`,'PATCH',{customer_title:'Point de vente — Vérification temporaire'});assert.equal(title.status,200,JSON.stringify(title.data));
    const current=(await client.query('SELECT * FROM invoices WHERE id=$1',[invoice.id])).rows[0];
    for(const k of ['customer_id','total_amount','paid_amount','balance_due','status','accounting_entry_id'])assert.equal(current[k],invoice[k]);
    assert.equal(current.customer_title,'Point de vente — Vérification temporaire');}
  const countsAfter=(await client.query('SELECT (SELECT count(*) FROM invoices)::int AS invoices,(SELECT count(*) FROM payments)::int AS payments')).rows[0];
  assert.deepEqual(countsAfter,countsBefore);
  console.log(JSON.stringify({success:true,checks:['API create/read/update/cancel','USD and CDF split','Stock deduction, correction and reversal','Version conflict rollback','PDF export','Title on a paid invoice preserves balances','No new invoice or invoice payment'],test_rows_persisted:0},null,2));
}finally{
  if(server)await new Promise(r=>server.close(r));
  pool.query=originalQuery;pool.connect=originalConnect;await client.query('ROLLBACK');client.release();await pool.end();
}
