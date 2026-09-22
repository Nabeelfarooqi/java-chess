// Cache only the public offline notice and install icons. Never cache a PIN,
// authenticated page, API response, game state, or engine asset.
const CACHE='rival-offline-v1';
const PUBLIC=['/offline.html','/manifest.json','/app-icons/192.png','/app-icons/512.png','/app-icons/180.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('rival-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
    const request=event.request,url=new URL(request.url);
    if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
    if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>await caches.match('/offline.html')||Response.error()));return;}
    if(PUBLIC.includes(url.pathname))event.respondWith(fetch(request).catch(async()=>await caches.match(url.pathname)||Response.error()));
});
