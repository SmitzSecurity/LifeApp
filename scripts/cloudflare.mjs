// Cloudflare Git builds: database ID is a build setting; auth/AI values are runtime secrets.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const command=process.argv[2],extra=process.argv.slice(3);
const generated='wrangler.cloudflare.generated.json';
const output='dist-standalone/server/wrangler.json';
function run(file,args,env=process.env){
 const result=spawnSync(process.execPath,[resolve(file),...args],{stdio:'inherit',env});
 if(result.status!==0)throw Error('Cloudflare '+command+' did not complete.');
}
function databaseId(value){
 if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value||'')||value.startsWith('00000000-'))throw Error('Set LIFEAPP_D1_DATABASE_ID to the existing Cloudflare database ID in Build variables.');
 return value;
}
try{
 if(command==='build'&&extra.length===0){
  const config=JSON.parse(readFileSync('wrangler.standalone.json','utf8'));
  config.d1_databases[0].database_id=databaseId(process.env.LIFEAPP_D1_DATABASE_ID);
  // Do not ship localhost, an email allowlist or credentials in build configuration.
  // The first deployment is closed until runtime Google settings are configured.
  config.vars={LIFEAPP_AUTH_MODE:'google'};
  config.keep_vars=true;
  config.workers_dev=true;
  // Production's existing five-minute schedule must survive every Git build.
  // User consent and runtime flags still control actual AI admission.
  config.triggers={crons:['*/5 * * * *']};
  // Restrict the native mail binding to the owner's approved sender. Runtime
  // activation and each account's separate consent are still required.
  config.send_email=JSON.parse(readFileSync('config/report-email.json','utf8')).send_email;
  writeFileSync(generated,JSON.stringify(config,null,2)+'\n',{mode:0o600});
  run('scripts/standalone.mjs',['build'],{...process.env,LIFEAPP_CLOUDFLARE_BUILD:'true'});
  writeFileSync('dist-standalone/LIFEAPP_CLOUDFLARE_BUILD',config.d1_databases[0].database_id+'\n');
 }else if(command==='deploy'&&(extra.length===0||extra.length===1&&extra[0]==='--dry-run')){
  const id=databaseId(readFileSync('dist-standalone/LIFEAPP_CLOUDFLARE_BUILD','utf8').trim());
  const build=JSON.parse(readFileSync(output,'utf8'));
  if(build.name!=='lifeapp'||build.d1_databases?.[0]?.database_id!==id||build.keep_vars!==true||JSON.stringify(build.vars)!==JSON.stringify({LIFEAPP_AUTH_MODE:'google'}))throw Error('Run build:cloudflare again before deploying.');
  if(JSON.stringify(build.triggers?.crons)!==JSON.stringify(['*/5 * * * *']))throw Error('Production daily-review Cron is missing or changed. Run build:cloudflare again before deploying.');
  if(JSON.stringify(build.send_email)!==JSON.stringify(JSON.parse(readFileSync('config/report-email.json','utf8')).send_email))throw Error('Report email sender binding is missing or changed. Run build:cloudflare again before deploying.');
  run('node_modules/wrangler/bin/wrangler.js',['deploy','--config',output,...extra]);
 }else throw Error('Use build or deploy [--dry-run].');
}catch(error){console.error(error.message);process.exitCode=1;}
