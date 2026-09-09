import {betterAuth} from 'better-auth/minimal';
import {savedDayQuery} from '../life/saved-day-link.ts';
import {verifyGoogleIdToken,type GoogleProfile} from 'better-auth/social-providers';
import {drizzleAdapter} from '@better-auth/drizzle-adapter';
import {drizzle,type AnyD1Database} from 'drizzle-orm/d1';
import * as schema from '../../db/auth-schema.ts';
import {googleConfig,permittedGoogleUser,type AuthEnvironment} from './config.ts';
export function createGoogleAuth(db:AnyD1Database,env:AuthEnvironment){
 const c=googleConfig(env);
 return betterAuth({
  appName:'LifeApp',baseURL:c.origin,basePath:'/api/auth',secret:c.secret,
  trustedOrigins:[c.origin],database:drizzleAdapter(drizzle(db,{schema}),{provider:'sqlite',schema,transaction:false}),
  emailAndPassword:{enabled:false},
  socialProviders:{google:{clientId:c.clientId,clientSecret:c.clientSecret,prompt:'select_account',accessType:'online',scope:['openid','profile','email'],
   getUserInfo:async tokens=>{
    if(!tokens.idToken)return null;
    const claims=await verifyGoogleIdToken({token:tokens.idToken,audience:c.clientId});
    if(!claims||typeof claims.sub!=='string'||typeof claims.email!=='string'||claims.email_verified!==true)return null;
    // Better Auth's GoogleProfile types require optional presentation claims.
    // Identity uses only the verified subject/email above; missing names stay optional.
    return {user:{name:typeof claims.name==='string'?claims.name:'LifeApp user',email:claims.email,emailVerified:true,image:typeof claims.picture==='string'?claims.picture:undefined},data:claims as unknown as GoogleProfile};
   }
  }},
  account:{encryptOAuthTokens:true,storeStateStrategy:'database',accountLinking:{enabled:false,disableImplicitLinking:true}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*24,cookieCache:{enabled:false}},
  rateLimit:{enabled:true,storage:'database',window:60,max:30},
  advanced:{cookiePrefix:'lifeapp',useSecureCookies:c.origin.startsWith('https:'),defaultCookieAttributes:{httpOnly:true,sameSite:'lax'},ipAddress:{ipAddressHeaders:['cf-connecting-ip']}},
  databaseHooks:{user:{create:{before:async user=>permittedGoogleUser(env,user)?{data:user}:false}}},
  logger:{disabled:true},telemetry:{enabled:false},
  onAPIError:{errorURL:c.origin+'/sign-in'},
 });
}
export async function googleIdentity(auth:ReturnType<typeof createGoogleAuth>,headers:Headers,env:AuthEnvironment){
 const s=await auth.api.getSession({headers});
 return s&&permittedGoogleUser(env,s.user)?{id:'google:'+s.user.id,email:s.user.email}:null;
}
// Expose only the implemented Google code flow and session/logout operations.
// In particular, arbitrary scopes, token-based login and account linking are not
// accepted through the initial beta route.
export async function handleGoogleAuth(request:Request,auth:ReturnType<typeof createGoogleAuth>,env:AuthEnvironment){
 const url=new URL(request.url),path=url.pathname;
 const allowed=['POST /api/auth/sign-in/social','GET /api/auth/callback/google','GET /api/auth/get-session','POST /api/auth/sign-out'];
 if(!allowed.includes(request.method+' '+path))return Response.json({error:'Not found'},{status:404});
 if(request.method==='POST'){
  if(request.headers.get('origin')!==googleConfig(env).origin||!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Open LifeApp directly to continue.'},{status:403});
  const text=await request.clone().text();if(new TextEncoder().encode(text).length>4096)return Response.json({error:'Request too large'},{status:413});
  let body;try{body=JSON.parse(text);}catch{return Response.json({error:'Invalid request'},{status:400});}
  if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Invalid request'},{status:400});
  const params=typeof body.callbackURL==='string'&&body.callbackURL.startsWith('/?date=')?new URLSearchParams(body.callbackURL.slice(2)):null;
  const safeCallback=body.callbackURL==='/'||!!params&&body.callbackURL==='/'+savedDayQuery(params.get('date'),params.get('analysis'));
  if(path.endsWith('/sign-in/social')&&(body.provider!=='google'||!safeCallback||Object.keys(body).some(k=>!['provider','callbackURL'].includes(k))))return Response.json({error:'Use the Google sign-in button.'},{status:400});
 }
 const response=await auth.handler(request),headers=new Headers(response.headers);
 headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');
 return new Response(response.body,{status:response.status,headers});
}
