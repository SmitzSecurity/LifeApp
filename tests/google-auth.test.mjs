import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {SignJWT,generateKeyPair,exportJWK} from 'jose';
import {createGoogleAuth,handleGoogleAuth,googleIdentity} from '../lib/auth/google.ts';
import {googleConfig,permittedGoogleUser,withoutSitesIdentity} from '../lib/auth/config.ts';
const env={LIFEAPP_AUTH_MODE:'google',BETTER_AUTH_URL:'https://life.test',BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',LIFEAPP_BETA_EMAILS:'owner@example.test'};
const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function fixture(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB']});
 const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
 const auth=createGoogleAuth(db,env);
 function request(path,body,cookie='',origin=env.BETTER_AUTH_URL){return new Request(env.BETTER_AUTH_URL+'/api/auth/'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'cf-connecting-ip':'192.0.2.10'},body:body?JSON.stringify(body):undefined});}
 const call=(path,body,cookie='',origin)=>handleGoogleAuth(request(path,body,cookie,origin),auth,env);
 const start=()=>call('sign-in/social',{provider:'google',callbackURL:'/'});
 return {mf,db,auth,request,call,start};
}
test('standalone config fails closed and never trusts supplied Sites identity',()=>{
 assert.throws(()=>googleConfig({...env,BETTER_AUTH_SECRET:''}));assert.throws(()=>googleConfig({...env,BETTER_AUTH_URL:'http://life.test'}));assert.throws(()=>googleConfig({...env,LIFEAPP_BETA_EMAILS:''}));
 assert.equal(permittedGoogleUser(env,{email:'owner@example.test',emailVerified:false}),false);
 assert.equal(permittedGoogleUser(env,{email:'stranger@example.test',emailVerified:true}),false);
 const r=withoutSitesIdentity(new Request('https://life.test',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'owner@example.test','x-forwarded-host':'evil.test',cookie:'keep'}}));
 assert.equal(r.headers.has('oai-authenticated-user-id'),false);assert.equal(r.headers.has('x-forwarded-host'),false);assert.equal(r.headers.get('cookie'),'keep');
});
test('Google start uses persisted state, PKCE, limited scopes and secure cookies; rejects unsafe requests',async()=>{
 const f=await fixture();try{
  const r=await f.start();assert.equal(r.status,200,await r.clone().text());const url=new URL((await r.json()).url);
  assert.equal(url.hostname,'accounts.google.com');assert.equal(url.searchParams.get('redirect_uri'),'https://life.test/api/auth/callback/google');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('state').length>=20);
  assert.deepEqual([...new Set(url.searchParams.get('scope').split(' '))].sort(),['email','openid','profile']);assert.match(r.headers.get('set-cookie'),/HttpOnly/i);assert.match(r.headers.get('set-cookie'),/Secure/i);assert.match(r.headers.get('set-cookie'),/SameSite=Lax/i);
  assert.equal((await f.db.prepare('SELECT count(*) n FROM life_auth_verification').first()).n,1);
  assert.equal((await f.call('sign-in/social',{provider:'google',callbackURL:'/',scopes:['gmail.readonly']})).status,400);
  assert.equal((await f.call('sign-in/social',{provider:'google',callbackURL:'/',idToken:{token:'forged'}})).status,400);
  assert.equal((await f.call('sign-in/social',{provider:'google',callbackURL:'/'},'','https://evil.test')).status,403);
  assert.equal((await f.call('sign-up/email',{email:'other@example.test',password:'ignored'})).status,404);
  const bad=await f.call('callback/google?state=forged&code=forged');assert.ok([302,400,401].includes(bad.status));assert.equal(await googleIdentity(f.auth,new Headers({'oai-authenticated-user-id':'forged'}),env),null);
 }finally{await f.mf.dispose();}
});
test('signed synthetic Google callback creates a session, rejects replay and revokes it on sign-out',async()=>{
 const f=await fixture(),nativeFetch=globalThis.fetch;try{
  const start=await f.start(),stateCookie=cookies(start),url=new URL((await start.json()).url);
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='synthetic-key';jwk.alg='RS256';
  const token=await new SignJWT({email:'owner@example.test',email_verified:true,name:'Synthetic Owner'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('synthetic-google-sub').setIssuer('https://accounts.google.com').setAudience(env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let exchanges=0;
  globalThis.fetch=async(input,init)=>{
   const dest=String(input instanceof Request?input.url:input);
   if(dest==='https://oauth2.googleapis.com/token'){
    exchanges++;const body=new URLSearchParams(init.body);assert.equal(body.get('client_secret'),env.GOOGLE_CLIENT_SECRET);assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),url.searchParams.get('code_challenge'));
    return Response.json({access_token:'synthetic-access',token_type:'Bearer',expires_in:3600,id_token:token});
   }
   if(dest==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
   // Miniflare's loopback transports are local database operations.
   if(dest.startsWith('http://127.0.0.1:'))return nativeFetch(input,init);
   throw Error('Unexpected network destination in synthetic test');
  };
  const path='callback/google?code=synthetic-code&state='+url.searchParams.get('state');
  const callback=await f.call(path,undefined,stateCookie);assert.equal(callback.status,302,await callback.clone().text());assert.equal(callback.headers.get('location'),'/');
  const sessionCookie=cookies(callback),identity=await googleIdentity(f.auth,new Headers({Cookie:sessionCookie}),env);assert.ok(identity?.id.startsWith('google:'));assert.equal(identity.email,'owner@example.test');
  const account=await f.db.prepare('SELECT * FROM life_auth_account').first();assert.equal(account.account_id,'synthetic-google-sub');assert.notEqual(account.access_token,'synthetic-access');
  assert.equal(await googleIdentity(f.auth,new Headers({Cookie:sessionCookie}),{...env,LIFEAPP_BETA_EMAILS:'other@example.test'}),null);
  await f.call(path,undefined,stateCookie);assert.equal(exchanges,1);
  assert.equal((await f.call('sign-out',{},sessionCookie)).status,200);assert.equal(await googleIdentity(f.auth,new Headers({Cookie:sessionCookie}),env),null);
 }finally{globalThis.fetch=nativeFetch;await f.mf.dispose();}
});

test('Google identity token validation rejects wrong audience, issuer, expiry and signature',async()=>{
 const f=await fixture(),nativeFetch=globalThis.fetch;try{
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='validation-key';jwk.alg='RS256';
  globalThis.fetch=async(input,init)=>String(input)==='https://www.googleapis.com/oauth2/v3/certs'?Response.json({keys:[jwk]}):nativeFetch(input,init);
  const readUser=f.auth.options.socialProviders.google.getUserInfo;
  for(const kind of ['audience','issuer','expired','unverified','signature']){
   const key=kind==='signature'?(await generateKeyPair('RS256')).privateKey:privateKey;
   const token=await new SignJWT({email:'owner@example.test',email_verified:kind!=='unverified',name:'Synthetic'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('synthetic-sub').setIssuer(kind==='issuer'?'https://evil.test':'https://accounts.google.com').setAudience(kind==='audience'?'different-client':env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime(kind==='expired'?'0s':'5m').sign(key);
   assert.equal(await readUser({idToken:token}),null,kind);
  }
 }finally{globalThis.fetch=nativeFetch;await f.mf.dispose();}
});
