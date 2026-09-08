import { z } from 'zod/v3';
export const cadenceSchema=z.enum(['daily','weekly','monthly','annual']);
export type Cadence=z.infer<typeof cadenceSchema>;
const reviewOption=z.object({enabled:z.boolean(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),focus:z.string().trim().max(1500),tone:z.enum(['balanced','gentle','direct']),detail:z.enum(['brief','standard','detailed'])}).strict();
export const reviewPreferencesSchema=z.object({
 intent:z.string().trim().max(1500),daily:reviewOption,weekly:reviewOption,monthly:reviewOption,annual:reviewOption,
 weekDay:z.number().int().min(0).max(6),monthDay:z.number().int().min(1).max(31),annualMonth:z.number().int().min(1).max(12),annualDay:z.number().int().min(1).max(31),
 emailEnabled:z.boolean(),remindersEnabled:z.boolean(),localEventsEnabled:z.boolean(),eventArea:z.string().trim().max(200),biographyEnabled:z.boolean(),biographyFocus:z.string().trim().max(1500)
}).strict();
export function defaultReviewPreferences():z.infer<typeof reviewPreferencesSchema>{const option={enabled:true,time:'08:00',focus:'',tone:'balanced' as const,detail:'standard' as const};return {intent:'',daily:{...option},weekly:{...option},monthly:{...option},annual:{...option},weekDay:1,monthDay:1,annualMonth:1,annualDay:1,emailEnabled:false,remindersEnabled:true,localEventsEnabled:false,eventArea:'',biographyEnabled:false,biographyFocus:''};}
export type ReviewPreferences=z.infer<typeof reviewPreferencesSchema>;
export function previousDay(date:string){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
export function completionIssues(entry:{journal:string;habits:{status:string}[]}):string[]{const issues:string[]=[];if(!entry.journal.trim())issues.push('Add a few words about your day.');const missing=entry.habits.filter(h=>h.status==='unrecorded').length;if(missing)issues.push(`Resolve ${missing} unrecorded habit${missing===1?'':'s'} (done, missed or exempt).`);return issues;}
export type DailyReviewState='disabled'|'missing'|'incomplete'|'already-generated'|'ready';
// Deterministic gate for scheduled runs, manual requests and late-entry completion.
// No AI output is evidence that a missing habit failed.
export function dailyReviewDecision(input:{enabled:boolean;entry?:{complete?:boolean;journal:string;habits:{status:string}[]}|null;existingReportId?:string|null}):{state:DailyReviewState;action:'none'|'reminder'|'hold'|'generate'}{
 if(input.existingReportId)return {state:'already-generated',action:'none'};
 if(!input.enabled)return {state:'disabled',action:'none'};
 if(!input.entry)return {state:'missing',action:'reminder'};
 if(!input.entry.complete||completionIssues(input.entry).length)return {state:'incomplete',action:'hold'};
 return {state:'ready',action:'generate'};
}
export type ReviewRecord={id:string;cadence:Cadence;from:string;through:string;status:'complete'|'failed';revision:number;content:string};
export function priorReviewEvidence(cadence:Cadence,from:string,through:string,reports:ReviewRecord[]){
 const allowed:Record<Cadence,Cadence[]>={daily:[],weekly:['daily'],monthly:['daily','weekly'],annual:['daily','weekly','monthly']};
 // Prior generated prose is supporting interpretation, never a substitute for source entries.
 const eligible=reports.filter(r=>r.status==='complete'&&allowed[cadence].includes(r.cadence)&&r.from>=from&&r.through<=through);
 const latest=new Map<string,ReviewRecord>();for(const r of eligible){const key=r.cadence+':'+r.from+':'+r.through;const prior=latest.get(key);if(!prior||r.revision>prior.revision)latest.set(key,r);}
 return [...latest.values()].sort((a,b)=>a.through.localeCompare(b.through));
}
export function dailyJobKey(userId:string,date:string){return `${userId}:daily:${date}:initial`;}
export function lateCompletionAction(input:{dailyEnabled:boolean;triggerAlreadyDue:boolean;wasComplete:boolean;entry:{complete?:boolean;journal:string;habits:{status:string}[]};existingReportId?:string|null}){
 if(!input.triggerAlreadyDue||input.wasComplete)return 'none';
 return dailyReviewDecision({enabled:input.dailyEnabled,entry:input.entry,existingReportId:input.existingReportId}).action==='generate'?'enqueue-now':'none';
}
