import {readFileSync,writeFileSync,existsSync,cpSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
const command=process.argv[2]||'doctor',args=process.argv.slice(3);
const configPath=existsSync('wrangler.standalone.local.json')?'wrangler.standalone.local.json':'wrangler.standalone.json';
const config=JSON.parse(readFileSync(configPath,'utf8'));
function runWrangler(args){const r=spawnSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),...args],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
function requireProductionConfig(){
 if(configPath!=='wrangler.standalone.local.json'||!/^[\da-f-]{36}$/i.test(config.d1_databases[0].database_id)||config.d1_databases[0].database_id.startsWith('00000000-'))throw Error('Configure the owner database and HTTPS address first.');
 const origin=new URL(config.vars.BETTER_AUTH_URL);
 if(origin.protocol!=='https:'||origin.origin!==config.vars.BETTER_AUTH_URL||!config.vars.LIFEAPP_BETA_EMAILS)throw Error('Configure an exact HTTPS origin and beta email allowlist first.');
}
try{
 if(command==='init-local'){
  if(existsSync('.dev.vars'))throw Error('.dev.vars already exists; it was left untouched.');
  const template=readFileSync('.dev.vars.example','utf8').replace('BETTER_AUTH_SECRET=','BETTER_AUTH_SECRET='+randomBytes(48).toString('base64url'));
  writeFileSync('.dev.vars',template,{mode:0o600,flag:'wx'});console.log('Created private local settings and a session secret. Add Google credentials in .dev.vars; no secret was printed.');
 }else if(command==='configure'){
  const options={};for(let i=0;i<args.length;i+=2){if(!['--url','--database-id','--email'].includes(args[i])||!args[i+1])throw Error('Use --url HTTPS_ORIGIN --database-id D1_ID --email YOUR_EMAIL');options[args[i]]=args[i+1];}
  const url=new URL(options['--url']);if(url.protocol!=='https:'||url.origin!==options['--url'])throw Error('Supply the exact HTTPS origin, without a trailing slash or path.');
  if(!/^[\da-f-]{36}$/i.test(options['--database-id']||'')||options['--database-id'].startsWith('00000000-'))throw Error('Supply the database ID returned by Cloudflare.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options['--email']||''))throw Error('Supply the Google email authorized for this private beta.');
  const template=JSON.parse(readFileSync('wrangler.standalone.json','utf8'));
  template.d1_databases[0].database_id=options['--database-id'];template.vars.BETTER_AUTH_URL=url.origin;template.vars.LIFEAPP_BETA_EMAILS=options['--email'];
  writeFileSync('wrangler.standalone.local.json',JSON.stringify(template,null,2)+'\n',{mode:0o600});
  console.log('Saved standalone hosting settings. Google redirect URI: '+url.origin+'/api/auth/callback/google');
 }else if(command==='doctor'){
  const values={...config.vars,...(existsSync('.dev.vars')?parseEnv(readFileSync('.dev.vars','utf8')):{}),...process.env};
  for(const key of ['BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','LIFEAPP_BETA_EMAILS','GEMINI_API_KEY'])console.log(key+': '+(values[key]?.trim()?'present':'missing'));
  console.log('Configuration: '+configPath);console.log('Google redirect URI: '+config.vars.BETTER_AUTH_URL+'/api/auth/callback/google');
  console.log('This checks local settings only. It does not verify remote secrets, login, provider access or billing.');
 }else if(command==='build'){
  process.env.WRANGLER_WRITE_LOGS='false';process.env.WRANGLER_LOG_PATH='.wrangler/logs';
  const {createBuilder}=await import('vite');await (await createBuilder({configFile:resolve('vite.standalone.config.ts')})).buildApp();
  rmSync('dist-standalone',{recursive:true,force:true});cpSync('dist','dist-standalone',{recursive:true});
  writeFileSync('dist-standalone/LIFEAPP_BUILD_TARGET','standalone\n');
  if(!existsSync('dist-standalone/server/index.js')||!existsSync('dist-standalone/server/wrangler.json'))throw Error('Standalone Worker output is incomplete.');
  console.log('Standalone build prepared. No deployment or account change was performed.');
 }else if(command==='dev'){
  const {createServer}=await import('vite');const server=await createServer({configFile:resolve('vite.standalone.config.ts')});await server.listen();server.printUrls();
 }else if(command==='migrate-local')runWrangler(['d1','migrations','apply','DB','--local','--config',configPath]);
 else if(command==='migrate-remote'){requireProductionConfig();runWrangler(['d1','migrations','apply','DB','--remote','--config',configPath]);}
 else if(command==='deploy'){
  requireProductionConfig();const build=JSON.parse(readFileSync('dist-standalone/server/wrangler.json','utf8'));
  if(readFileSync('dist-standalone/LIFEAPP_BUILD_TARGET','utf8').trim()!=='standalone'||build.vars?.BETTER_AUTH_URL!==config.vars.BETTER_AUTH_URL||build.d1_databases?.[0]?.database_id!==config.d1_databases[0].database_id)throw Error('Build again using the current standalone configuration.');
  runWrangler(['deploy','--config','dist-standalone/server/wrangler.json']);
 }else if(command==='secret'){
  requireProductionConfig();const permitted=['BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GEMINI_API_KEY','LIFEAPP_AI_PAID_PROJECT','LIFEAPP_AI_ENABLED'];
  if(args.length!==1||!permitted.includes(args[0]))throw Error('Choose a documented LifeApp secret name. Values must be entered at the hidden Wrangler prompt.');
  runWrangler(['secret','put',args[0],'--config',configPath]);
 }else throw Error('Commands: init-local, configure, doctor, build, dev, migrate-local, migrate-remote, deploy, secret');
}catch(e){console.error(e.message);process.exitCode=1;}
