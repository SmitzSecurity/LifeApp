import {z} from 'zod/v3';
import {budgetSchema,categorySchema,monthSchema,transactionSchema,transactionImportReceiptSchema,type Budget,type Saved,type Transaction} from './modules.ts';
import {transactionBuildResult} from './transaction-build-schema.ts';
import {todayIn,type Profile} from './domain.ts';
import {readResource} from './resource-service.ts';
import {visibleBuildSQL} from './record-deletion.ts';
import type {Database} from './service.ts';

export const transactionImportSchema=z.object({
 requestId:z.string().uuid(),buildId:z.string().uuid(),
 months:z.array(z.object({month:monthSchema,initial:budgetSchema,categories:z.array(categorySchema).max(30)}).strict()).min(1).max(24),
 transactions:z.array(z.object({id:z.string().uuid(),version:z.literal(0),data:transactionSchema}).strict()).min(1).max(50),
}).strict();
export type TransactionImport=z.infer<typeof transactionImportSchema>;
export type TransactionImportResult={records:Saved<Transaction>[];plans:Saved<Budget>[];alreadyImported?:boolean;missingTransactionIds?:string[]};
type Receipt=z.infer<typeof transactionImportReceiptSchema>;
type Build={input_snapshot:string;result_json:string;status:string;visible:number};
type Row={resource_id:string;kind:string;payload:string;version:number;updated_at:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(canonical(v))])):value);
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');
const unpack=(r:Row)=>({id:r.resource_id,data:JSON.parse(r.payload),version:r.version,updatedAt:r.updated_at});

async function receiptResult(db:Database,userId:string,receipt:Receipt):Promise<TransactionImportResult>{
 const rows=await db.prepare("SELECT resource_id,kind,payload,version,updated_at FROM life_resources WHERE user_id=?1 AND ((kind='transaction' AND resource_id IN (SELECT value FROM json_each(?2))) OR (kind='budget' AND resource_id IN (SELECT value FROM json_each(?3))))").bind(userId,JSON.stringify(receipt.transactionIds),JSON.stringify(receipt.months)).all<Row>();
 const records=rows.results.filter(r=>r.kind==='transaction').map(unpack),plans=rows.results.filter(r=>r.kind==='budget').map(unpack);
 return {records,plans,alreadyImported:true,missingTransactionIds:receipt.transactionIds.filter(id=>!records.some(r=>r.id===id))};
}

