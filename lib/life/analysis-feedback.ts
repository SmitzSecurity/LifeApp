import {z} from 'zod/v3';
import {dateSchema,profileSchema} from './domain.ts';
import {cadenceSchema} from './reviews.ts';
import type {Database} from './service.ts';
const schema=z.object({id:z.string().uuid(),text:z.string().trim().min(1).max(500),reportId:z.string().min(1).max(100),date:dateSchema,cadence:cadenceSchema,profileVersion:z.number().int().positive()}).strict();
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
export async function saveAnalysisFeedback(db:Database,userId:string,body:unknown,now:Date){
 const parsed=schema.safeParse(body);if(!parsed.success)return json({error:'Write up to 500 characters of feedback.'},400);
 const input=parsed.data,row=await db.prepare('SELECT payload,version FROM life_profiles WHERE user_id=?1').bind(userId).first<{payload:string;version:number}>();
 if(!row)return json({error:'Save your preferences first.'},400);
 const profile=profileSchema.parse({...JSON.parse(row.payload),version:row.version});
 const existing=profile.analysisGuidance.find(g=>g.id===input.id);
 if(existing)return existing.text===input.text&&existing.sourceDate===input.date&&existing.cadence===input.cadence?json({profile}):json({error:'This feedback changed. Refresh before saving it again.'},409);
 if(profile.version!==input.profileVersion)return json({error:'Your preferences changed in another session. Refresh before saving feedback.'},409);
 if(profile.analysisGuidance.length>=12)return json({error:'Your guidance has 12 saved notes. Edit or remove a note in Settings before adding another.'},409);
 const report=await db.prepare("SELECT request_id FROM life_ai_reviews WHERE user_id=?1 AND request_id=?2 AND entry_date=?3 AND cadence=?4 AND status='complete'").bind(userId,input.reportId,input.date,input.cadence).first();
 if(!report)return json({error:'Open a completed analysis to give feedback.'},409);
 const {version,...data}=profile;
 data.analysisGuidance=[...data.analysisGuidance,{id:input.id,text:input.text,createdAt:now.toISOString(),sourceDate:input.date,cadence:input.cadence}];
 const saved=await db.prepare('UPDATE life_profiles SET payload=?2,version=version+1,updated_at=?3 WHERE user_id=?1 AND version=?4 RETURNING version').bind(userId,JSON.stringify(data),now.toISOString(),version).first<{version:number}>();
 return saved?json({profile:{...data,version:saved.version}}):json({error:'Your preferences changed while saving. Refresh and try again.'},409);
}
