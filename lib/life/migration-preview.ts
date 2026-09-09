import {z} from 'zod/v3';
import {dateSchema,habitSchema,profileSchema,moduleId,statusSchema} from './domain.ts';
import {resourceKind,resourceSchemas,monthSchema,occurrenceId,type Transaction,type Workout} from './modules.ts';
import {completionIssues,cadenceSchema} from './reviews.ts';
import {analysisWindow} from './analysis-periods.ts';

export const MAX_BACKUP_BYTES=8*1024*1024;
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const version=integer.refine(n=>n>0);
const timestamp=z.string().datetime().refine(s=>{try{return new Date(s).toISOString()===s;}catch{return false;}});
const row=z.object({payload:z.string(),version,updated_at:timestamp}).strict();
const entryRow=row.extend({entry_date:dateSchema});
const resourceRow=row.extend({kind:resourceKind,resource_id:z.string().min(1).max(90),period:z.string().max(7),active_slot:z.literal('active').nullable()});
const id=z.string().min(1).max(100);
const reviewRow=z.object({
 request_id:id,entry_date:dateSchema,revision:version,source_version:version,predecessor_id:id.nullable(),
 cadence:cadenceSchema.optional(),window_start:dateSchema.nullable().optional(),
 critique:z.string().max(1000),status:z.enum(['generating','uncertain','complete','failed']),input_snapshot:z.string().max(48000),
 report_text:z.string().max(200000).nullable(),model:z.string().min(1).max(200),price_version:z.string().min(1).max(200),
 provider_id:z.string().max(500).nullable(),input_tokens:integer.nullable(),output_tokens:integer.nullable(),thought_tokens:integer.nullable(),
 reserved_micros:integer,cost_micros:integer.nullable(),created_at:timestamp,finished_at:timestamp.nullable(),error_code:z.string().max(200).nullable(),
}).strict();
const emailData=z.object({consent:z.object({enabled:z.union([z.literal(0),z.literal(1)]),version,policy_version:z.string().max(100),recipient:z.string().email().max(254),enabled_at:timestamp,updated_at:timestamp}).strict().nullable(),
 deliveries:z.array(z.object({request_id:id,consent_version:version,state:z.enum(['pending','sending','sent','retry','failed','uncertain','cancelled']),attempts:integer,created_at:timestamp,next_attempt_at:timestamp,last_attempt_at:timestamp.nullable(),finished_at:timestamp.nullable(),message_id:z.string().max(500).nullable(),error_code:z.string().max(200).nullable()}).strict()).max(10000)}).strict();
const backupSchema=z.object({format:z.literal('lifeapp-portable-v1'),exportedAt:timestamp,profile:row.nullable(),
 entries:z.array(entryRow).max(10000),resources:z.array(resourceRow).max(10000),reviews:z.array(reviewRow).max(10000),email:emailData.optional(),periodicConsent:z.object({enabled:z.union([z.literal(0),z.literal(1)]),version,policy_version:z.literal('periods-v1'),start_date:dateSchema,accepted_at:timestamp,updated_at:timestamp}).strict().nullable().optional()}).strict();
const entryPayload=z.object({date:dateSchema,journal:z.string().max(6000),context:z.record(moduleId,z.string().max(2000)),
 habits:z.array(habitSchema.omit({archived:true}).extend({status:statusSchema})).max(50),complete:z.boolean().optional(),mutationId:z.string().uuid().optional()}).strict();
type Backup=z.infer<typeof backupSchema>;

