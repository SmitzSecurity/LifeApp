import {z} from 'zod/v3';
import type {Database} from './service.ts';

export const EMAIL_POLICY='full-report-v1';
export const EMAIL_BATCH_SIZE=2;
export type EmailMessage={from:string;to:string;subject:string;text:string;html:string;headers:Record<string,string>};
export type EmailSettings={enabled:boolean;from:string;origin:string;send:((message:EmailMessage)=>Promise<{messageId:string}>)|null;allowedEmails:string[]};
export type EmailConsent={enabled:boolean;version:number;policyVersion:string;recipient:string|null;enabledAt:string|null};
type ConsentRow={enabled:number;version:number;policy_version:string;recipient:string;enabled_at:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
export const emailAvailable=(settings:EmailSettings)=>settings.enabled&&!!settings.send&&!!settings.from&&!!settings.origin;
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const inputSchema=z.object({enabled:z.boolean(),version:z.number().int().nonnegative(),policyVersion:z.literal(EMAIL_POLICY)}).strict();

export async function emailStatus(db:Database,userId:string,settings:EmailSettings){
 const row=await db.prepare('SELECT enabled,version,policy_version,recipient,enabled_at FROM life_email_consent WHERE user_id=?1').bind(userId).first<ConsentRow>();
 const user=await db.prepare("SELECT email FROM life_auth_user WHERE 'google:'||id=?1 AND email_verified=1").bind(userId).first<{email:string}>();
 const consent:EmailConsent={enabled:!!row?.enabled&&row.policy_version===EMAIL_POLICY&&row.recipient===user?.email,version:row?.version||0,policyVersion:EMAIL_POLICY,recipient:user?.email||null,enabledAt:row?.enabled_at||null};
 const deliveries=await db.prepare(`SELECT o.request_id AS reportId,r.entry_date AS date,r.revision,o.state,o.attempts,o.created_at AS createdAt,o.finished_at AS finishedAt,o.error_code AS errorCode
 FROM life_email_outbox o JOIN life_ai_reviews r ON r.user_id=o.user_id AND r.request_id=o.request_id WHERE o.user_id=?1 ORDER BY o.created_at DESC LIMIT 20`).bind(userId).all();
 return json({consent,available:emailAvailable(settings),sender:settings.from||null,deliveries:deliveries.results});
}

export async function saveEmailConsent(db:Database,userId:string,body:unknown,settings:EmailSettings,now:Date){
 const parsed=inputSchema.safeParse(body);if(!parsed.success)return json({error:'Review the full-report email choice and try again.'},400);
 const input=parsed.data;
 if(input.enabled&&!emailAvailable(settings))return json({error:'Report email delivery is awaiting sender activation.'},503);
 const user=await db.prepare("SELECT email FROM life_auth_user WHERE 'google:'||id=?1 AND email_verified=1 AND EXISTS(SELECT 1 FROM life_auth_account a WHERE a.user_id=life_auth_user.id AND a.provider_id='google')").bind(userId).first<{email:string}>();
 if(!user)return json({error:'Sign in with your verified Google account.'},401);
 if(input.enabled&&!settings.allowedEmails.includes(user.email.toLowerCase()))return json({error:'Report emails are limited to the active private beta accounts.'},403);
 const row=await db.prepare(`INSERT INTO life_email_consent(user_id,enabled,version,policy_version,recipient,enabled_at,updated_at,unsubscribe_token)
 SELECT ?1,?2,1,?3,?4,?5,?5,?6 WHERE EXISTS(SELECT 1 FROM life_profiles WHERE user_id=?1)
 AND EXISTS(SELECT 1 FROM life_auth_user u JOIN life_auth_account a ON a.user_id=u.id WHERE 'google:'||u.id=?1 AND u.email=?4 AND u.email_verified=1 AND a.provider_id='google')
 AND (?7=0 OR EXISTS(SELECT 1 FROM life_email_consent WHERE user_id=?1))
 ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,version=life_email_consent.version+1,policy_version=excluded.policy_version,
 recipient=excluded.recipient,enabled_at=CASE WHEN excluded.enabled=1 THEN excluded.enabled_at ELSE life_email_consent.enabled_at END,
 updated_at=excluded.updated_at WHERE life_email_consent.version=?7 RETURNING version`).bind(userId,input.enabled?1:0,EMAIL_POLICY,user.email,now.toISOString(),token(),input.version).first();
 if(!row)return json({error:'Your choice changed in another session, or setup is incomplete. Refresh before choosing again.'},409);
 return emailStatus(db,userId,settings);
}

export async function handleEmailSettings(request:Request,userId:string|null,db:Database,settings:EmailSettings,now=new Date()){
 if(!userId)return json({error:'Sign in to manage report emails.'},401);
 if(request.method==='GET')return emailStatus(db,userId,settings);
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Open LifeApp directly to change report emails.'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Expected JSON.'},415);
 const text=await request.text();if(new TextEncoder().encode(text).length>2048)return json({error:'Request too large.'},413);
 let body;try{body=JSON.parse(text);}catch{return json({error:'Invalid request.'},400);}
 return saveEmailConsent(db,userId,body,settings,now);
}

