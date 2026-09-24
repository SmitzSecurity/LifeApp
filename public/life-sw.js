/* Private shell caching never handles API responses or queues network writes.
   The account-bound IndexedDB queue lives in the authenticated app instead. */
const SHELL='lifeapp-private-shell-v1',ASSETS='lifeapp-assets-v1',ROOT='/';
let privateEpoch=0;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function clearPrivate(){privateEpoch++;await Promise.all([caches.delete(SHELL),caches.delete(ASSETS)]);}
async function cacheAssets(paths,epoch){
 const cache=await caches.open(ASSETS),visited=new Set();let bytes=0;
 async function visit(path,base=self.location.origin){
  const url=new URL(path,base);
  if(url.origin!==self.location.origin||!/^\/(?:assets\/|_next\/|fonts\/|exercise-art\/|favicon|app-icon)/.test(url.pathname)||! /\.(?:js|css|woff2?|png|svg)$/.test(url.pathname)||visited.has(url.href)||visited.size>=300||bytes>32_000_000||epoch!==privateEpoch)return;
  visited.add(url.href);
  const response=await fetch(url);if(!response.ok||epoch!==privateEpoch)return;
  const buffer=await response.clone().arrayBuffer();bytes+=buffer.byteLength;if(bytes>32_000_000)return;
  await cache.put(url,response);if(epoch!==privateEpoch){await caches.delete(ASSETS);return;}
  if(/\.(?:js|css)$/.test(url.pathname)){
   const text=new TextDecoder().decode(buffer),imports=[...text.matchAll(/["'(]((?:\.\.?\/|\/assets\/|\/_next\/)[^"'()\s]+\.(?:js|css|woff2?))["')]/g)];
   await Promise.allSettled(imports.map(match=>visit(match[1],url.href)));
  }
 }
 await Promise.allSettled(paths.map(path=>visit(path)));
}
async function cacheShell(response,epoch=privateEpoch,extra=[]){
 if(epoch!==privateEpoch)return;
 if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return;
 const html=await response.clone().text();
 if(!/<meta\s+name="life-offline-account"\s+content="[A-Za-z0-9:_-]+"/.test(html))return;
 const cache=await caches.open(SHELL);if(epoch!==privateEpoch)return;await cache.put(ROOT,response.clone());if(epoch!==privateEpoch){await caches.delete(SHELL);return;}
 // Capture the actual document's hashed script/style graph, including imports
 // requested before the worker first took control.
 const paths=new Set([...html.matchAll(/(?:src|href)="(\/[^"<>]+)"/g)].map(match=>match[1]).filter(path=>/\.(?:js|css|woff2?)(?:\?|$)/.test(path)));
 await cacheAssets([...paths,...extra],epoch);
}
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(url.origin!==self.location.origin||request.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'&&url.pathname==='/sign-in')event.waitUntil(clearPrivate());
 if(request.mode==='navigate'&&url.pathname==='/'){
  const epoch=privateEpoch;
  event.respondWith((async()=>{try{const response=await fetch(request);if(response.redirected&&new URL(response.url).pathname!=='/')await clearPrivate();else if(response.ok)event.waitUntil(cacheShell(response,epoch));return response;}catch{const cached=epoch===privateEpoch?await caches.match(ROOT,{cacheName:SHELL}):null;return cached&&epoch===privateEpoch?cached:new Response('Open LifeApp online once before using it offline.',{status:503,headers:{'Content-Type':'text/plain'}});}})());return;
 }
 if(/\.(?:js|css|woff2?|png|webp|svg|avif)(?:$)/.test(url.pathname)){
  const epoch=privateEpoch;
  event.respondWith((async()=>{const cache=await caches.open(ASSETS),cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok&&epoch===privateEpoch){await cache.put(request,response.clone());if(epoch!==privateEpoch)await caches.delete(ASSETS);}return response;})());
 }
});
self.addEventListener('message',event=>{
 if(event.data?.type==='life:clear-private')event.waitUntil(clearPrivate());
 if(event.data?.type==='life:cache-shell'){const epoch=privateEpoch,assets=Array.isArray(event.data.assets)?event.data.assets.filter(item=>typeof item==='string').slice(0,300):[];event.waitUntil(fetch('/',{cache:'no-store'}).then(response=>cacheShell(response,epoch,assets)).catch(()=>{}));}
});
self.addEventListener('notificationclick',event=>{
 if(event.notification.data?.type!=='workout-rest')return;
 event.notification.close();
 event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=clients.find(item=>new URL(item.url).origin===self.location.origin&&new URL(item.url).pathname==='/');if(client){await client.focus();client.postMessage({type:'life:open-workout'});}else await self.clients.openWindow('/?workout=active');})());
});
