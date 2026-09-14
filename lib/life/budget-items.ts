import {z} from 'zod/v3';
import {budgetSchema,categorySchema,recurringSchema,monthSchema,occurrenceId,type Budget,type Saved} from './modules.ts';
import {readResource,saveResource} from './resource-service.ts';
import type {Database} from './service.ts';
import type {Profile} from './domain.ts';

const base={month:monthSchema,initial:budgetSchema.optional()};
const categoryOrder=z.array(categorySchema.shape.id).max(30);
export const budgetItemSchema=z.discriminatedUnion('kind',[
 z.object({...base,kind:z.literal('initialize'),initial:budgetSchema}).strict(),
 z.object({...base,kind:z.literal('category'),previous:categorySchema.nullable(),item:categorySchema}).strict(),
 z.object({...base,kind:z.literal('recurring'),previous:recurringSchema.nullable(),item:recurringSchema}).strict(),
 z.object({...base,kind:z.literal('import'),categories:z.array(z.object({previous:categorySchema.nullable(),item:categorySchema}).strict()).max(20),recurring:z.array(z.object({previous:recurringSchema.nullable(),item:recurringSchema}).strict()).max(30)}).strict(),
 z.object({...base,kind:z.literal('category-order'),previous:categoryOrder,order:categoryOrder}).strict(),
]);
export type BudgetItemChange=z.infer<typeof budgetItemSchema>;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});

// Compare only the edited item, then merge into the latest saved month. A bounded
// CAS retry allows unrelated item saves to coexist without replacing each other.
export async function saveBudgetItem(body:unknown,db:Database,userId:string,profile:Profile|null,now:Date){
 if(!profile)return json({error:'Complete your setup first.'},400);
 const parsed=budgetItemSchema.safeParse(body);
 if(!parsed.success)return json({error:'Check the name, amount and schedule for this item.'},400);
 const change=parsed.data;
 if((change.kind==='category'||change.kind==='recurring')&&change.previous&&change.previous.id!==change.item.id)return json({error:'Keep the original item identity.'},400);
 let latest:Saved<Budget>|null=null;
 for(let attempt=0;attempt<3;attempt++){
  const stored=await readResource(db,userId,'budget',change.month);
  latest=stored?{...stored,data:budgetSchema.parse(stored.data)}:null;
  if(change.kind==='initialize'&&latest)return json({record:latest});
  const current=latest?.data||change.initial;
  if(!current)return json({error:'Reopen this month before saving an item.'},409);
  let data=current;
  if(change.kind==='category-order'){
   const ids=current.categories.map(c=>c.id);
   if(change.order.length!==change.previous.length||new Set(change.order).size!==change.order.length||new Set(change.previous).size!==change.previous.length||change.order.some(id=>!change.previous.includes(id)))return json({error:'Include each category exactly once when changing the order.'},400);
   if(latest&&same(ids,change.order))return json({record:latest});
   if(!same(ids,change.previous))return json({error:'The category list changed in another session. Cancel and reopen Reorder to use its saved order.',record:latest},409);
   data={...current,categories:change.order.map(id=>current.categories.find(c=>c.id===id)!)};
  }else if(change.kind!=='initialize'){
   const edits=change.kind==='import'?[...change.categories.map(c=>({...c,kind:'category' as const})),...change.recurring.map(r=>({...r,kind:'recurring' as const}))]:[change];
   if(edits.some(e=>e.previous&&e.previous.id!==e.item.id)||new Set(edits.map(e=>e.kind+e.item.id)).size!==edits.length)return json({error:'Each draft item must have its own unchanged ID.'},400);
   let changed=false;
   for(const edit of edits){
    const items=edit.kind==='category'?data.categories:data.recurring;
    const existing=items.find(item=>item.id===edit.item.id)||null;
    if(same(existing,edit.item))continue;
    if(!same(existing,edit.previous))return json({error:'This item changed in another session. Cancel and reopen it to use the latest values.',record:latest},409);
    if(change.kind==='import'&&!existing&&items.some(item=>edit.kind==='category'?'name' in item&&item.name.toLowerCase()===edit.item.name.toLowerCase():'title' in item&&item.title.toLowerCase()===edit.item.title.toLowerCase()))return json({error:'An item with this name already exists. Review the draft against the latest budget.',record:latest},409);
    if(edit.kind==='recurring'&&edit.previous&&(edit.previous.kind!==edit.item.kind||edit.previous.categoryId!==edit.item.categoryId)){
     const payment=await readResource(db,userId,'transaction',occurrenceId(change.month,edit.item.id));
     if(payment)return json({error:'This item has a recorded payment. Keep its type and category, or add a new recurring item.'},400);
    }
    if(edit.kind==='category')data={...data,categories:existing?data.categories.map(c=>c.id===edit.item.id?edit.item:c):[...data.categories,edit.item]};
    else data={...data,recurring:existing?data.recurring.map(r=>r.id===edit.item.id?edit.item:r):[...data.recurring,edit.item]};
    changed=true;
   }
   if(!changed&&latest)return json({record:latest});
  }
  const saved=await saveResource({kind:'budget',id:change.month,version:latest?.version||0,data},db,userId,profile,now);
  if(saved.status!==409)return saved;
 }
 return json({error:'Another save is still finishing. Your draft is here; try Save again.',record:latest},409);
}
