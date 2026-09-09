import worker from './index';
import {withoutSitesIdentity} from '../lib/auth/config';
import {scheduledReviewPlanning} from '../lib/life/scheduler';
type Env=Parameters<typeof worker.fetch>[1]&{LIFEAPP_AUTH_MODE?:string;LIFEAPP_REVIEW_PLANNER_ENABLED?:string};
export default {
 async scheduled(controller:{scheduledTime:number},env:Env){
  await scheduledReviewPlanning(env,controller.scheduledTime);
 },
 async fetch(request:Request,env:Env,ctx:Parameters<typeof worker.fetch>[2]){
  if(env.LIFEAPP_AUTH_MODE!=='google')return new Response('LifeApp standalone authentication is not configured.',{status:503});
  return worker.fetch(withoutSitesIdentity(request),env,ctx);
 }
};
