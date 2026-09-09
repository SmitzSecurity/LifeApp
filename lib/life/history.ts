import {z} from 'zod/v3';
import {dateSchema,type Entry} from './domain.ts';
import type {Database} from './service.ts';

export const HISTORY_PAGE_SIZE=30;
const optionalDate=z.union([dateSchema,z.literal('')]).default('');
export const historyFiltersSchema=z.object({
 query:z.string().trim().max(200).default(''),
 from:optionalDate,
 through:optionalDate,
 status:z.enum(['all','complete','draft']).default('all'),
 before:dateSchema.nullable().default(null),
}).strict().refine(f=>!f.from||!f.through||f.from<=f.through,{message:'Choose an end date on or after the start date.'});
export type HistoryFilters=z.infer<typeof historyFiltersSchema>;
export type HistoryPage={entries:Entry[];nextCursor:string|null};

// Search is a read-only JSON POST so private search text is not put in URLs.
// Dates are unique per account; keyset paging avoids offset shifts when a new day is saved.
export async function readHistory(db:Database,userId:string,body:unknown){
 const parsed=historyFiltersSchema.safeParse(body);
 const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
 if(!parsed.success)return Response.json({error:'Check the search text (up to 200 characters) and date range.'},{status:400,headers});
 const f=parsed.data,where=['user_id=?'],params:unknown[]=[userId];
 if(f.from){where.push('entry_date>=?');params.push(f.from);}
 if(f.through){where.push('entry_date<=?');params.push(f.through);}
 if(f.before){where.push('entry_date<?');params.push(f.before);}
 if(f.status!=='all')where.push(`COALESCE(json_extract(payload,'$.complete'),0)${f.status==='complete'?'=1':'<>1'}`);
 if(f.query){
  where.push("COALESCE(json_extract(payload,'$.journal'),'') LIKE ? ESCAPE '\\'");
  params.push('%'+f.query.replace(/[\\%_]/g,'\\$&')+'%');
 }
 const result=await db.prepare(`SELECT entry_date,payload,version,updated_at FROM life_entries WHERE ${where.join(' AND ')} ORDER BY entry_date DESC LIMIT ${HISTORY_PAGE_SIZE+1}`).bind(...params).all<{entry_date:string;payload:string;version:number;updated_at:string}>();
 const rows=result.results.slice(0,HISTORY_PAGE_SIZE);
 const page:HistoryPage={entries:rows.map(row=>({...JSON.parse(row.payload),date:row.entry_date,version:row.version,updatedAt:row.updated_at})),nextCursor:result.results.length>HISTORY_PAGE_SIZE?rows.at(-1)!.entry_date:null};
 return Response.json(page,{headers});
}
