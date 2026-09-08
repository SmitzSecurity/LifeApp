import {env} from 'cloudflare:workers';
import {redirect} from 'next/navigation';
import {googleConfig,googleMode} from '@/lib/auth/config';
import SignInCard from './sign-in-card';
export const dynamic='force-dynamic';
export default function SignIn(){
 if(!googleMode(env))redirect('/signin-with-chatgpt?return_to=%2F');
 let ready=false;try{googleConfig(env);ready=!!env.DB;}catch{}
 return <SignInCard ready={ready}/>;
}
