const CACHE='dubiot-hotel-beta-v6';
const FILES=['./','./index.html','./beta.html','./beta.css','./beta.js','./qrcode.js','./supabase-config.js','./manifest.webmanifest','./dubiot-logo-canal.svg'];
self.addEventListener('install',event=>event.waitUntil(Promise.all([caches.open(CACHE).then(cache=>cache.addAll(FILES)),self.skipWaiting()])));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('dubiot-hotel-beta-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method==='GET')event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(response=>response||fetch(event.request)));});

