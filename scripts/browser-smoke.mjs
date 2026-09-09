// Disposable, read-only browser fixture. Local synthetic D1 only; no provider access.
import {createServer} from 'node:http';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Miniflare,createFetchMock} from 'miniflare';
import {serializeSignedCookie} from 'better-call';

const assets=resolve('dist-standalone/client');
if(!existsSync(resolve('dist-standalone/server/index.js')))throw Error('Run npm run build first.');
const secret=randomBytes(48).toString('base64url');
const mock=createFetchMock();mock.disableNetConnect();
const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'dist-standalone/server/index.js',compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],fetchMock:mock,
 bindings:{LIFEAPP_AUTH_MODE:'google',BETTER_AUTH_URL:'https://life.test',BETTER_AUTH_SECRET:secret,GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',LIFEAPP_BETA_EMAILS:'smoke@example.test'},
 serviceBindings:{ASSETS:async()=>new Response('Not found',{status:404})}
});
const db=await mf.getD1Database('DB');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
const stamp=Date.now(),id='browser-smoke',userId='google:'+id;
await db.prepare('INSERT INTO life_auth_user VALUES(?1,?2,?3,1,NULL,?4,?4)').bind(id,'Synthetic browser fixture','smoke@example.test',stamp).run();
await db.prepare('INSERT INTO life_auth_session VALUES(?1,?2,?3,?4,?4,NULL,NULL,?5)').bind('smoke-session',stamp+3600000,'synthetic-browser-token',stamp,id).run();
await db.prepare('INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)').bind('smoke-account','smoke-google-sub','google',id,stamp).run();
await db.prepare('INSERT INTO life_profiles VALUES(?1,?2,1,?3)').bind(userId,JSON.stringify({goal:'Read and reflect each day — synthetic fixture',timezone:'America/New_York',modules:['reflection'],habits:[]}),new Date(stamp).toISOString()).run();
for(let days=1;days<=2;days++){
 const date=new Date(stamp-days*86400000).toISOString().slice(0,10);
 await db.prepare('INSERT INTO life_entries VALUES(?1,?2,?3,1,?4)').bind(userId,date,JSON.stringify({date,complete:true,journal:'Synthetic preserved check-in '+days,context:{},habits:[]}),new Date(stamp).toISOString()).run();
}
const cookie=(await serializeSignedCookie('__Secure-lifeapp.session_token','synthetic-browser-token',secret,{secure:true,httpOnly:true,path:'/'})).split(';')[0];
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'){res.writeHead(405);res.end('This synthetic smoke fixture is read-only.');return;}
  // Cloudflare serves static assets before invoking the Worker. Reproduce that here.
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=resolve(assets,'.'+decodeURIComponent(pathname));
  if(file.startsWith(assets+sep)&&existsSync(file)&&statSync(file).isFile()){
   const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]||'application/octet-stream';
   res.writeHead(200,{'Content-Type':mime});res.end(readFileSync(file));return;
  }
  // This loopback-only test proxy supplies a synthetic identity to an isolated Worker.
  // Never use production data, keys, remote D1, or a non-loopback listen address here.
  const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value&& !['host','cookie'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
  headers.set('Cookie',cookie);
  const response=await mf.dispatchFetch('https://life.test'+req.url,{headers,redirect:'manual'});
  res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));
  res.end(Buffer.from(await response.arrayBuffer()));
  if(req.url.includes('export=1'))console.log('Synthetic backup download HTTP '+response.status);
 }catch(error){console.error(error.message);res.writeHead(500);res.end('Synthetic fixture error');}
});
server.on('error',async error=>{console.error(error.message);await mf.dispose();await mock.close();process.exitCode=1;});
server.listen(0,'127.0.0.1',()=>console.log('Synthetic read-only browser fixture: http://127.0.0.1:'+server.address().port));
async function stop(){server.close();await mf.dispose();await mock.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
