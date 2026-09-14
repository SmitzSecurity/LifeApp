import {monthSchema,budgetSchema,transactionSchema} from './modules.ts';
import {readResource} from './resource-service.ts';
import type {Database} from './service.ts';
export async function readDebtPayments(request:Request,db:Database,userId:string){
 const month=monthSchema.safeParse(new URL(request.url).searchParams.get('month'));
 const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
 if(!month.success)return reply({error:'Choose a valid month.'},400);
 let saved=await readResource(db,userId,'budget',month.data);
 if(!saved){const prior=await db.prepare("SELECT resource_id,payload,version FROM life_resources WHERE user_id=?1 AND kind='budget' AND period<?2 ORDER BY period DESC LIMIT 1").bind(userId,month.data).first<{resource_id:string;payload:string;version:number}>();if(prior)saved={id:prior.resource_id,data:JSON.parse(prior.payload),version:prior.version,updatedAt:''};}
 const ids=saved?budgetSchema.parse(saved.data).recurring.filter(r=>r.debt&&!r.deleted).map(r=>r.id):[];
 if(!ids.length)return reply({records:[]});
 const result=await db.prepare(`SELECT resource_id,payload,version,updated_at FROM life_resources WHERE user_id=?1 AND kind='transaction' AND json_extract(payload,'$.recurringId') IN (SELECT value FROM json_each(?2)) ORDER BY period,resource_id LIMIT 5001`).bind(userId,JSON.stringify(ids)).all<{resource_id:string;payload:string;version:number;updated_at:string}>();
 if(result.results.length>5000)return reply({error:'There are too many loan payments to calculate a complete estimate. Update the balance from your statement.'},413);
 return reply({records:result.results.map(r=>({id:r.resource_id,data:transactionSchema.parse(JSON.parse(r.payload)),version:r.version,updatedAt:r.updated_at}))});
}
