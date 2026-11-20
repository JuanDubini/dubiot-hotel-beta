const CACHE='dubiot-hotel-beta-v1';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./beta.html','./beta.css','./beta.js','./supabase-config.js','./manifest.webmanifest','./dubiot-logo-canal.svg']))));
self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
