import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const file='worker-email-bindings.d.ts';
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','types',file,'--config','config/report-email.json','--include-runtime','false','--env-interface','LifeAppEmailBindings'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
// Use Wrangler's generated bindings with the current scoped runtime types.
const content=readFileSync(file,'utf8').replace('interface LifeAppEmailBindings extends','export interface LifeAppEmailBindings extends');
writeFileSync(file,"import type {SendEmail} from '@cloudflare/workers-types';\n"+content);
