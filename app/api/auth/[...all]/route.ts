import {env} from 'cloudflare:workers';
import {googleMode} from '@/lib/auth/config';
import {standaloneAuth} from '@/lib/auth/runtime';
import {handleGoogleAuth} from '@/lib/auth/google';
import {handleAccountDeletion} from '@/lib/auth/delete-account';
export const dynamic='force-dynamic';
async function dispatch(request:Request){
 if(!googleMode(env))return Response.json({error:'Not found'},{status:404});
 try{
  if(new URL(request.url).pathname==='/api/auth/delete-account'){
   if(!env.DB)return Response.json({error:'Account storage is unavailable.'},{status:503});
   return await handleAccountDeletion(request,standaloneAuth(),env,env.DB);
  }
  return await handleGoogleAuth(request,standaloneAuth(),env);
 }catch{return Response.json({error:'Google sign-in is temporarily unavailable. Check the app configuration.'},{status:503});}
}
export const GET=dispatch;
export const POST=dispatch;
