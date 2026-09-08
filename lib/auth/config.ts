export type AuthEnvironment={LIFEAPP_AUTH_MODE?:string;BETTER_AUTH_URL?:string;BETTER_AUTH_SECRET?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;LIFEAPP_BETA_EMAILS?:string};
export function googleMode(env:AuthEnvironment){return env.LIFEAPP_AUTH_MODE==='google';}
export function permittedGoogleUser(env:AuthEnvironment,user:{email:string;emailVerified:boolean}){
 const allowed=(env.LIFEAPP_BETA_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 return user.emailVerified&&allowed.includes(user.email.trim().toLowerCase());
}
export function googleConfig(env:AuthEnvironment){
 if(!googleMode(env)||!env.BETTER_AUTH_URL||!env.BETTER_AUTH_SECRET||env.BETTER_AUTH_SECRET.length<32||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.LIFEAPP_BETA_EMAILS?.trim())throw Error('Google sign-in needs owner configuration.');
 const origin=new URL(env.BETTER_AUTH_URL);
 if(origin.origin!==env.BETTER_AUTH_URL||origin.username||origin.password||!(origin.protocol==='https:'||(origin.protocol==='http:'&&origin.hostname==='localhost')))throw Error('Configure an HTTPS origin, or http://localhost for local development.');
 return {origin:origin.origin,secret:env.BETTER_AUTH_SECRET,clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET};
}
// Only the standalone entrypoint uses this. Sites identity is not portable and
// caller-provided proxy headers must never become identity on a direct host.
export function withoutSitesIdentity(request:Request){
 const headers=new Headers(request.headers);
 for(const key of [...headers.keys()])if(key.startsWith('oai-')||key.startsWith('x-forwarded-'))headers.delete(key);
 return new Request(request,{headers});
}
