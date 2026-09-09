import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Exercise the actual build/deploy wrapper without a network call or deployment.
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'lifeapp-cloudflare-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'scripts'));
 mkdirSync(join(root,'node_modules/wrangler/bin'),{recursive:true});
 cpSync(resolve('scripts/cloudflare.mjs'),join(root,'scripts/cloudflare.mjs'));
 cpSync(resolve('wrangler.standalone.json'),join(root,'wrangler.standalone.json'));
 writeFileSync(join(root,'scripts/standalone.mjs'),`import {mkdirSync,copyFileSync} from 'node:fs';
 mkdirSync('dist-standalone/server',{recursive:true});
 copyFileSync('wrangler.cloudflare.generated.json','dist-standalone/server/wrangler.json');`);
 writeFileSync(join(root,'node_modules/wrangler/bin/wrangler.js'),"console.log('SYNTHETIC_WRANGLER '+JSON.stringify(process.argv.slice(2)))");
 const id='11111111-1111-4111-8111-111111111111';
 const run=(args,extra={})=>spawnSync(process.execPath,['scripts/cloudflare.mjs',...args],{cwd:root,encoding:'utf8',env:{...process.env,LIFEAPP_D1_DATABASE_ID:id,...extra}});
 const output=join(root,'dist-standalone/server/wrangler.json');
 return {root,id,run,output};
}

test('Cloudflare build carries the production Cron, DB and runtime-variable safeguards',t=>{
 const f=fixture(t);
 const built=f.run(['build'],{GEMINI_API_KEY:'synthetic-do-not-copy',BETTER_AUTH_SECRET:'synthetic-do-not-copy'});
 assert.equal(built.status,0,built.stderr);
 const config=JSON.parse(readFileSync(f.output,'utf8'));
 assert.deepEqual(config.triggers,{crons:['*/5 * * * *']});
 assert.equal(config.d1_databases[0].database_id,f.id);
 assert.equal(config.keep_vars,true);
 assert.deepEqual(config.vars,{LIFEAPP_AUTH_MODE:'google'});
 assert.doesNotMatch(JSON.stringify(config),/synthetic-do-not-copy/);
 const dry=f.run(['deploy','--dry-run']);
 assert.equal(dry.status,0,dry.stderr);
 assert.match(dry.stdout,/SYNTHETIC_WRANGLER.*--dry-run/);
});

test('deploy refuses a missing, removed, changed or duplicated production Cron',t=>{
 const f=fixture(t);assert.equal(f.run(['build']).status,0);
 const config=JSON.parse(readFileSync(f.output,'utf8'));
 for(const triggers of [undefined,{}, {crons:[]},{crons:['* * * * *']},{crons:['*/5 * * * *','*/5 * * * *']}]){
  writeFileSync(f.output,JSON.stringify({...config,triggers}));
  const result=f.run(['deploy','--dry-run']);
  assert.equal(result.status,1);assert.match(result.stderr,/Cron is missing or changed/);
  assert.doesNotMatch(result.stdout,/SYNTHETIC_WRANGLER/);
 }
});

test('build still refuses missing and placeholder database IDs',t=>{
 const f=fixture(t);
 for(const id of ['', '00000000-0000-4000-8000-000000000000']){
  const result=f.run(['build'],{LIFEAPP_D1_DATABASE_ID:id});
  assert.equal(result.status,1);assert.match(result.stderr,/existing Cloudflare database ID/);
 }
});
