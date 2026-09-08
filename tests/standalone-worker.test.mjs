import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const env={LIFEAPP_AUTH_MODE:'google',BETTER_AUTH_URL:'https://life.test',BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),GOOGLE_CLIENT_ID:'synthetic-worker-client',GOOGLE_CLIENT_SECRET:'synthetic-worker-secret',LIFEAPP_BETA_EMAILS:'owner@example.test'};
const config={modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'dist-standalone/server/index.js',compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:async()=>new Response('Not found',{status:404})}};
const mf=new Miniflare({...config,bindings:env});after(()=>mf.dispose());
before(async()=>{const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();});
test('standalone Worker uses Google sign-in and rejects forged Sites identity',async()=>{
 const headers={'oai-authenticated-user-id':'forged-owner','oai-authenticated-user-email':'owner@example.test',accept:'text/html'};
 const home=await mf.dispatchFetch('https://life.test/',{headers,redirect:'manual'});assert.ok([302,303,307,308].includes(home.status));assert.equal(new URL(home.headers.get('location'),'https://life.test').pathname,'/sign-in');
 const r=await mf.dispatchFetch('https://life.test/api/life',{headers});assert.equal(r.status,401);
 const signIn=await mf.dispatchFetch('https://life.test/sign-in',{headers});assert.equal(signIn.status,200);assert.match(await signIn.text(),/Continue with Google/);
});
test('compiled standalone Google initiation persists state through D1 and enforces origin',async()=>{
 const body=JSON.stringify({provider:'google',callbackURL:'/'});
 const r=await mf.dispatchFetch('https://life.test/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://life.test','cf-connecting-ip':'192.0.2.12'},body});assert.equal(r.status,200,await r.clone().text());
 assert.equal(new URL((await r.json()).url).hostname,'accounts.google.com');assert.match(r.headers.get('set-cookie'),/Secure/);
 const cross=await mf.dispatchFetch('https://life.test/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body});assert.equal(cross.status,403);
 const anonymousExport=await mf.dispatchFetch('https://life.test/api/life?export=1');assert.equal(anonymousExport.status,401);
});
test('standalone Worker cannot fall back to Sites headers when auth mode is missing',async()=>{
 const unset=new Miniflare(config);try{const r=await unset.dispatchFetch('https://life.test/api/life',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'owner@example.test'}});assert.equal(r.status,503);}finally{await unset.dispose();}
});
