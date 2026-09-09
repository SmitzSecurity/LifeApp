import worker from './index';
import {withoutSitesIdentity,googleConfig} from '../lib/auth/config';
import {scheduledDailyReviews} from '../lib/life/automatic-reviews';
import type {AIEnvironment} from '../lib/life/ai-configuration';
import type {EmailEnvironment} from '../lib/life/email-configuration';
import {unsubscribeReportEmails} from '../lib/life/email-service';
import {savedDayQuery} from '../lib/life/saved-day-link';
type Env=Parameters<typeof worker.fetch>[1]&AIEnvironment&EmailEnvironment;
export default {
 async scheduled(controller:{scheduledTime:number},env:Env){
  await scheduledDailyReviews(env,controller.scheduledTime);
 },
 async fetch(request:Request,env:Env,ctx:Parameters<typeof worker.fetch>[2]){
  if(new URL(request.url).pathname==='/email/unsubscribe'&&env.DB)return unsubscribeReportEmails(request,env.DB);
  if(env.LIFEAPP_AUTH_MODE!=='google')return new Response('LifeApp standalone authentication is not configured.',{status:503});
  try{googleConfig(env);}catch{
   return new Response('LifeApp hosting is connected. Sign-in setup is still in progress.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  const response=await worker.fetch(withoutSitesIdentity(request),env,ctx);
  const url=new URL(request.url),query=savedDayQuery(url.searchParams.get('date'));
  // Preserve a saved report's date at the HTTP boundary; sign-in still runs normally.
  if(url.pathname==='/'&&query&&[302,303,307,308].includes(response.status)){
   const location=new URL(response.headers.get('Location')||'/',url);
   if(location.origin===url.origin&&location.pathname==='/sign-in'){
    const headers=new Headers(response.headers);headers.set('Location','/sign-in'+query);
    return new Response(response.body,{status:response.status,headers});
   }
  }
  return response;
 }
};
