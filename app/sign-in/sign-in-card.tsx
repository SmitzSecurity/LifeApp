'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
export default function SignInCard({ready}:{ready:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function signIn(){setBusy(true);setError('');try{
  const response=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:'/'})});
  const data=await response.json();if(!response.ok||!data.url)throw Error('Google sign-in could not start. Please try again.');
  const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='accounts.google.com')throw Error('The sign-in address could not be verified.');
  window.location.assign(url.href);
 }catch(e){setError((e as Error).message);setBusy(false);}}
 return <main className="onboarding"><div className="eyebrow">LIFEAPP · PRIVATE BETA</div><h1>A little attention, every day.</h1><p className="intro">Your habits, journal and goals in one private space.</p><Button disabled={!ready||busy} onClick={signIn}>{busy?'Opening Google…':'Continue with Google'}</Button>{!ready&&<p className="notice">The owner is finishing Google sign-in setup. Please check back shortly.</p>}{error&&<p className="error" role="alert">{error}</p>}<p className="privacy-note">Sign-in uses your name and email. Connecting Google Calendar, Drive or Gmail will be a separate choice. Access is currently limited to invited beta accounts.</p></main>;
}
