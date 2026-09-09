import {env} from 'cloudflare:workers';
import {getLifeIdentity} from '@/lib/auth/runtime';
import {lifeDatabase} from '@/lib/life/database';
import {settingsForEmail} from '@/lib/life/email-configuration';
import {handleEmailSettings} from '@/lib/life/email-service';
export const dynamic='force-dynamic';
async function dispatch(request:Request){
 try{const identity=await getLifeIdentity();return await handleEmailSettings(request,identity?.id||null,lifeDatabase(),settingsForEmail(env));}
 catch{return Response.json({error:'Report email settings are temporarily unavailable. Your saved choice has not been changed.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
export const GET=dispatch;
export const POST=dispatch;
