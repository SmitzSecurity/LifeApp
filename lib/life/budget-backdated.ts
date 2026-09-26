import {budgetSchema,type Budget,type Saved} from './modules.ts';
import {todayIn,type Profile} from './domain.ts';
import {readResource} from './resource-service.ts';
import type {Database} from './service.ts';
import type {BudgetItemChange} from './budget-items.ts';

type Change=Extract<BudgetItemChange,{kind:'recurring'}>;
type Row={resource_id:string;payload:string;version:number;updated_at:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

// A new schedule explicitly starting before the viewed month must exist at its
// anchor, including when that month has never been opened. Merge only this new
// identity into intervening saved snapshots; never copy a future plan backward.
// All touched plans share one materialized CAS guard and one atomic statement.
export async function saveBackdatedRecurring(change:Change,db:Database,userId:string,profile:Profile,now:Date){
 if(!profile.modules.includes('money'))return json({error:'Enable Budget in Settings first.'},400);
 const start=change.item.startDate!.slice(0,7);
 if(change.item.deleted||change.item.purged)return json({error:'Create an available recurring item before backdating its start.'},400);
 if(change.item.debt&&(change.item.debt.balanceDate>todayIn(profile.timezone,now)||change.item.debt.balanceDate<'1900-01-01'))return json({error:'Use a statement balance date between 1900 and today.'},400);
 for(let attempt=0;attempt<3;attempt++){
  const selected=await readResource(db,userId,'budget',change.month),current=selected?budgetSchema.parse(selected.data):change.initial;
  if(!current)return json({error:'Reopen this month before saving an item.'},409);
  const existing=current.recurring.find(r=>r.id===change.item.id);
  // The earlier write was atomic. Once its selected-month snapshot is present,
  // acknowledge it without resurrecting a subsequently deleted earlier copy.
  if(selected&&existing){
   if(!same(existing,change.item))return json({error:'This item changed in another session. Cancel and reopen it.',record:selected},409);
   const earlier=await db.prepare("SELECT resource_id,payload,version,updated_at FROM life_resources WHERE user_id=?1 AND kind='budget' AND resource_id>=?2 AND resource_id<?3 ORDER BY resource_id LIMIT 121").bind(userId,start,change.month).all<Row>();
   return json({record:selected,plans:earlier.results.map(row=>({id:row.resource_id,data:JSON.parse(row.payload),version:row.version,updatedAt:row.updated_at}))});
  }
  const category=current.categories.find(c=>c.id===change.item.categoryId);
  if(change.item.kind==='expense'&&!category)return json({error:'Choose a category for this recurring expense.'},400);
  const prior=await db.prepare("SELECT resource_id,payload,version,updated_at FROM life_resources WHERE user_id=?1 AND kind='budget' AND resource_id>=?2 AND resource_id<?3 ORDER BY resource_id LIMIT 121").bind(userId,start,change.month).all<Row>();
  if(prior.results.length>120)return json({error:'This start spans too many saved plans. Choose a more recent start date.'},400);
  const months=[...new Set([start,...prior.results.map(row=>row.resource_id),change.month])];
  const retired=await db.prepare("SELECT 1 FROM life_trash WHERE user_id=?1 AND kind='recurring' AND substr(record_id,9)=?2 AND substr(record_id,1,7) IN (SELECT value FROM json_each(?3)) LIMIT 1").bind(userId,change.item.id,JSON.stringify(months)).first();
  if(retired)return json({error:'This recurring identity was deleted. Add a new item instead.'},410);
  const rows:{id:string;data:Budget;version:number}[]=[],guards:{id:string;version:number}[]=[];
  for(const month of months){
   const saved=month===change.month?selected:prior.results.find(row=>row.resource_id===month);
   const previous:Budget=month===change.month?current:saved?budgetSchema.parse('payload' in saved?JSON.parse(saved.payload):saved.data):budgetSchema.parse({currency:'USD',categories:current.categories.map(c=>({...c,limitCents:0})),recurring:[],goals:{spending:'',saving:'',investing:''}});
   const duplicate=previous.recurring.find(r=>r.id===change.item.id);
   if(duplicate&&!same(duplicate,change.item))return json({error:'This recurring item already has different values in an earlier month. Review that month before saving.'},409);
   const data=budgetSchema.safeParse({...previous,categories:category&&!previous.categories.some(c=>c.id===category.id)?[...previous.categories,{...category,limitCents:0}]:previous.categories,recurring:duplicate?previous.recurring:[...previous.recurring,change.item]});
   if(!data.success)return json({error:'An earlier month has no room for this item or its category. Review that month before saving.'},400);
   guards.push({id:month,version:saved?.version||0});
   if(!saved||!same(previous,data.data))rows.push({id:month,data:data.data,version:(saved?.version||0)+1});
  }
  const written=await db.prepare(`WITH incoming AS MATERIALIZED (SELECT value FROM json_each(?2)), allowed AS MATERIALIZED (
   SELECT 1 AS ok WHERE
   NOT EXISTS(SELECT 1 FROM json_each(?4) g LEFT JOIN life_resources r ON r.user_id=?1 AND r.kind='budget' AND r.resource_id=json_extract(g.value,'$.id') WHERE COALESCE(r.version,0)<>json_extract(g.value,'$.version'))
   AND (SELECT count(*) FROM life_resources WHERE user_id=?1 AND kind='budget' AND resource_id>=?5 AND resource_id<?6)=?7
   AND NOT EXISTS(SELECT 1 FROM life_trash t JOIN incoming i ON t.record_id=json_extract(i.value,'$.id')||':'||?8 WHERE t.user_id=?1 AND t.kind='recurring')
  ) INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at,active_slot)
   SELECT ?1,'budget',json_extract(value,'$.id'),json_extract(value,'$.id'),json_extract(value,'$.data'),json_extract(value,'$.version'),?3,NULL FROM incoming WHERE (SELECT ok FROM allowed)=1
   ON CONFLICT(user_id,kind,resource_id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at WHERE life_resources.version=excluded.version-1
   RETURNING resource_id,payload,version,updated_at`).bind(userId,JSON.stringify(rows),now.toISOString(),JSON.stringify(guards),start,change.month,prior.results.length,change.item.id).all<Row>();
  if(written.results.length){
   if(written.results.length!==rows.length)throw Error('Recurring write count mismatch');
   const records:Saved<Budget>[]=written.results.map(row=>({id:row.resource_id,data:JSON.parse(row.payload),version:row.version,updatedAt:row.updated_at}));
   return json({record:records.find(r=>r.id===change.month),plans:records});
  }
 }
 return json({error:'Another save changed one of these months. Your draft is here; try Save again.'},409);
}
