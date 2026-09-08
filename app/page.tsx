import { headers } from "next/headers";
import { requireChatGPTUser } from "./chatgpt-auth";
import LifeApp from "./life-app";
import {env} from 'cloudflare:workers';
import {redirect} from 'next/navigation';
import {googleMode} from '@/lib/auth/config';
import {getLifeIdentity} from '@/lib/auth/runtime';
export const dynamic = "force-dynamic";
export default async function Home() {
  if(googleMode(env)){
    let user=null;try{user=await getLifeIdentity();}catch{}
    if(!user)redirect('/sign-in');
    return <LifeApp signOutHref="/sign-out"/>;
  }
  await requireChatGPTUser("/");
  const h = await headers();
  if (!h.get("oai-authenticated-user-id")) return <main className="auth-message"><h1>LifeApp</h1><p>Your secure session is unavailable. Please sign in again.</p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in</a></main>;
  return <LifeApp />;
}
