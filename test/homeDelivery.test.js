import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeliveryDay,calculateDeliveryDay,summarizeDeliveryDays } from '../utils/homeDelivery.util.js';
import { extractHomeDeliveryDays,parseChatNumber } from '../services/homeDeliveryImport.service.js';
import { normalizeInvoiceTitle } from '../utils/invoiceTitle.util.js';

const sale=(amount,extras={})=>({amount,currency:'USD',items:[],fee_usd:null,fee_cdf:null,...extras});
const msg=(day,time,text,author='Adolphe Kab Airtel')=>`[10/${day}/26 ${time}] ${author}: ${text}`;
const extract=text=>extractHomeDeliveryDays(text,{customer_id:21,warehouse_id:6}).days;
test('sales basis follows the historical commission before transport; currencies stay separate',()=>{
  const d=calculateDeliveryDay({sales:[sale(100,{fee_cdf:5000})],expenses:[{amount:10,currency:'USD'}],split_basis:'sales',fees_recipient:'courier'});
  assert.equal(d.totals.USD.kab,75);assert.equal(d.totals.USD.courier,15);assert.equal(d.totals.CDF.courier,5000);
  assert.equal(d.totals.USD.fees,0);
});
test('net result is split after expenses and shared fees; the amounts reconcile',()=>{
  const d=calculateDeliveryDay({sales:[sale(100,{fee_usd:10})],expenses:[{amount:10,currency:'USD'}],split_basis:'net_result',fees_recipient:'shared'});
  assert.equal(d.totals.USD.kab,85);assert.equal(d.totals.USD.courier,15);
  assert.equal(d.totals.USD.kab+d.totals.USD.courier,110-10);
  const loss=calculateDeliveryDay({sales:[sale(10)],expenses:[{amount:30,currency:'USD'}],split_basis:'net_result'});
  assert.equal(loss.totals.USD.kab,-17);assert.equal(loss.totals.USD.courier,-3);
});
test('unverified and cancelled amounts do not enter recorded totals',()=>{
  const s=summarizeDeliveryDays([{sales:[sale(100)],status:'recorded'},{sales:[sale(50)],status:'needs_review'},{sales:[sale(500)],status:'cancelled'}]);
  assert.equal(s.currencies.USD.sales,100);assert.equal(s.currencies.USD.review_sales,50);assert.equal(s.deliveries,2);
});
test('manual sales derive amounts from products; reject malformed numbers and future dates',()=>{
  const body={customer_id:21,warehouse_id:6,courier_name:'Adolphe',delivery_date:'2026-01-01',sales:[{label:'Livraison',items:[{product_id:1,quantity:2,unit_price:10}],amount:999}]};
  const result=normalizeDeliveryDay(body);assert.equal(result.sales[0].amount,20);
  assert.throws(()=>normalizeDeliveryDay({...body,delivery_date:'2099-01-01'}));
  assert.throws(()=>normalizeDeliveryDay({...body,sales:[{items:[{product_id:1,quantity:1,unit_price:Infinity}]}]}));
  assert.throws(()=>normalizeDeliveryDay({...body,apply_stock:'true'}));
});
test('a receipt and its final recap count once',()=>{
  const days=extract([msg(1,'10:00:00',"J'ai livré le Mr 20 usd"),msg(1,'16:00:00','20 usd\nLes dépenses\n% 3 usd\nTrans 2 usd\nReste 15 usd')].join('\n'));
  assert.equal(days.length,1);assert.equal(days[0].sales.length,1);assert.equal(calculateDeliveryDay(days[0]).totals.USD.sales,20);
});
test('a cumulative recap replaces the financial snapshot without duplicating previous deliveries',()=>{
  const days=extract([msg(1,'10:00:00',"J'ai livré le Mr 20 usd"),msg(1,'11:00:00','20 usd\nLes dépenses\n% 3 usd\nTrans 1 usd\nReste 16 usd'),
    msg(1,'14:00:00',"J'ai livré la dame 30 usd"),msg(1,'16:00:00','20 + 30\nLes dépenses\n% 7.5 usd\nTrans 3 usd\nReste 39.5 usd')].join('\n'));
  assert.equal(calculateDeliveryDay(days[0]).totals.USD.sales,50);assert.equal(days[0].sales.length,2);
  assert.equal(days[0].expenses[0].amount,3);assert.equal(days[0].reported.commission_usd,7.5);
});
test('independent later deliveries and recaps add once and transport is accumulated',()=>{
  const days=extract([msg(1,'10:00:00',"J'ai livré le Mr 20 usd"),msg(1,'11:00:00','20 usd\nLes dépenses\n% 3 usd\nTrans 1 usd\nReste 16 usd'),
    msg(1,'14:00:00',"J'ai livré la dame 30 usd"),msg(1,'16:00:00','30 usd\nLes dépenses\n% 4.5 usd\nTrans 2 usd\nReste 23.5 usd')].join('\n'));
  assert.equal(calculateDeliveryDay(days[0]).totals.USD.sales,50);assert.equal(calculateDeliveryDay(days[0]).totals.USD.expenses,3);
});
test('order requests are never sales; missing receipt amounts remain unknown',()=>{
  const days=extract([msg(1,'09:00:00','Full Energie 10$\nTotal 10$ + 5000fc','Ir Dr Emmanuel Bisimwa'),msg(1,'10:00:00',"J'ai livré la dame")].join('\n'));
  assert.equal(days[0].sales[0].amount,null);assert.equal(days[0].status,'needs_review');assert.equal(days[0].sales[0].fee_cdf,null);
});
test('markdown, emoji and a following amount preserve actual confirmations',()=>{
  const days=extract([msg(1,'10:00:00',"J'ai *livré le Mr 20 usd*"),msg(1,'11:00:00',"J' ai 💷 livré la dame"),msg(1,'11:00:10','25 usd')].join('\n'));
  assert.deepEqual(days[0].sales.map(s=>s.amount),[20,25]);
});
test('historical day references split yesterday from today without treating a report as a new sale',()=>{
  const days=extract(msg(2,'16:00:00',"Hier 40 usd\nLes dépenses\n% 6 usd\nTrans 3 usd\nReste 31 usd\nAujourd'hui 65 usd\nLes dépenses\n% 10 usd\nTrans 2 usd\nReste 53 usd"));
  assert.deepEqual(days.map(d=>d.delivery_date),['2026-10-01','2026-10-02']);
  assert.deepEqual(days.map(d=>d.sales[0].amount),[40,65]);
});
test('mixed currency receipts and advances are preserved without guessing delivery fees',()=>{
  const days=extract([msg(1,'10:00:00',"J'ai livré le Mr 20 usd + 8000fc"),msg(1,'16:00:00','Les dépenses\n% 3 usd\nTrans 2 usd\nManu 5 usd\nReste 10 usd')].join('\n'));
  assert.equal(calculateDeliveryDay(days[0]).totals.CDF.sales,8000);assert.equal(days[0].sales[0].fee_cdf,null);
  assert.equal(days[0].expenses.length,1);assert.equal(days[0].reported.adjustments[0].amount,5);
});
test('invoice titles accept optional accents and reject multiline or excessive text',()=>{
  assert.equal(normalizeInvoiceTitle('  SWISSMART — Gombe  '),'SWISSMART — Gombe');assert.equal(normalizeInvoiceTitle('  '),null);
  assert.equal(normalizeInvoiceTitle(undefined),undefined);assert.throws(()=>normalizeInvoiceTitle('a\nb'));assert.throws(()=>normalizeInvoiceTitle('a'.repeat(161)));
});
test('chat amounts support decimal and thousands conventions',()=>{
  assert.equal(parseChatNumber('92.000'),92000);assert.equal(parseChatNumber('67 000'),67000);assert.equal(parseChatNumber('19,5'),19.5);
});
