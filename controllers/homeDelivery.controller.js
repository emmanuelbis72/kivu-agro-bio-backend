import { listHomeDeliveries, getHomeDelivery, saveHomeDelivery, cancelHomeDelivery } from '../models/homeDelivery.model.js';
import { normalizeDeliveryDay, deliveryError } from '../utils/homeDelivery.util.js';
import { normalizeBusinessDate } from '../utils/businessDate.util.js';
import { safeRecordAuditEvent } from '../services/audit.service.js';
import { createTabularReportPdfBuffer } from '../services/reportExport.service.js';

export async function listHomeDeliveriesHandler(req,res,next) {
  try{
    const filters={};
    for(const k of ['from','to']) if(req.query[k]){const d=normalizeBusinessDate(req.query[k],k);if(d.error)throw deliveryError(d.error);filters[k]=d.value;}
    if(filters.from && filters.to && filters.from>filters.to) throw deliveryError('Période invalide.');
    if(req.query.customer_id){const id=Number(req.query.customer_id);if(!Number.isInteger(id)||id<=0)throw deliveryError('Compte invalide.');filters.customer_id=id;}
    if(req.query.status){if(!['recorded','needs_review','cancelled'].includes(req.query.status))throw deliveryError('Statut invalide.');filters.status=req.query.status;}
    const data=await listHomeDeliveries(filters);
    if(req.path==='/export/pdf') {
      const state={recorded:'Enregistré',needs_review:'À vérifier',cancelled:'Annulé'};
      const fmt=(n,c='USD')=>`${Number(n).toFixed(2)} ${c==='CDF'?'FC':'USD'}`;
      const definition={title:'Livraisons',subtitle:'Livraison à domicile - Journal quotidien et répartition 85 % / 15 %',pdfLayout:'landscape',
        summaryItems:s=>[
          {label:'Ventes enregistrées USD',value:fmt(s.currencies.USD.sales)},
          {label:'Part KAB USD',value:fmt(s.currencies.USD.kab)},
          {label:'Part livreur USD',value:fmt(s.currencies.USD.courier)},
          {label:'Ventes à vérifier USD',value:fmt(s.currencies.USD.review_sales)},
          {label:'Ventes enregistrées FC',value:fmt(s.currencies.CDF.sales,'CDF')},
          {label:'Ventes à vérifier FC',value:fmt(s.currencies.CDF.review_sales,'CDF')}
        ],columns:[{header:'Date',key:'delivery_date',width:62},{header:'Compte',key:'customer_name',width:138},{header:'État',key:'state',width:65},
          {header:'Ventes USD / FC',key:'sales_text',width:100},{header:'Dépenses USD / FC',key:'expense_text',width:100},{header:'Part KAB USD / FC',key:'kab_text',width:100},{header:'Part livreur USD / FC',key:'courier_text',width:96}]};
      const rows=data.rows.map(d=>({...d,state:state[d.status],sales_text:fmt(d.totals.USD.sales)+'\n'+fmt(d.totals.CDF.sales,'CDF'),
        expense_text:fmt(d.totals.USD.expenses)+'\n'+fmt(d.totals.CDF.expenses,'CDF'),kab_text:fmt(d.totals.USD.kab)+'\n'+fmt(d.totals.CDF.kab,'CDF'),
        courier_text:fmt(d.totals.USD.courier)+'\n'+fmt(d.totals.CDF.courier,'CDF')}));
      const exportFilters={};
      if(filters.from)exportFilters.Du=filters.from;
      if(filters.to)exportFilters.Au=filters.to;
      if(filters.customer_id && data.rows[0])exportFilters.Compte=data.rows[0].customer_name;
      if(filters.status)exportFilters.État=state[filters.status];
      const buffer=await createTabularReportPdfBuffer(definition,{filters:exportFilters,summary:data.summary,rows});
      res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="livraisons-a-domicile.pdf"');return res.send(buffer);
    }
    res.json({success:true,data});
  }catch(e){next(e);}
}
export async function getHomeDeliveryHandler(req,res,next){try{const day=await getHomeDelivery(req.params.id);if(!day)throw deliveryError('Journée introuvable.',404);res.json({success:true,data:day});}catch(e){next(e);}}
export async function saveHomeDeliveryHandler(req,res,next){try{
  const previous=req.params.id?await getHomeDelivery(req.params.id):null;
  if(req.params.id&&!previous)throw deliveryError('Journée introuvable.',404);
  const data=normalizeDeliveryDay(req.body,{historical:!!previous?.source_key});
  data.status=req.body.status || previous?.status || 'recorded';
  if(previous?.status==='needs_review' && data.status==='recorded' && req.body.review_acknowledged!==true) {
    throw deliveryError('Confirmez la vérification des réserves avant de valider la journée.');
  }
  data.review_reasons=data.status==='recorded'?[]:previous?.review_reasons || [];
  const saved=await saveHomeDelivery(data,{id:previous?.id,actor:req.user?.id || null,version:req.body.version});
  const day=await getHomeDelivery(saved.id);
  await safeRecordAuditEvent({req,module:'home_deliveries',action_type:previous?'update':'create',entity_type:'home_delivery',entity_id:day.id,
    document_reference:data.delivery_date,old_value:previous,new_value:day,metadata:{stock_applied:day.stock_applied,status:day.status}});
  res.status(previous?200:201).json({success:true,data:day});
}catch(e){next(e);}}
export async function cancelHomeDeliveryHandler(req,res,next){try{const day=await cancelHomeDelivery(req.params.id,req.body.version,req.user?.id || null);
  await safeRecordAuditEvent({req,module:'home_deliveries',action_type:'cancel',entity_type:'home_delivery',entity_id:day.id,old_value:day});
  res.json({success:true});}catch(e){next(e);}}
