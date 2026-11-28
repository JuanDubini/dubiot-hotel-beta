const CACHE='dubiot-hotel-beta-v31';
const FILES=['./','./index.html','./beta.html','./panel.html','./admin.html','./beta.css','./beta.js','./sprint2.js','./admin.js','./qrcode.js','./supabase-config.js','./manifest.webmanifest','./dubiot-logo-hotel.png'];
self.addEventListener('install',event=>event.waitUntil(Promise.all([caches.open(CACHE).then(cache=>cache.addAll(FILES)),self.skipWaiting()])));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('dubiot-hotel-beta-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  const staticFile=request.mode==='navigate'||/\.(html|css|js|svg|png|webmanifest)$/.test(url.pathname);
  if(!staticFile)return;
  event.respondWith(fetch(request).then(response=>{
    if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
    return response;
  }).catch(async()=>{
    const cache=await caches.open(CACHE);
    return await cache.match(request,{ignoreSearch:true})||Response.error();
  }));
});