export function reportEmail(input:{date:string;revision:number;text:string;recipient:string;unsubscribeToken:string},settings:Pick<EmailSettings,'from'|'origin'>):EmailMessage{
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const url=settings.origin+'/?date='+encodeURIComponent(input.date);
 const unsubscribe=settings.origin+'/email/unsubscribe?token='+input.unsubscribeToken;
 const title=`Your LifeApp review · ${input.date}${input.revision>1?' · revision '+input.revision:''}`;
 const footer='This is the saved AI report. It can be mistaken; your own judgment matters. You chose full-report emails in LifeApp.';
 return {from:settings.from,to:input.recipient,subject:title,
  text:`${title}\n\n${input.text}\n\nOpen your saved day: ${url}\n\n${footer}\nStop report emails: ${unsubscribe}`,
  html:`<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f6f7f3;color:#203a35;font-family:Arial,sans-serif"><main style="max-width:620px;margin:auto;background:#fff;padding:32px;border:1px solid #e2e8de;border-radius:12px"><p style="font-size:12px;letter-spacing:2px;color:#6c7e70">LIFEAPP · ONE DAY AT A TIME</p><h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px">${escape(title)}</h1><div style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8">${escape(input.text)}</div><p style="margin-top:28px"><a href="${escape(url)}" style="color:#286349">Open your saved day</a></p><p style="font-size:12px;line-height:1.6;color:#6c7e70">${footer}</p><p style="font-size:12px"><a href="${escape(unsubscribe)}" style="color:#6c7e70">Stop report emails</a></p></main></body></html>`,
  headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}
 };
}

