import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.js';
import { extractHomeDeliveryDays } from '../services/homeDeliveryImport.service.js';
import { normalizeDeliveryDay, summarizeDeliveryDays, calculateDeliveryDay } from '../utils/homeDelivery.util.js';
import { ensureHomeDeliverySchema } from '../models/homeDelivery.model.js';

const args=process.argv.slice(2);const apply=args.includes('--apply');
const fileIndex=args.indexOf('--file');
const file=fileIndex>=0?args[fileIndex+1]:null;
if(!file || file.startsWith('--')) {
  console.error('Usage : node scripts/import-home-deliveries.mjs --file chemin/_chat.txt [--apply]');
  await pool.end();
  process.exit(1);
}
const out=path.resolve('output/home-deliveries-adolphe');
await fs.mkdir(out,{recursive:true});
try {
  const accounts=(await pool.query(`SELECT id,business_name,warehouse_id FROM customers WHERE upper(business_name)='LIVRAISON A DOMICILE KINSHASA'
    AND archived_at IS NULL AND is_active`)).rows;
  if(accounts.length!==1 || !accounts[0].warehouse_id)throw new Error('Le compte Kinshasa doit être unique et lié à un dépôt.');
  const catalog=(await pool.query("SELECT id,name FROM products WHERE product_role='finished_product'")).rows;
  const text=await fs.readFile(file,'utf8');const result=extractHomeDeliveryDays(text,{customer_id:accounts[0].id,warehouse_id:accounts[0].warehouse_id,catalog});
  const days=result.days.map(day=>({...day,...normalizeDeliveryDay(day,{historical:true}),source_file:path.basename(path.dirname(file))+'/'+path.basename(file),source_hash:result.source_hash}));
  const summary=summarizeDeliveryDays(days);const report={account:accounts[0],source_file:file,source_hash:result.source_hash,messages_count:result.messages_count,
    from:days[0]?.delivery_date,to:days.at(-1)?.delivery_date,summary,days:days.map(calculateDeliveryDay)};
  await fs.writeFile(path.join(out,'import-preview.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({mode:apply?'apply':'preview',account:accounts[0],from:report.from,to:report.to,messages:report.messages_count,summary},null,2));
  if(apply){
    await ensureHomeDeliverySchema();const client=await pool.connect();
    try {
      await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('whatsapp-adolphe-home-delivery-import'))");
      const before=(await client.query('SELECT * FROM home_delivery_days WHERE customer_id=$1 ORDER BY id',[accounts[0].id])).rows;
      await fs.writeFile(path.join(out,'before-import-'+Date.now()+'.json'),JSON.stringify(before,null,2));
      let inserted=0;let skipped=0;
      for(const d of days){
        const r=await client.query(`INSERT INTO home_delivery_days(customer_id,warehouse_id,delivery_date,courier_name,status,split_basis,fees_recipient,
          sales,expenses,reported,review_reasons,source_evidence,source_key,source_file,source_hash,notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(source_key) DO NOTHING RETURNING id`,
          [d.customer_id,d.warehouse_id,d.delivery_date,d.courier_name,d.status,d.split_basis,d.fees_recipient,JSON.stringify(d.sales),JSON.stringify(d.expenses),
          JSON.stringify(d.reported),JSON.stringify(d.review_reasons),JSON.stringify(d.source_evidence),d.source_key,d.source_file,d.source_hash,d.notes]);
        if(r.rowCount)inserted++;else skipped++;
      }
      await client.query('COMMIT');
      const receipt={inserted,skipped,account_id:accounts[0].id,source_hash:result.source_hash,imported_at:new Date().toISOString()};
      await fs.writeFile(path.join(out,'import-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}
