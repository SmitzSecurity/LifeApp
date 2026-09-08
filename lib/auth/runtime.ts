import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import type {AnyD1Database} from 'drizzle-orm/d1';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {googleMode} from './config';
import {createGoogleAuth,googleIdentity} from './google';
export function standaloneAuth(){return createGoogleAuth(env.DB as unknown as AnyD1Database,env);}
export async function getLifeIdentity(){
 const h=new Headers(await headers());
 if(googleMode(env))return googleIdentity(standaloneAuth(),h,env);
 if(env.LIFEAPP_AUTH_MODE&&env.LIFEAPP_AUTH_MODE!=='sites')throw Error('Unknown authentication mode');
 const user=await getChatGPTUser(),id=h.get('oai-authenticated-user-id');
 return user&&id?{id,email:user.email}:null;
}