// Errors contain fixed codes/locations only, never submitted field names or text.
export class MigrationValidationError extends Error {
 code:string; location:string;
 constructor(code:string,location:string){super(`Backup check failed: ${code} at ${location}.`);this.code=code;this.location=location;}
}
function requireThat(ok:unknown,code:string,location:string):asserts ok{if(!ok)throw new MigrationValidationError(code,location);}
function parseJSON(text:string,location:string):unknown{
 // Bound nesting before JSON.parse, including JSON stored inside payload strings.
 let depth=0,quoted=false,escaped=false;
 for(const ch of text){
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;}
  else if(ch==='"')quoted=true;
  else if(ch==='{'||ch==='['){depth++;requireThat(depth<=48,'too_deep',location);}
  else if(ch==='}'||ch===']')depth--;
 }
 let value:unknown;try{value=JSON.parse(text);}catch{throw new MigrationValidationError('invalid_json',location);}
 const pending=[value];while(pending.length){const item=pending.pop();if(item&&typeof item==='object'){
  for(const key of Object.keys(item)){requireThat(!['__proto__','prototype','constructor'].includes(key),'unsafe_field',location);pending.push((item as Record<string,unknown>)[key]);}
 }}return value;
}
function validate<T>(schema:z.ZodType<T>,value:unknown,location:string):T{
 const parsed=schema.safeParse(value);requireThat(parsed.success,'invalid_shape',location);return parsed.data;
}
function unique(values:string[],location:string){requireThat(new Set(values).size===values.length,'duplicate_record',location);}

