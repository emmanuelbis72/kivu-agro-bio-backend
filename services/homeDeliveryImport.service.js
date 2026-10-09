import crypto from 'node:crypto';
import { roundDelivery, calculateDeliveryDay } from '../utils/homeDelivery.util.js';

export function parseWhatsAppExport(text) {
  const messages=[];let current;
  for(const [i,line] of text.split(/\r?\n/).entries()) {
    const m=line.match(/^[\u200e\u200f]*\[(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{2}:\d{2}:\d{2})\] ([^:]+): ?(.*)$/);
    if(m){current={date:`20${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`,time:m[4],author:m[5],text:m[6],line:i+1,index:messages.length};messages.push(current);}
    else if(current) current.text+='\n'+line;
  }
  return messages;
}
const clean=t=>t.replace(/[\u200e\u200f*~]/g,'').replace(/<Ce message a été modifié>/g,'').replace(/(\d)[.,'](?=\s*(?:usd|us\b|\$))/gi,'$1');
const delivered=/j.\s*ai[^\p{L}\p{N}]*livr[ée]/iu;
export function parseChatNumber(s) {
  return Number(s.trim().replace(/\s+/g,'').replace(/(?<=\d)[.](?=\d{3}(?:\D|$))/g,'').replace(/[,'’]/g,'.'));
}
const amountPattern="(\\d+(?:[.,'’]\\s*\\d+)?(?:[ ]\\d{3})*)";
function amounts(t) {
  return [...clean(t).matchAll(new RegExp(amountPattern+'\\s*(usd|us\\b|\\$|dollars?|fc|f\\b)','gi'))].map(m=>({amount:parseChatNumber(m[1]),currency:/^(fc|f)$/i.test(m[2])?'CDF':'USD',index:m.index,end:m.index+m[0].length}));
}
function previousDate(date,days=1) {const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);}
const proof=m=>({date:m.date,time:m.time,author:m.author,line:m.line,text:m.text.trim()});
function parseHeader(text) {
  const t=clean(text);
  const explicit=t.match(new RegExp('total\\s*(?:de livraisons|est)?\\s*[:;]?\\s*'+amountPattern+'\\s*(usd|\\$|fc)?','i'));
  const lines=t.split('\n');
  const numeric=lines.find(l=>/^\s*(?:hier|aujourd.hui|la livraison d.hier)?\s*\d+(?:[.,'’]\d+)?\s*(?:usd)?\s*\+/i.test(l));
  let list=null;
  if(numeric){
    const before=numeric.split(/total|=| - /i)[0].replace(/\b(?:hier|aujourd.hui|la livraison d.hier|usd|\$)\b/gi,'').trim();
    if(/^[\d\s+.,'’]+$/.test(before)) list=before.split('+').map(parseChatNumber);
    if(list?.some(a=>!Number.isFinite(a)||a>1000))list=null;
  }
  if(explicit){const total=parseChatNumber(explicit[1]);return {total,currency:explicit[2]?.toLowerCase()==='fc'?'CDF':'USD',list,
    conflict:!!list&&Math.abs(list.reduce((s,a)=>s+a,0)-total)>0.02};}
  if(list)return {total:roundDelivery(list.reduce((s,a)=>s+a,0)),currency:'USD',list};
  const single=lines.map(l=>clean(l).trim().replace(/^(?:aujourd.hui|hier|livré|la vente d.aujourd.hui)\s*/i,''))
    .find(l=>/^\d+[.,]?\d*\s*(usd|\$|fc)\s*$/i.test(l));
  if(single){const a=amounts(single)[0];return {...a,total:a.amount,list:null};}
  return null;
}
function readExpenses(t) {
  const result={expenses:[],adjustments:[],commission_usd:null,commission_cdf:null,remittance_usd:null,remittance_cdf:null,issues:[]};
  const lines=clean(t).split('\n');let inExpenses=false;
  for(let line of lines){
    if(/les? d[ée]penses/i.test(line)){inExpenses=true;continue;}
    if(!inExpenses && /%/.test(line))inExpenses=true;
    if(!inExpenses)continue;
    const a=amounts(line); const numeric=line.match(new RegExp(amountPattern));
    const number=a[0]?.amount ?? (numeric ? parseChatNumber(numeric[1]):null);
    const currency=a[0]?.currency || 'USD';
    if(number===null)continue;
    if(/%/.test(line)){result[currency==='USD'?'commission_usd':'commission_cdf']=number;continue;}
    if(/rest[eé]/i.test(line)){
      const after=line.slice(line.search(/rest[eé]/i));const n=after.match(new RegExp(amountPattern));
      if(n)result[currency==='USD'?'remittance_usd':'remittance_cdf']=parseChatNumber(n[1]);
      if(/[+=]|hier|total/i.test(after)) result.issues.push('Le reste annoncé contient un report ou un cumul ; il ne prouve pas un versement.');
      break;
    }
    if(/^(?:trans(?:port)?\b)|\btransport\b/i.test(line.trim())) {
      // “Transfert” is a transfer of funds, not a transport expense.
      if(/\+/.test(line)) {
        const expr=line.match(/(\d+(?:[.,]\d+)?\s*(?:\+\s*\d+(?:[.,]\d+)?)+)/);
        if(expr)result.expenses.push({category:'transport',label:line.trim(),amount:roundDelivery(expr[1].split('+').map(parseChatNumber).reduce((s,a)=>s+a,0)),currency});
        else result.issues.push('Dépense de transport à vérifier : '+line.trim());
      }else result.expenses.push({category:'transport',label:line.trim(),amount:number,currency});
    } else if(/transfert|manu|\bdr\b|personnel|cr[ée]dit|promesse|mpesa/i.test(line)) {
      result.adjustments.push({label:line.trim(),amount:number,currency});
      result.issues.push('Mouvement à qualifier (avance, versement ou achat), conservé hors dépenses : '+line.trim());
    } else if(/achat|manger|restaurant|restauration|makala|mucuna|ortie|huile|cannelle|nep|paquet|bâche|ginseng|chia|argile|aubergine|caf[ée]|poudre/i.test(line)) {
      result.expenses.push({category:'other',label:line.trim(),amount:number,currency});
    } else if(!/^\s*total|^\s*\d+[.,]?\d*\s*(usd|\$)?\s*$/i.test(line)) {
      result.issues.push('Ligne de dépenses à vérifier : '+line.trim());
    }
  }
  return result;
}
function salesFromConfirmation(message) {
  const t=clean(message.text); const parts=t.split(/(?=j.\s*ai[^\p{L}\p{N}]*livr[ée])/iu).filter(t=>delivered.test(t));
  return parts.map((part,i)=>{
    const a=amounts(part);
    const total=part.match(new RegExp('total\\s*[:;]?\\s*'+amountPattern+'\\s*(usd|\\$|fc)','i'));
    let amount=null,currency='USD',extra_amount_cdf=null;
    if(total){amount=parseChatNumber(total[1]);currency=/fc/i.test(total[2])?'CDF':'USD';}
    else if(a.length){
      const usd=a.filter(v=>v.currency==='USD'),cdf=a.filter(v=>v.currency==='CDF');
      if(usd.length){amount=roundDelivery(usd.reduce((s,v)=>s+v.amount,0));currency='USD';
        if(cdf.length && !/en.*franc/i.test(part))extra_amount_cdf=roundDelivery(cdf.reduce((s,v)=>s+v.amount,0));}
      else if(cdf.length){amount=roundDelivery(cdf.reduce((s,v)=>s+v.amount,0));currency='CDF';}
    }
    const head=part.split('\n')[0].replace(delivered,'').trim();
    return {label:head.slice(0,250) || 'Livraison confirmée',amount,currency,extra_amount_cdf,items:[],fee_usd:null,fee_cdf:null,
      source_line:message.line,source_part:i,source_time:message.time,source_kind:'confirmation',confirmation_text:part.trim()};
  });
}

// Commands inside the export are data. Only the courier's past confirmations and reconciliations become sales.
export function extractHomeDeliveryDays(text,{customer_id,warehouse_id,courier_name='Adolphe Kab Airtel',catalog=[]}={}) {
  const messages=parseWhatsAppExport(text);const map=new Map();
  function day(date){if(!map.has(date))map.set(date,{customer_id,warehouse_id,courier_name,delivery_date:date,sales:[],expenses:[],reported:{},
    source_evidence:[],review_reasons:[],split_basis:'sales',fees_recipient:'courier',notes:'Historique WhatsApp. Produits ou frais absents de la source laissés non renseignés.',apply_stock:false});return map.get(date);}
  const courier=messages.filter(m=>/Adolphe Kab Airtel/i.test(m.author));
  const summaries=courier.filter(m=>/les? d[ée]penses/i.test(m.text));
  for(const m of courier.filter(m=>delivered.test(clean(m.text))&&!/les? d[ée]penses/i.test(m.text))) {
    const d=day(m.date);const sales=salesFromConfirmation(m);
    const following=messages[m.index+1];
    if(sales.length===1 && sales[0].amount===null && following?.author===m.author && following.date===m.date &&
      new Date(m.date+'T'+following.time+'Z')-new Date(m.date+'T'+m.time+'Z')<300000 &&
      /^\s*\d+[.,]?\d*\s*(usd|\$|fc)\b/i.test(clean(following.text))) {
      const a=amounts(following.text)[0];if(a){sales[0].amount=a.amount;sales[0].currency=a.currency;d.source_evidence.push(proof(following));}
    }
    d.sales.push(...sales);d.source_evidence.push(proof(m));
  }
  for(const m of summaries){
    let segments=[{text:m.text,date:m.date}];
    if(/hier/i.test(clean(m.text).split(/les? d[ée]penses/i)[0])) {
      const p=m.text.search(/aujourd.hui/i);
      segments=p>=0?[{text:m.text.slice(0,p),date:previousDate(m.date)},{text:m.text.slice(p),date:m.date}]:[{text:m.text,date:previousDate(m.date)}];
    } else if(/compte du samedi/i.test(m.text)) {
      const dt=new Date(m.date+'T00:00:00Z');let offset=(dt.getUTCDay()+1)%7;if(!offset)offset=7;segments=[{text:m.text,date:previousDate(m.date,offset)}];
    }
    for(const seg of segments){
      const d=day(seg.date);d.source_evidence.push(proof(m));
      let head=seg.text.split(/les? d[ée]penses/i)[0];
      if(delivered.test(clean(head)) && !/total/i.test(head) && !d.sales.some(s=>s.source_line>(d._lastSummaryLine || 0) && s.source_line<=m.line)) {
        d.sales.push(...salesFromConfirmation({...m,text:head}));
      }
      let h=parseHeader(head);
      const prevSummary=d._lastSummary ?? -1;
      if(!h && !head.trim()){
        const prior=courier.filter(x=>x.date===seg.date&&x.index<m.index&&x.index>prevSummary).slice(-12).reverse()
          .find(x=>!/%|reste|envoy|reçu|transfert|facture/i.test(x.text)&&parseHeader(x.text));
        if(prior){h=parseHeader(prior.text);d.source_evidence.push(proof(prior));}
      }
      const allBefore=d.sales.filter(s=>s.source_line<=m.line);
      const windowBefore=allBefore.filter(s=>s.source_line>(d._lastSummaryLine || 0));
      const cumulative=!!h && prevSummary>=0 && !h.conflict && allBefore.every(s=>s.amount!==null&&s.currency===h.currency&&!s.extra_amount_cdf) &&
        roundDelivery(allBefore.reduce((sum,s)=>sum+s.amount,0))===h.total && roundDelivery(windowBefore.reduce((sum,s)=>sum+s.amount,0))!==h.total;
      const exp=readExpenses(seg.text);
      if(cumulative){d.expenses=[];for(const key of ['commission_usd','commission_cdf','remittance_usd','remittance_cdf'])delete d.reported[key];
        d.reported.cumulative_recap_line=m.line;}
      d.expenses.push(...exp.expenses);d.review_reasons.push(...exp.issues);
      for(const key of ['commission_usd','commission_cdf','remittance_usd','remittance_cdf']) if(exp[key]!==null)d.reported[key]=roundDelivery(Number(d.reported[key] || 0)+exp[key]);
      if(exp.adjustments.length)d.reported.adjustments=[...(d.reported.adjustments || []),...exp.adjustments];
      if(h){
        if(h.conflict)d.review_reasons.push(`Récapitulatif ligne ${m.line} : somme des ventes différente du total annoncé (${h.total}).`);
        const window=d.sales.filter(s=>s.source_line>(d._lastSummaryLine || 0)&&s.source_line<=m.line);
        const known=window.filter(s=>s.currency===h.currency&&s.amount!==null);
        const sum=roundDelivery(known.reduce((n,s)=>n+s.amount,0));
        d.reported.sales_recaps=[...(d.reported.sales_recaps || []),{line:m.line,total:h.total,currency:h.currency}];
        if(cumulative || (!h.conflict && window.every(s=>s.amount!==null)&&sum===h.total)){/* confirmations corroborate the recap */}
        else if(h.list && !h.conflict && !window.some(s=>s.extra_amount_cdf || s.currency!==h.currency)){
          const remaining=[...h.list];const matched=[];let disagreement=false;
          for(const s of known){const j=remaining.findIndex(a=>Math.abs(a-s.amount)<0.01);if(j<0){disagreement=true;break;}remaining.splice(j,1);matched.push(s);}
          if(!disagreement){
            d.sales=d.sales.filter(s=>!window.includes(s));d.sales.push(...matched);
            for(const amount of remaining)d.sales.push({label:'Livraison du récapitulatif (destinataire non identifié)',amount,currency:h.currency,items:[],fee_usd:null,fee_cdf:null,source_line:m.line,source_kind:'recap'});
          }else d.review_reasons.push(`Récapitulatif ligne ${m.line} (${h.total}) différent des confirmations (${sum}).`);
        } else if(window.length===0){
          d.sales.push({label:'Ventes du récapitulatif — détail des livraisons non disponible',amount:h.total,currency:h.currency,items:[],fee_usd:null,fee_cdf:null,source_line:m.line,source_kind:'aggregate'});
          d.review_reasons.push('Récapitulatif global : nombre de livraisons et détail des produits à compléter.');
        } else if(sum!==h.total || window.some(s=>s.amount===null))d.review_reasons.push(`Récapitulatif ligne ${m.line} (${h.total} ${h.currency}) à rapprocher des confirmations (${sum} ${h.currency}).`);
      }
      d._lastSummary=m.index;d._lastSummaryLine=m.line;
    }
  }
  // Keep explicitly identified product lines in confirmations, without guessing a catalogue product or quantity.
  for(const d of map.values()){
    for(const sale of d.sales){
      const raw=sale.confirmation_text || '';
      for(const line of clean(raw).split('\n').slice(1)){
        if(/total|refus|appel|sans |rest|franc|acheté|baobab/i.test(line))continue;
        const a=amounts(line);const label=line.replace(new RegExp(amountPattern+'\\s*(usd|\\$)','gi'),'').replace(/^\s*\d+[.]\s*/, '').trim();
        if(a.length===1 && /[a-zÀ-ÿ]{3}/i.test(label)){
          const q=label.match(/^\s*(\d+)\s+/);const quantity=q?Number(q[1]):null;
          sale.items.push({product_id:null,description:label.slice(0,250),quantity,unit_price:quantity?roundDelivery(a[0].amount/quantity):null});
        }
      }
      if(sale.extra_amount_cdf)d.review_reasons.push(`Vente mixte ligne ${sale.source_line} : frais ou produits supplémentaires en FC à distinguer.`);
      if(sale.amount===null)d.review_reasons.push(`Livraison confirmée ligne ${sale.source_line}, montant non renseigné.`);
    }
    if(!d.source_evidence.some(m=>/les? d[ée]penses/i.test(m.text)))d.review_reasons.push('Dépenses et commission historiques non documentées pour cette journée.');
    if(d.sales.some(s=>s.currency==='CDF'))d.review_reasons.push('Montant en FC à rapprocher du récapitulatif ; aucun taux de conversion supposé.');
    if(!d.sales.length){d.review_reasons.push('Récapitulatif de dépenses sans montant de vente confirmé.');
      d.sales.push({label:'Vente non documentée — récapitulatif de dépenses',amount:null,currency:'USD',items:[],fee_usd:null,fee_cdf:null,source_kind:'undocumented'});}
    const duplicate=d.source_evidence.some(m=>/hier|mercredi|samedi/i.test(m.text.split(/les? d[ée]penses/i)[0]));
    if(duplicate && d.sales.some(s=>s.source_kind==='aggregate'))d.review_reasons.push('Date du récapitulatif différé à vérifier.');
    d.source_evidence=[...new Map(d.source_evidence.map(m=>[m.line,m])).values()].sort((a,b)=>a.line-b.line);
    d.review_reasons=[...new Set(d.review_reasons)];d.status=d.review_reasons.length?'needs_review':'recorded';
    d.source_key='whatsapp-adolphe-kinshasa-'+d.delivery_date;
    delete d._lastSummary;delete d._lastSummaryLine;
  }
  reconcileProducts(messages,[...map.values()],catalog);
  for(const d of map.values()){
    const computed=calculateDeliveryDay(d);
    for(const c of ['USD','CDF']) {
      const reportedCommission=d.reported[c==='USD'?'commission_usd':'commission_cdf'];
      const tolerance=c==='USD'?Math.max(1,(d.reported.sales_recaps || []).length):100;
      if(reportedCommission!=null && Math.abs(reportedCommission-computed.totals[c].commission)>tolerance) {
        d.review_reasons.push(`Commission annoncée en ${c} différente du calcul de 15 % : ${reportedCommission} contre ${computed.totals[c].commission}.`);
      }
      if(computed.totals[c].expenses>0 && computed.totals[c].sales===0)d.review_reasons.push(`Dépenses en ${c} sans vente dans cette devise : rapprochement nécessaire.`);
    }
    d.review_reasons=[...new Set(d.review_reasons)];d.status=d.review_reasons.length?'needs_review':'recorded';
  }
  const days=[...map.values()].sort((a,b)=>a.delivery_date.localeCompare(b.delivery_date));
  return {days,messages_count:messages.length,source_hash:crypto.createHash('sha256').update(text).digest('hex')};
}

function productKey(text){return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/g,'').replace(/\b(de|au|en|la|les|des)\b/g,'').replace(/[^a-z0-9]/g,'');}
function reconcileProducts(messages,days,catalog){
  const map=new Map();
  for(const p of catalog){const key=productKey(p.name);map.set(key,[...(map.get(key) || []),p]);}
  const match=name=>{const p=map.get(productKey(name));return p?.length===1?p[0].id:null;};
  const orders=[];let group=[];
  const flush=()=>{
    if(!group.length)return;
    const items=[];let saleAmount=null;
    for(const m of group){
      const t=clean(m.text);
      if(/(?:ça|ca) fera|\btotal\b/i.test(t) || /^\s*\d+(?:[.,]\d+)?\s*(?:\$|usd)\s*\+/i.test(t)) {
        const a=amounts(t);if(a[0]?.currency==='USD')saleAmount=a[0].amount;
      }
      for(const line of t.split(/\n|(?<=(?:\$|usd))\s*\+\s*/i)){
        if(/total|fera|livraison|avenue|\bav[ .]|référence|quartier|commune|reste|trans|stock|envoy|compte|taux|soldé/i.test(line))continue;
        const a=amounts(line);
        const productWords=/huile|beurre|graines?|full|libido|moringa|mucuna|ortie|herbes|romarin|cannelle|curcuma|girofle|basilic|aubergine|antibio|chia|lin\b|lotus|nep|savon|laurier|spiruline|respire|anis|maca|karit[ée]|nigelle|fenugrec|baobab/i;
        if(!productWords.test(line))continue;
        if(a.length>1)continue;
        const label=line.replace(new RegExp(amountPattern+'\\s*(usd|\\$)','gi'),'').replace(/^[\s\-•⁠]+/,'').trim();
        if(!label || /\bet\b|\d+[.,]\d+\s*kg|\d+\s*kg|\bet\b/i.test(label))continue;
        const q=label.match(/^(\d+)\s+/);const quantity=q?Number(q[1]):null;
        const description=label.replace(/^\d+\s+/,'').slice(0,250);
        items.push({product_id:match(description),description,quantity,unit_price:quantity&&a.length?roundDelivery(a[0].amount/quantity):null,
          stated_line_amount:a[0]?.amount ?? null,source_line:m.line,confidence:'matched_order'});
      }
    }
    if(items.length && saleAmount===null && items.every(i=>i.stated_line_amount!==null))saleAmount=roundDelivery(items.reduce((a,i)=>a+i.stated_line_amount,0));
    if(items.length && saleAmount!==null)orders.push({items,amount:saleAmount,date:group[0].date,last_line:group.at(-1).line,
      time:group.at(-1).time,evidence:group.filter(m=>!/(?:image absente|audio omis|fiche contact manquante)/i.test(m.text)).map(proof),used:false});
    group=[];
  };
  for(const m of messages){
    if(/Adolphe/.test(m.author))continue;
    if(/fiche contact manquante/i.test(m.text)){flush();group=[m];continue;}
    if(clean(m.text).trim()==='-'){flush();continue;}
    if(group.length && (m.date!==group[0].date || m.index-group.at(-1).index>12))flush();
    group.push(m);
  }flush();
  for(const d of days)for(const sale of d.sales){
    if(sale.currency!=='USD'||sale.amount===null || sale.extra_amount_cdf || !sale.source_line)continue;
    if(sale.items.length){for(const i of sale.items)if(!i.product_id)i.product_id=match(i.description.replace(/^\d+\s+/,''));continue;}
    if(sale.source_kind!=='confirmation')continue;
    const candidates=orders.filter(o=>!o.used&&o.last_line<sale.source_line&&o.date>=previousDate(d.delivery_date,2)&&o.date<=d.delivery_date&&Math.abs(o.amount-sale.amount)<0.01);
    if(candidates.length!==1)continue;
    const o=candidates[0];o.used=true;
    // A receipt amount corroborates a unique order. Composition still requires review, and never drives historical stock.
    sale.items=o.items;sale.product_match='unique_order_amount';sale.product_match_note='Commande rapprochée par montant ; composition à vérifier.';
    d.source_evidence.push(...o.evidence);
  }
  for(const d of days)d.source_evidence=[...new Map(d.source_evidence.map(m=>[m.line,m])).values()].sort((a,b)=>a.line-b.line);
}
