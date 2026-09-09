import {googleConfig,permittedGoogleUser,type AuthEnvironment} from './config.ts';
import type {createGoogleAuth} from './google.ts';
import type {Database} from '../life/service.ts';

const FRESH_MS=10*60*1000;
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});

// A separate authenticated endpoint keeps deletion out of profile/check-in saves.
export async function handleAccountDeletion(request:Request,auth:Pick<ReturnType<typeof createGoogleAuth>,'api'>,env:AuthEnvironment,db:Database,now=new Date()){
 if(request.method!=='POST')return json({error:'Not found'},404);
 if(request.headers.get('origin')!==googleConfig(env).origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Open LifeApp directly to delete your account.'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Send JSON'},415);
 const text=await request.text();
 if(new TextEncoder().encode(text).length>1024)return json({error:'Request too large'},413);
 let body;try{body=JSON.parse(text);}catch{return json({error:'Invalid request'},400);}
 if(!body||Array.isArray(body)||typeof body!=='object'||body.confirmation!=='DELETE'||Object.keys(body).some(k=>k!=='confirmation'))return json({error:'Type DELETE to confirm deleting your LifeApp account.'},400);
 const session=await auth.api.getSession({headers:request.headers});
 if(!session||!permittedGoogleUser(env,session.user))return json({error:'Sign in to continue.'},401);
 const createdAt=new Date(session.session.createdAt).valueOf();
 if(!Number.isFinite(createdAt)||createdAt<now.valueOf()-FRESH_MS||createdAt>now.valueOf())return json({error:'For account deletion, sign out and sign in with Google again, then return here within 10 minutes.',code:'reauthenticate'},403);
 try{
  // Recheck the actual session inside the same write that removes it. A session
  // revoked between getSession and this statement cannot authorize deletion.
  const deleted=await db.prepare(`INSERT INTO life_account_deletions(user_id,deleted_at)
   SELECT 'google:'||u.id,?1 FROM life_auth_user u JOIN life_auth_session s ON s.user_id=u.id
   WHERE u.id=?2 AND u.email_verified=1 AND s.id=?3 AND s.expires_at>?4 AND s.created_at>=?5 AND s.created_at<=?4
   ON CONFLICT DO NOTHING RETURNING user_id`).bind(now.toISOString(),session.user.id,session.session.id,now.valueOf(),now.valueOf()-FRESH_MS).first();
  if(!deleted)return json({error:'Your session changed. Sign in again to continue.'},401);
  return json({deleted:true});
 }catch{
  // Trigger failures roll back the complete operation. Never claim deletion on
  // an unknown outcome, and never log personal records or raw storage errors.
  return json({error:'Deletion could not be confirmed. Try again; if you are signed out, sign in to check your account.'},503);
 }
}