/** Validates without normalizing or rewriting stored payloads/versions. */
export function validateBackup(text:string):Backup{
 requireThat(new TextEncoder().encode(text).length<=MAX_BACKUP_BYTES,'too_large','backup');
 const b=validate(backupSchema,parseJSON(text,'backup'),'backup');
 const profile=b.profile?validate(profileSchema,{...validate(z.record(z.unknown()),parseJSON(b.profile.payload,'profile'),'profile'),version:b.profile.version},'profile'):null;
 if(b.profile)requireThat(!Object.hasOwn(JSON.parse(b.profile.payload),'version'),'embedded_version','profile');
 requireThat(profile||!(b.entries.length+b.resources.length+b.reviews.length+(b.periodicConsent?1:0)),'missing_profile','backup');
 unique(b.entries.map(r=>r.entry_date),'entries');unique(b.resources.map(r=>r.kind+':'+r.resource_id),'resources');
 unique(b.reviews.map(r=>r.request_id),'reviews');unique(b.reviews.map(r=>(r.cadence||'daily')+':'+r.entry_date+':'+r.revision),'reviews');
 const entries=new Map(b.entries.map(r=>[r.entry_date,r]));
 for(const [i,r] of b.entries.entries()){
  const at=`entries[${i}]`,e=validate(entryPayload,parseJSON(r.payload,at),at);
  requireThat(e.date===r.entry_date,'date_mismatch',at);unique(e.habits.map(h=>h.id),at);
  requireThat(e.habits.every(h=>profile?.habits.some(p=>p.id===h.id)),'missing_habit',at);
  requireThat(!e.complete||completionIssues(e).length===0,'incomplete_marked_complete',at);
 }
 const resources=new Map(b.resources.map(r=>[r.kind+':'+r.resource_id,r]));
 for(const [i,r] of b.resources.entries()){
  const at=`resources[${i}]`,raw=parseJSON(r.payload,at);
  const parsed=resourceSchemas[r.kind].safeParse(raw);requireThat(parsed.success,'invalid_payload',at);
  const data=parsed.data;
  const expectedPeriod=r.kind==='budget'?r.resource_id:r.kind==='routine'?'':(data as Transaction|Workout).date.slice(0,7);
  requireThat(r.period===expectedPeriod,'period_mismatch',at);
  requireThat(r.active_slot===(r.kind==='workout'&&!(data as Workout).finishedAt?'active':null),'active_workout_mismatch',at);
  if(r.kind==='budget')requireThat(monthSchema.safeParse(r.resource_id).success,'invalid_id',at);
  else if(r.kind==='transaction'){
   const t=data as Transaction;
   requireThat(t.recurringId?r.resource_id===occurrenceId(r.period,t.recurringId):z.string().uuid().safeParse(r.resource_id).success,'invalid_occurrence_id',at);
   const p=resources.get('budget:'+r.period);
   if(t.kind==='expense'||t.recurringId){requireThat(p,'missing_budget',at);
    const budget=resourceSchemas.budget.safeParse(parseJSON(p.payload,at));requireThat(budget.success,'invalid_budget',at);
    if(t.kind==='expense')requireThat(budget.data.categories.some(c=>c.id===t.categoryId),'missing_category',at);
    if(t.recurringId)requireThat(budget.data.recurring.some(x=>x.id===t.recurringId),'missing_recurring_item',at);
   }
  }else{
   requireThat(z.string().uuid().safeParse(r.resource_id).success,'invalid_id',at);
   if(r.kind==='workout')requireThat(resources.has('routine:'+(data as Workout).routineId),'missing_routine',at);
  }
 }
 requireThat(b.resources.filter(r=>r.active_slot==='active').length<=1,'multiple_active_workouts','resources');
 const reviews=new Map(b.reviews.map(r=>[r.request_id,r]));
 for(const [i,r] of b.reviews.entries()){
  const at=`reviews[${i}]`,entry=entries.get(r.entry_date),cadence=r.cadence||'daily';
  requireThat(cadence==='daily'?entry&&r.source_version<=entry.version:profile&&r.source_version<=profile.version,'missing_source_revision',at);
  if(r.revision===1)requireThat(r.request_id===cadence+':'+r.entry_date&&r.predecessor_id===null&&!r.critique,'invalid_initial_review',at);
  else{
   const previous=r.predecessor_id?reviews.get(r.predecessor_id):null;
   requireThat(z.string().uuid().safeParse(r.request_id).success&&previous&&previous.entry_date===r.entry_date&&(previous.cadence||'daily')===cadence&&previous.revision===r.revision-1&&previous.status==='complete'&&r.critique.trim(),'broken_review_chain',at);
  }
  const snapshot=validate(z.object({context:z.record(z.unknown()),previousReview:z.string().nullable(),revisionRequest:z.string().nullable(),automaticConsent:z.object({version:z.number().int().positive(),policyVersion:z.enum(['daily-v1','periods-v1']),startDate:dateSchema,acceptedAt:timestamp}).strict().optional()}).strict(),parseJSON(r.input_snapshot,at),at);
  if(snapshot.automaticConsent)requireThat(r.revision===1&&r.predecessor_id===null&&r.entry_date>=snapshot.automaticConsent.startDate,'automatic_consent_evidence_mismatch',at);
  requireThat(snapshot.context.contractVersion===1,'unknown_evidence_contract',at);
  const window=validate(z.object({from:dateSchema,through:dateSchema}).strict(),snapshot.context.window,at);
  let expected;try{expected=analysisWindow(cadence,r.entry_date);}catch{throw new MigrationValidationError('evidence_window_mismatch',at);}
  requireThat(window.from===expected.from&&window.through===expected.through&&(!r.window_start||r.window_start===expected.from),'evidence_window_mismatch',at);
  if(snapshot.automaticConsent)requireThat(snapshot.automaticConsent.policyVersion===(cadence==='daily'?'daily-v1':'periods-v1'),'automatic_consent_evidence_mismatch',at);
  requireThat(snapshot.revisionRequest===(r.critique||null)&&snapshot.previousReview===(r.predecessor_id?reviews.get(r.predecessor_id)?.report_text:null),'revision_evidence_mismatch',at);
  if(r.status==='complete'||r.status==='failed'){
   requireThat(r.finished_at!==null&&r.cost_micros!==null&&r.input_tokens!==null&&r.output_tokens!==null&&r.thought_tokens!==null,'missing_usage',at);
   requireThat(r.thought_tokens<=r.output_tokens,'invalid_usage',at);
   requireThat(r.status==='complete'?r.report_text?.trim()&&r.error_code===null:r.error_code,'invalid_report_status',at);
  }else{
   requireThat(r.cost_micros===null&&r.report_text===null&&r.input_tokens===null&&r.output_tokens===null&&r.thought_tokens===null,'unreconciled_usage_mismatch',at);
   requireThat(r.status==='generating'?r.finished_at===null&&r.error_code===null:r.finished_at!==null&&!!r.error_code,'invalid_report_status',at);
  }
 }
 if(b.email){
  requireThat(profile||!b.email.consent&&!b.email.deliveries.length,'missing_profile','email');
  unique(b.email.deliveries.map(r=>r.request_id),'email');
  for(const r of b.email.deliveries)requireThat(reviews.has(r.request_id),'missing_report','email');
 }
 return b;
}