// All plans, rows and the opaque adoption receipt are written by one SQL
// statement. A materialized guard checks the complete pre-write state, so a
// failed category/version/identity check cannot leave a partial financial import.
export async function saveTransactionImport(body:unknown,db:Database,userId:string,profile:Profile|null,now:Date){
 if(!profile||!profile.modules.includes('money'))return json({error:'Enable Budget in Settings first.'},400);
 const parsed=transactionImportSchema.safeParse(body);if(!parsed.success)return json({error:parsed.error.issues[0]?.message||'Review the transactions before saving.'},400);
 const input=parsed.data,requestHash=await hash(input);
 const readReceipt=async()=>{const saved=await readResource(db,userId,'transaction-import',input.buildId);return saved?transactionImportReceiptSchema.parse(saved.data):null;};
 const retry=async(receipt:Receipt)=>receipt.requestId===input.requestId&&receipt.requestHash===requestHash?json(await receiptResult(db,userId,receipt)):json({error:'This draft has already been saved. Its transactions are available in Budget history.',alreadyImported:true},409);
 const existingReceipt=await readReceipt();if(existingReceipt)return retry(existingReceipt);
 const months=input.months.map(m=>m.month),ids=input.transactions.map(t=>t.id),usedMonths=[...new Set(input.transactions.map(t=>t.data.date.slice(0,7)))];
 if(new Set(months).size!==months.length||new Set(ids).size!==ids.length||months.length!==usedMonths.length||months.some(m=>!usedMonths.includes(m)))return json({error:'Include each selected transaction and its month exactly once.'},400);
 const today=todayIn(profile.timezone,now);
 for(const {data:t} of input.transactions){
  if(t.date>today||t.date<'1900-01-01')return json({error:'Use actual transaction dates between 1900 and today.'},400);
  if(!['expense','income','transfer'].includes(t.kind)||t.recurringId!==null||t.voided||t.deleted||t.planned!==undefined||t.expectedDate||t.occurrenceDate||t.incomeDetails||t.incomeSourceId||t.annualFund)return json({error:'Import actual one-off expenses, income or card transfers only.'},400);
  if(t.kind!=='expense'&&(t.categoryId||t.categoryName))return json({error:'Income and card transfers do not use expense categories.'},400);
 }
 const build=await db.prepare(`SELECT b.input_snapshot,b.result_json,b.status,(${visibleBuildSQL('b')}) AS visible FROM life_routine_builds b WHERE user_id=?1 AND request_id=?2`).bind(userId,'budget:'+input.buildId).first<Build>();
 if(!build||build.status!=='complete'||!build.result_json||!build.visible)return json({error:'Open a completed transaction draft that belongs to this account.'},409);
 const snapshot=JSON.parse(build.input_snapshot);
 if(snapshot.intent!=='transactions'||snapshot.purged)return json({error:'This draft is not available for transaction import.'},409);
 const draft=transactionBuildResult.safeParse(JSON.parse(build.result_json));
 if(!draft.success||ids.some(id=>!draft.data.transactions.some(row=>row.id===id)))return json({error:'Keep each transaction linked to its original draft row.'},400);
 const sourceHash=await hash({description:snapshot.description,image:snapshot.image,document:snapshot.document});
 const receipt=transactionImportReceiptSchema.parse({requestId:input.requestId,buildId:input.buildId,requestHash,sourceHash,transactionIds:ids,months});
 for(let attempt=0;attempt<3;attempt++){
  const acknowledged=await readReceipt();if(acknowledged)return retry(acknowledged);
  const duplicate=await db.prepare("SELECT resource_id FROM life_resources WHERE user_id=?1 AND kind='transaction-import' AND (json_extract(payload,'$.sourceHash')=?2 OR json_extract(payload,'$.requestId')=?3) LIMIT 1").bind(userId,sourceHash,input.requestId).first();
  if(duplicate)return json({error:'This source has already been imported. Open Budget history to review its saved transactions.',alreadyImported:true},409);
  const oldRows=await db.prepare("SELECT resource_id FROM life_resources WHERE user_id=?1 AND kind='transaction' AND resource_id IN (SELECT value FROM json_each(?2)) UNION SELECT record_id AS resource_id FROM life_trash WHERE user_id=?1 AND kind='transaction' AND record_id IN (SELECT value FROM json_each(?2))").bind(userId,JSON.stringify(ids)).all<{resource_id:string}>();
  if(oldRows.results.length)return json({error:'A selected transaction was already recorded or deleted. Reopen the draft and review its history.'},409);
  const rows:{kind:string;id:string;period:string;data:unknown;version:number}[]=[],guards:{id:string;version:number}[]=[],plans:Saved<Budget>[]=[];
  for(const month of input.months){
   const saved=await readResource(db,userId,'budget',month.month),current=saved?budgetSchema.parse(saved.data):month.initial;
   // Initializing historical transaction categories must not silently schedule
   // bills, income or loans from another month.
   if(!saved&&(month.initial.recurring.length||month.initial.categories.some(c=>c.limitCents!==0)||Object.values(month.initial.goals).some(Boolean)))return json({error:'Initialize a historical import month with categories only, without allowances, goals or recurring bills.'},400);
   if(new Set(month.categories.map(c=>c.id)).size!==month.categories.length||month.categories.some(c=>c.archived))return json({error:'New categories must have unique identities and be active.'},400);
   const categories=[...current.categories];
   for(const category of month.categories){
    const existing=categories.find(c=>c.id===category.id);
    if(existing){if(canonical(existing)!==canonical(category))return json({error:'A new category changed in another session. Reopen the draft before saving.'},409);}
    else {if(categories.some(c=>c.name.toLocaleLowerCase()===category.name.toLocaleLowerCase()))return json({error:'A category with this name already exists. Select it in the transaction review.'},409);categories.push(category);}
   }
   const data=budgetSchema.safeParse({...current,categories});if(!data.success)return json({error:'This month would exceed the category limit. Choose existing categories or import fewer new ones.'},400);
   for(const record of input.transactions.filter(t=>t.data.date.startsWith(month.month+'-'))){
    const t=record.data,category=categories.find(c=>c.id===t.categoryId);
    if(t.kind==='expense'){
     const reviewed=month.categories.find(c=>c.id===t.categoryId)||month.initial.categories.find(c=>c.id===t.categoryId);
     if(!category||category.archived||!reviewed||reviewed.archived||reviewed.name!==category.name)return json({error:'Choose an active category for every expense. A selected category may have changed; reopen the draft to review it.'},409);
    }
    rows.push({kind:'transaction',id:record.id,period:month.month,version:1,data:{...t,categoryName:t.kind==='expense'?category!.name:''}});
   }
   guards.push({id:month.month,version:saved?.version||0});
   const changed=!saved||canonical(data.data)!==canonical(current);
   if(changed)rows.push({kind:'budget',id:month.month,period:month.month,data:data.data,version:(saved?.version||0)+1});
   plans.push({id:month.month,data:data.data,version:(saved?.version||0)+(changed?1:0),updatedAt:changed?now.toISOString():saved?.updatedAt});
  }
  rows.push({kind:'transaction-import',id:input.buildId,period:'',version:1,data:receipt});
  const written=await db.prepare(`WITH incoming AS MATERIALIZED (SELECT value FROM json_each(?2)), allowed AS MATERIALIZED (
   SELECT 1 AS ok WHERE
   EXISTS(SELECT 1 FROM life_routine_builds b WHERE b.user_id=?1 AND b.request_id=?5 AND b.status='complete' AND b.input_snapshot=?6 AND b.result_json=?7 AND ${visibleBuildSQL('b')})
   AND NOT EXISTS(SELECT 1 FROM life_resources r WHERE r.user_id=?1 AND r.kind='transaction-import' AND (r.resource_id=?8 OR json_extract(r.payload,'$.sourceHash')=?9 OR json_extract(r.payload,'$.requestId')=?10))
   AND NOT EXISTS(SELECT 1 FROM json_each(?4) g LEFT JOIN life_resources r ON r.user_id=?1 AND r.kind='budget' AND r.resource_id=json_extract(g.value,'$.id') WHERE COALESCE(r.version,0)<>json_extract(g.value,'$.version'))
   AND NOT EXISTS(SELECT 1 FROM incoming i JOIN life_resources r ON r.user_id=?1 AND r.kind='transaction' AND r.resource_id=json_extract(i.value,'$.id') WHERE json_extract(i.value,'$.kind')='transaction')
   AND NOT EXISTS(SELECT 1 FROM incoming i JOIN life_trash t ON t.user_id=?1 AND t.kind='transaction' AND t.record_id=json_extract(i.value,'$.id') WHERE json_extract(i.value,'$.kind')='transaction')
  ) INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at,active_slot)
   SELECT ?1,json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.period'),json_extract(value,'$.data'),json_extract(value,'$.version'),?3,NULL FROM incoming WHERE (SELECT ok FROM allowed)=1
   ON CONFLICT(user_id,kind,resource_id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at WHERE excluded.kind='budget' AND life_resources.version=excluded.version-1
   RETURNING resource_id,kind,payload,version,updated_at`).bind(userId,JSON.stringify(rows),now.toISOString(),JSON.stringify(guards),'budget:'+input.buildId,build.input_snapshot,build.result_json,input.buildId,sourceHash,input.requestId).all<Row>();
  if(written.results.length){
   if(written.results.length!==rows.length)throw Error('Import write count mismatch');
   return json({records:written.results.filter(r=>r.kind==='transaction').map(unpack),plans} satisfies TransactionImportResult);
  }
 }
 const saved=await readReceipt();if(saved)return retry(saved);
 return json({error:'Another save changed this draft’s categories or source. Your review is still here; reopen it before trying again.'},409);
}
