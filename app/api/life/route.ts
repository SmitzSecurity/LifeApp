import { aiSettings } from '@/lib/life/ai-runtime';
import {getLifeIdentity} from '@/lib/auth/runtime';
import { lifeDatabase } from '@/lib/life/database';
import { handleLife } from '@/lib/life/service';
export const dynamic='force-dynamic';
async function dispatch(request:Request){
 try{
 const user=await getLifeIdentity();
 if(!user)return Response.json({error:'Sign in to open your journal.'},{status:401,headers:{'Cache-Control':'private, no-store'}});
 return await handleLife(request,user.id,lifeDatabase(),new Date(),aiSettings());}
 catch{return Response.json({error:'Your journal is temporarily unavailable. Please try again.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
export const GET=dispatch;
export const POST=dispatch;
