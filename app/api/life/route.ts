import { aiSettings } from '@/lib/life/ai-runtime';
import {getLifeIdentity} from '@/lib/auth/runtime';
import { lifeDatabase } from '@/lib/life/database';
import { handleLife } from '@/lib/life/service';
export const dynamic='force-dynamic';
async function dispatch(request:Request){
 try{
 const user=await getLifeIdentity();
 if(!user)return Response.json({error:'Sign in to open your journal.'},{status:401,headers:{'Cache-Control':'private, no-store'}});
 // A reconnecting browser may still contain another account's local queue.
 // Check the opaque account on each request, including the final write, so a
 // sign-in change cannot race the client's read-only identity check.
 const expected=request.headers.get('X-Life-Account');
 if(expected&&expected!==user.id)return Response.json({error:'The signed-in account changed. Reload LifeApp to continue.'},{status:409,headers:{'Cache-Control':'private, no-store','X-Life-Account':user.id}});
 if(new URL(request.url).searchParams.has('offline-account'))return Response.json({ready:true},{headers:{'Cache-Control':'private, no-store','X-Life-Account':user.id}});
 const response=await handleLife(request,user.id,lifeDatabase(),new Date(),aiSettings());
 response.headers.set('X-Life-Account',user.id);return response;}
 catch{return Response.json({error:'Your journal is temporarily unavailable. Please try again.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
export const GET=dispatch;
export const POST=dispatch;
