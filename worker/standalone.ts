import worker from './index';
import {withoutSitesIdentity} from '../lib/auth/config';
type Env=Parameters<typeof worker.fetch>[1]&{LIFEAPP_AUTH_MODE?:string};
export default {
 async fetch(request:Request,env:Env,ctx:Parameters<typeof worker.fetch>[2]){
  if(env.LIFEAPP_AUTH_MODE!=='google')return new Response('LifeApp standalone authentication is not configured.',{status:503});
  return worker.fetch(withoutSitesIdentity(request),env,ctx);
 }
};