export async function consumeReportEmails(db:Database,settings:EmailSettings,clock=()=>new Date()){
 const stats={sent:0,retry:0,failed:0,uncertain:0};if(!emailAvailable(settings))return stats;
 const now=clock();
 // A crash after sending might have delivered the email. Never retry that blindly.
 await db.prepare("UPDATE life_email_outbox SET state='uncertain',error_code='delivery_unconfirmed',finished_at=?1 WHERE rowid IN (SELECT rowid FROM life_email_outbox WHERE state='sending' AND last_attempt_at<?2 LIMIT 20) RETURNING request_id").bind(now.toISOString(),new Date(now.valueOf()-10*60000).toISOString()).all();
 const candidates=await db.prepare("SELECT user_id,request_id FROM life_email_outbox WHERE state IN ('pending','retry') AND next_attempt_at<=?1 ORDER BY next_attempt_at,user_id,request_id LIMIT ?2").bind(now.toISOString(),EMAIL_BATCH_SIZE).all<{user_id:string;request_id:string}>();
 for(const item of candidates.results){
  const stamp=clock();
  const claim=await db.prepare(`UPDATE life_email_outbox SET state='sending',attempts=attempts+1,last_attempt_at=?3,error_code=NULL
   WHERE user_id=?1 AND request_id=?2 AND state IN ('pending','retry') AND next_attempt_at<=?3
   AND EXISTS(SELECT 1 FROM life_email_consent c JOIN life_auth_user u ON 'google:'||u.id=c.user_id
    JOIN life_ai_reviews r ON r.user_id=c.user_id AND r.request_id=?2
    WHERE c.user_id=?1 AND c.enabled=1 AND c.policy_version='full-report-v1' AND c.version=life_email_outbox.consent_version
    AND c.recipient=u.email AND u.email_verified=1 AND r.status='complete' AND length(r.report_text)>0
    AND EXISTS(SELECT 1 FROM life_auth_account a WHERE a.user_id=u.id AND a.provider_id='google'))
   RETURNING attempts,
   (SELECT recipient FROM life_email_consent WHERE user_id=?1) AS recipient,
   (SELECT unsubscribe_token FROM life_email_consent WHERE user_id=?1) AS unsubscribeToken,
   (SELECT entry_date FROM life_ai_reviews WHERE user_id=?1 AND request_id=?2) AS date,
   (SELECT revision FROM life_ai_reviews WHERE user_id=?1 AND request_id=?2) AS revision,
   (SELECT report_text FROM life_ai_reviews WHERE user_id=?1 AND request_id=?2) AS text`).bind(item.user_id,item.request_id,stamp.toISOString()).first<{attempts:number;recipient:string;unsubscribeToken:string;date:string;revision:number;text:string}>();
  if(!claim){
   await db.prepare("UPDATE life_email_outbox SET state='cancelled',finished_at=?3,error_code='no_longer_eligible' WHERE user_id=?1 AND request_id=?2 AND state IN ('pending','retry') RETURNING request_id").bind(item.user_id,item.request_id,stamp.toISOString()).first();continue;
  }
  let state:'sent'|'retry'|'failed'|'uncertain'='uncertain',messageId:string|null=null,errorCode:string|null='delivery_unconfirmed';
  try{
   if(!settings.allowedEmails.includes(claim.recipient.toLowerCase())){state='failed';errorCode='recipient_not_in_beta';}
   else{
    const result=await settings.send!(reportEmail(claim,settings));
    if(typeof result?.messageId==='string'&&result.messageId.length>0){state='sent';messageId=result.messageId.slice(0,500);errorCode=null;}
   }
  }catch(error){
   const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
   // Retry only explicit pre-delivery rejection. Transport/internal errors are ambiguous.
   if(['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED'].includes(code)){state=claim.attempts<5?'retry':'failed';errorCode='sending_limit';}
   else if(['E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_SUPPRESSED','E_VALIDATION_ERROR','E_CONTENT_TOO_LARGE','E_HEADER_NOT_ALLOWED'].includes(code)){state='failed';errorCode='sending_rejected';}
  }
  const next=new Date(stamp.valueOf()+Math.min(6*3600000,300000*2**claim.attempts)).toISOString();
  await db.prepare("UPDATE life_email_outbox SET state=?3,message_id=?4,error_code=?5,finished_at=?6,next_attempt_at=?7 WHERE user_id=?1 AND request_id=?2 AND state='sending' RETURNING request_id").bind(item.user_id,item.request_id,state,messageId,errorCode,state==='retry'?null:clock().toISOString(),next).first();
  stats[state]++;
 }
 return stats;
}

export async function unsubscribeReportEmails(request:Request,db:Database,now=new Date()){
 const key=new URL(request.url).searchParams.get('token');
 const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
 if(!key||!/^([a-f0-9]{64})$/.test(key))return new Response('This unsubscribe link is invalid.',{status:400,headers});
 if(request.method==='GET')return new Response('<!doctype html><html><head><title>Stop LifeApp report emails</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Stop report emails?</h1><p>This turns off future report emails. Your journal and saved reviews stay in LifeApp. An email already being sent may still arrive.</p><form method="post"><button type="submit">Stop report emails</button></form><p><a href="/">Return to LifeApp</a></p></main></body></html>',{headers});
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers});
 // The random capability can only disable email; GET/scanner previews never mutate.
 await db.prepare('UPDATE life_email_consent SET enabled=0,version=version+1,updated_at=?2 WHERE unsubscribe_token=?1 AND enabled=1 RETURNING user_id').bind(key,now.toISOString()).first();
 return new Response('<!doctype html><html><head><title>Report emails stopped</title></head><body><h1>Report emails are off.</h1><p>You can choose to turn them on again in LifeApp. An email already being sent may still arrive.</p><a href="/">Return to LifeApp</a></body></html>',{headers});
}