function rows(b:Backup){
 return new Map<string,unknown>([
  ...(b.profile?[['profile',b.profile] as [string,unknown]]:[]),
  ...b.entries.map(r=>['entry:'+r.entry_date,r] as [string,unknown]),
  ...b.resources.map(r=>['resource:'+r.kind+':'+r.resource_id,r] as [string,unknown]),
  ...b.reviews.map(r=>['review:'+r.request_id,r] as [string,unknown]),
  ...(b.email?.consent?[['email-consent',b.email.consent] as [string,unknown]]:[]),
  ...(b.email?.deliveries||[]).map(r=>['email-delivery:'+r.request_id,r] as [string,unknown]),
  ...(b.periodicConsent?[['periodic-consent',b.periodicConsent] as [string,unknown]]:[]),
 ]);
}
function sum(values:number[]){let total=0;for(const n of values){total+=n;requireThat(Number.isSafeInteger(total),'usage_overflow','reviews');}return total;}
function summary(b:Backup){return{
 profiles:b.profile?1:0,checkIns:b.entries.length,resources:b.resources.length,reports:b.reviews.length,
 resourceKinds:Object.fromEntries(['budget','transaction','routine','workout','cardio'].map(kind=>[kind,b.resources.filter(r=>r.kind===kind).length])),
 reportStatuses:Object.fromEntries(['complete','failed','generating','uncertain'].map(status=>[status,b.reviews.filter(r=>r.status===status).length])),
 measuredCostMicros:sum(b.reviews.map(r=>r.cost_micros||0)),heldReservationMicros:sum(b.reviews.filter(r=>r.cost_micros===null).map(r=>r.reserved_micros)),
};}
async function digest(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');}

/** Advisory preview only. File possession and hashes do not prove account ownership. */
export async function previewMigration(sourceText:string,targetText?:string){
 const source=validateBackup(sourceText),target=targetText===undefined?null:validateBackup(targetText);
 const sourceRows=rows(source),targetRows=target?rows(target):null;
 let insert=0,identical=0,conflicts=0,targetOnly=0;
 if(targetRows){for(const [key,value] of sourceRows){if(!targetRows.has(key))insert++;else if(JSON.stringify(value)===JSON.stringify(targetRows.get(key)))identical++;else conflicts++;}
  for(const key of targetRows.keys())if(!sourceRows.has(key))targetOnly++;
 }
 const blockers=['ownership_proof_required','apply_not_implemented'];
 if(!target)blockers.push('target_not_compared');
 if(conflicts)blockers.push('conflicting_records');
 if([...source.reviews,...(target?.reviews||[])].some(r=>r.status==='generating'||r.status==='uncertain'))blockers.push('usage_reconciliation_required');
 const active=new Set([...source.resources,...(target?.resources||[])].filter(r=>r.active_slot==='active').map(r=>r.resource_id));
 if(active.size>1)blockers.push('multiple_active_workouts');
 return {format:'lifeapp-migration-preview-v1',validated:true,canApply:false,targetCompared:!!target,
  sourceSha256:await digest(sourceText),targetSha256:targetText===undefined?null:await digest(targetText),
  source:summary(source),target:target?summary(target):null,comparison:target?{insert,identical,conflicts,targetOnly}:null,
  blockers,notes:['No accounts, records, reports, charges or schedules were changed.','Stored payloads and versions must be preserved exactly; conflicts must never overwrite history.','A matching file hash is not proof of ownership or a check of the live destination.','Authenticate both accounts and recheck live data immediately before any future import.']};
}
