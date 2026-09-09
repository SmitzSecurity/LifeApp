import worker from './index';
import {withoutSitesIdentity,googleConfig} from '../lib/auth/config';
import {scheduledReviewPlanning} from '../lib/life/scheduler';
type Env=Parameters<typeof worker.fetch>[1]&{LIFEAPP_AUTH_MODE?:string;LIFEAPP_REVIEW_PLANNER_ENABLED?:string};
export default {
 async scheduled(controller:{scheduledTime:number},env:Env){
  await scheduledReviewPlanning(env,controller.scheduledTime);
 },
 async fetch(request:Request,env:Env,ctx:Parameters<typeof worker.fetch>[2]){
  if(env.LIFEAPP_AUTH_MODE!=='google')return new Response('LifeApp standalone authentication is not configured.',{status:503});
  try{googleConfig(env);}catch{
   return new Response('LifeApp hosting is connected. Sign-in setup is still in progress.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  return worker.fetch(withoutSitesIdentity(request),env,ctx);
 }
};
