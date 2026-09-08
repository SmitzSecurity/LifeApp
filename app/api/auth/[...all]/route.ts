import {env} from 'cloudflare:workers';
import {googleMode} from '@/lib/auth/config';
import {standaloneAuth} from '@/lib/auth/runtime';
import {handleGoogleAuth} from '@/lib/auth/google';
export const dynamic='force-dynamic';
async function dispatch(request:Request){
 if(!googleMode(env))return Response.json({error:'Not found'},{status:404});
 try{return await handleGoogleAuth(request,standaloneAuth(),env);}catch{return Response.json({error:'Google sign-in is temporarily unavailable. Check the app configuration.'},{status:503});}
}
export const GET=dispatch;
export const POST=dispatch;
