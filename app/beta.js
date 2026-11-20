(() => {
  const root = document.querySelector('#root');
  const sessionBox = document.querySelector('#session');
  const toastBox = document.querySelector('#toast');
  const cfg = window.DUBIOT_SUPABASE_CONFIG || {};
  const sb = cfg.enabled && window.supabase?.createClient && cfg.url && cfg.publishableKey
    ? window.supabase.createClient(cfg.url, cfg.publishableKey) : null;
  let user = null, profile = null, membership = null, hotel = null;
  let assets = [], members = [], activeAsset = null, toastTimer;
  const $ = (sel, scope = document) => scope.querySelector(sel);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusLabels = {operational:'Operativo',review:'En revisión',critical:'Crítico',out_of_service:'Fuera de servicio'};
  const eventLabels = {created:'Alta',inspection:'Inspección',maintenance:'Mantenimiento',repair:'Reparación',replacement:'Reemplazo',part_replaced:'Repuesto',status_change:'Cambio de estado',issue:'Incidencia',note:'Observación'};
  const canManage = () => ['hotel_manager','supervisor'].includes(membership?.role);
  const canManageTeam = () => membership?.role === 'hotel_manager';
  const toast = text => { toastBox.textContent = text; toastBox.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastBox.classList.remove('show'), 3200); };
  const fail = (error, fallback = 'No se pudo completar la operación.') => { console.error(error); toast(error?.message || fallback); };

  function shell(title, subtitle, actions = '') {
    return `<div class="row mobile-stack"><div><p class="muted">DubIoT · ${esc(hotel?.name || 'Hotel Demo')}</p><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;
  }
  function showAuth(message = '') {
    sessionBox.innerHTML = '';
    root.innerHTML = `<section class="panel auth"><img src="dubiot-logo-canal.svg" width="54" alt="" style="border-radius:12px;background:white;margin-bottom:14px"><h1>Acceso del equipo</h1><p>Iniciá sesión para consultar activos y registrar su historial compartido.</p>${message ? `<div class="notice">${esc(message)}</div>` : ''}<div class="auth-switch"><button class="btn primary" id="showLogin">Ingresar</button><button class="btn" id="showSignup">Crear cuenta</button></div><form id="authForm"><div id="nameField" class="field" hidden><label for="fullName">Nombre y apellido</label><input id="fullName" class="input" autocomplete="name"></div><div class="field"><label for="email">Correo electrónico</label><input id="email" class="input" type="email" required autocomplete="email"></div><div class="field"><label for="password">Contraseña</label><input id="password" class="input" type="password" required minlength="8" autocomplete="current-password"></div><button class="btn primary" id="authSubmit" type="submit">Ingresar</button><p class="muted">La cuenta y los registros se guardan en el proyecto Supabase de DubIoT.</p></form></section>`;
    let mode = 'login';
    const setMode = next => { mode = next; $('#nameField').hidden = next !== 'signup'; $('#fullName').required = next === 'signup'; $('#password').autocomplete = next === 'signup' ? 'new-password' : 'current-password'; $('#authSubmit').textContent = next === 'signup' ? 'Crear cuenta' : 'Ingresar'; $('#showLogin').classList.toggle('primary', next === 'login'); $('#showSignup').classList.toggle('primary', next === 'signup'); };
    $('#showLogin').onclick = () => setMode('login'); $('#showSignup').onclick = () => setMode('signup');
    $('#authForm').onsubmit = async e => { e.preventDefault(); const email = $('#email').value.trim(), password = $('#password').value; $('#authSubmit').disabled = true;
      try {
        if (mode === 'signup') {
          const {data,error} = await sb.auth.signUp({email,password,options:{data:{full_name:$('#fullName').value.trim()}}}); if (error) throw error;
          if (!data.session) showAuth('Cuenta creada. Revisá tu correo para confirmar la dirección y después volvé para iniciar sesión.');
          else await acceptSession(data.session.user);
        } else { const {data,error} = await sb.auth.signInWithPassword({email,password}); if (error) throw error; await acceptSession(data.user); }
      } catch (err) { fail(err, 'No se pudo iniciar sesión.'); $('#authSubmit') && ($('#authSubmit').disabled = false); }
    };
  }
  async function acceptSession(authUser) {
    user = authUser;
    const [{data:p,error:pe},{data:m,error:me}] = await Promise.all([
      sb.from('profiles').select('id,full_name').eq('id',user.id).maybeSingle(),
      sb.from('hotel_memberships').select('id,hotel_id,role,status').eq('user_id',user.id).order('requested_at',{ascending:false}).limit(1).maybeSingle()
    ]);
    if (pe) throw pe; if (me) throw me;
    profile = p; membership = m;
    if (!membership || membership.status !== 'active') return showMembershipGate();
    const {data:h,error:he} = await sb.from('hotels').select('id,name,slug,timezone').eq('id',membership.hotel_id).maybeSingle();
    if (he) throw he; if (!h) { membership = null; return showMembershipGate(); }
    hotel = h; await loadWorkspace();
  }
  function showMembershipGate() {
    const waiting = membership?.status === 'pending';
    const rejected = membership?.status === 'rejected' || membership?.status === 'suspended';
    sessionBox.innerHTML = `<button class="btn quiet" id="logout">Cerrar sesión</button>`;
    root.innerHTML = `<section class="panel auth"><h1>${waiting ? 'Solicitud pendiente' : rejected ? 'Acceso sin habilitar' : 'Solicitar acceso al hotel'}</h1><p>${waiting ? 'Tu solicitud está esperando aprobación de un responsable del hotel.' : rejected ? 'Contactá al responsable del hotel para revisar tu acceso.' : 'El responsable de DubIoT debe habilitar la primera cuenta como gerente. El resto del personal puede solicitar acceso desde aquí.'}</p>${membership ? `<p class="badge">Estado: ${esc(membership.status)} · rol solicitado: ${esc(membership.role)}</p>` : `<form id="requestForm"><div class="field"><label for="hotelSlug">Código del hotel</label><input id="hotelSlug" class="input" required value="hotel-demo" autocomplete="off"><small class="muted">Para la prueba inicial usá: hotel-demo</small></div><div class="field"><label for="role">Rol solicitado</label><select id="role" class="input"><option value="technician">Técnico</option><option value="staff">Personal operativo</option><option value="supervisor">Supervisor</option></select></div><button class="btn primary">Enviar solicitud</button></form>`}<div class="actions"><button class="btn quiet" id="logout2">Salir</button></div></section>`;
    $('#logout').onclick = signOut; $('#logout2').onclick = signOut;
    $('#requestForm')?.addEventListener('submit', async e => { e.preventDefault(); const btn = e.submitter; btn.disabled = true;
      try { const {error} = await sb.rpc('request_hotel_membership_by_slug',{_hotel_slug:$('#hotelSlug').value.trim(),_requested_role:$('#role').value}); if (error) throw error; toast('Solicitud enviada'); await acceptSession(user); }
      catch (err) { fail(err,'No se pudo solicitar acceso.'); btn.disabled = false; }
    });
  }
  async function loadWorkspace() {
    const hid = hotel.id;
    const [eq, hist, tasks, issues, checks] = await Promise.all([
      sb.from('equipment').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('equipment_history').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('maintenance_tasks').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('issues').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('daily_checks').select('*').eq('hotel_id',hid).order('checked_at',{ascending:false})
    ]);
    for (const result of [eq,hist,tasks,issues,checks]) if (result.error) throw result.error;
    const names = new Map((eq.data||[]).map(x=>[x.id,x.name]));
    const timeline = new Map();
    for (const ev of hist.data||[]) { if (!timeline.has(ev.equipment_id)) timeline.set(ev.equipment_id,[]); timeline.get(ev.equipment_id).push({id:ev.id,at:new Date(ev.created_at).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'}),kind:eventLabels[ev.event_type]||ev.event_type,text:ev.title+(ev.details?` · ${ev.details}`:''),actor:ev.actor_id===user.id?(profile?.full_name||user.email):'Equipo técnico'}); }
    assets=(eq.data||[]).map(x=>({...x,code:`DB-${x.id.slice(0,8).toUpperCase()}`,qrCode:x.qr_code,name:x.name,model:x.model||'',serialNumber:x.serial_number||'',photo_path:x.photo_path,history:timeline.get(x.id)||[],updated:new Date(x.updated_at).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'})}));
    window.betaTasks=(tasks.data||[]).map(x=>({...x,equipment:names.get(x.equipment_id)||'—',assignee:x.assigned_to||'Sin asignar',due:x.due_date||'Sin fecha'}));
    window.betaIssues=(issues.data||[]).map(x=>({...x,equipment:names.get(x.equipment_id)||'—',area:x.description||'General',reported:new Date(x.created_at).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'})}));
    window.betaChecks=(checks.data||[]).map(x=>({...x,title:x.check_name,sector:x.notes||'General',person:x.checked_by===user.id?(profile?.full_name||user.email):'Personal del hotel',time:new Date(x.checked_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),verified:x.verification_status==='verified'}));
    const {data:ms,error:me}=await sb.from('hotel_memberships').select('id,user_id,role,status,requested_at').eq('hotel_id',hid).order('requested_at',{ascending:false}); if (me) throw me;
    const ids=(ms||[]).map(x=>x.user_id); let profs=[]; if(ids.length){const {data,error}=await sb.from('profiles').select('id,full_name').in('id',ids);if(error)throw error;profs=data||[];}
    const pmap=new Map(profs.map(x=>[x.id,x.full_name])); members=(ms||[]).map(x=>({...x,full_name:pmap.get(x.user_id)||'Usuario'}));
    sessionBox.innerHTML=`<span class="muted">${esc(profile?.full_name||user.email)} · ${esc(membership.role.replace('_',' '))}</span><button class="btn quiet" id="logout">Salir</button>`; $('#logout').onclick=signOut;
    if(location.hash.startsWith('#asset=')){const qr=decodeURIComponent(location.hash.slice(7));const found=assets.find(x=>x.qr_code===qr||x.id===qr);if(found)return showAsset(found);}
    renderHome();
  }
  function renderHome() {
    root.innerHTML=`${shell('Activos','Inventario compartido y trazabilidad de mantenimiento.',`<button class="btn primary" id="newAsset">＋ Registrar activo</button>`)}<div class="toolbar"><input id="search" class="input" placeholder="Buscar por nombre, serie o ubicación"><select id="statusFilter" class="input" style="max-width:190px"><option value="">Todos los estados</option>${Object.entries(statusLabels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div class="grid" id="assetGrid"></div>${canManageTeam()?`<section class="panel" style="margin-top:25px"><div class="row"><div><h2>Solicitudes del personal</h2><p>Revisá y aprobá los accesos al hotel.</p></div></div><div id="memberList"></div></section>`:''}`;
    $('#newAsset').onclick=showNewAsset; $('#search').oninput=filterAssets; $('#statusFilter').onchange=filterAssets; drawAssets(); if(canManageTeam())drawMembers();
  }
  function drawAssets() {
    const grid=$('#assetGrid'); if(!grid)return;
    if(!assets.length){grid.innerHTML='<section class="panel empty"><h2>Todavía no hay activos</h2><p>Registrá el primer equipo para generar su código QR y comenzar el historial.</p><button class="btn primary" id="emptyNew">Registrar primer activo</button></section>';$('#emptyNew').onclick=showNewAsset;return;}
    grid.innerHTML=assets.map(x=>`<article class="panel asset" data-asset="${esc(x.id)}"><div class="thumb placeholder">▤</div><div><div class="row"><h3>${esc(x.name)}</h3><span class="badge ${esc(x.status)}">${esc(statusLabels[x.status]||x.status)}</span></div><p>${esc(x.category)} · ${esc(x.location)}</p><p class="muted">${esc(x.code)} · ${esc(x.model)} ${x.serial_number?`· Serie ${esc(x.serial_number)}`:''}</p><div class="actions"><button class="btn primary" data-view="${esc(x.id)}">Ficha e historial</button></div></div></article>`).join('');
    grid.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showAsset(assets.find(x=>x.id===b.dataset.view)));
    hydratePhotos(grid);
  }
  async function hydratePhotos(scope) { for(const x of assets.filter(a=>a.photo_path)){const el=scope.querySelector(`[data-asset="${CSS.escape(x.id)}"] .thumb`);if(!el)continue;const {data,error}=await sb.storage.from('equipment-photos').createSignedUrl(x.photo_path,1800);if(!error&&data?.signedUrl){el.classList.remove('placeholder');el.innerHTML=`<img class="thumb" src="${esc(data.signedUrl)}" alt="${esc(x.name)}">`;}} }
  function filterAssets(){const q=$('#search').value.trim().toLowerCase(),s=$('#statusFilter').value;document.querySelectorAll('[data-asset]').forEach(el=>{const x=assets.find(a=>a.id===el.dataset.asset);el.hidden=!(JSON.stringify([x?.name,x?.model,x?.serial_number,x?.location,x?.code]).toLowerCase().includes(q)&&(!s||x.status===s));});}
  function drawMembers(){const box=$('#memberList');if(!box)return;const pending=members.filter(m=>m.status==='pending');box.innerHTML=pending.length?pending.map(m=>`<div class="row" style="padding:12px 0;border-bottom:1px solid var(--line)"><div><b>${esc(m.full_name)}</b><p class="muted">${esc(m.role)} · solicitó ${new Date(m.requested_at).toLocaleDateString('es-AR')}</p></div><div class="actions"><select class="input" data-role="${esc(m.id)}"><option value="technician" ${m.role==='technician'?'selected':''}>Técnico</option><option value="supervisor" ${m.role==='supervisor'?'selected':''}>Supervisor</option><option value="staff" ${m.role==='staff'?'selected':''}>Personal operativo</option></select><button class="btn primary" data-approve="${esc(m.id)}">Aprobar</button><button class="btn danger" data-reject="${esc(m.id)}">Rechazar</button></div></div>`).join(''):'<p class="muted">No hay solicitudes pendientes.</p>';
    box.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const role=$(`[data-role="${b.dataset.approve}"]`).value;const {error}=await sb.rpc('approve_hotel_membership',{_membership_id:b.dataset.approve,_approved_role:role});if(error)throw error;toast('Acceso aprobado');await loadWorkspace();}catch(e){fail(e);b.disabled=false;}});
    box.querySelectorAll('[data-reject]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const {error}=await sb.rpc('reject_hotel_membership',{_membership_id:b.dataset.reject,_reason:'Revisar con el responsable del hotel'});if(error)throw error;toast('Solicitud rechazada');await loadWorkspace();}catch(e){fail(e);b.disabled=false;}});
  }
  function showNewAsset(){root.innerHTML=`${shell('Registrar activo','Identificación, ubicación y seguimiento QR.')}<form class="panel" id="assetForm" style="max-width:760px;margin:22px auto"><div class="grid"><div class="field"><label>Nombre del activo *</label><input class="input" name="name" required placeholder="Bomba de agua principal"></div><div class="field"><label>Categoría *</label><input class="input" name="category" required placeholder="Hidráulica"></div><div class="field"><label>Marca / modelo</label><input class="input" name="model"></div><div class="field"><label>Número de serie</label><input class="input" name="serial_number"></div><div class="field"><label>Ubicación exacta *</label><input class="input" name="location" required placeholder="Subsuelo · sala de máquinas"></div><div class="field"><label>Foto del activo</label><input class="input" name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"><small class="muted">Se guardará de forma privada para el equipo del hotel.</small></div><div class="field" style="grid-column:1/-1"><label>Observaciones iniciales</label><textarea class="input" name="notes"></textarea></div></div><div class="actions"><button class="btn primary">Guardar activo y crear QR</button><button class="btn" type="button" id="cancelAsset">Cancelar</button></div></form>`;$('#cancelAsset').onclick=renderHome;$('#assetForm').onsubmit=saveNewAsset;}
  async function saveNewAsset(e){e.preventDefault();const form=e.currentTarget,btn=form.querySelector('button[type="submit"],button:not([type])');btn.disabled=true;const v=Object.fromEntries(new FormData(form));let path=null;const file=form.elements.photo.files[0];
    try { const id=crypto.randomUUID(); if(file){path=`${hotel.id}/${id}/${crypto.randomUUID()}.${file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg'}`;const {error}=await sb.storage.from('equipment-photos').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;}
      const {data,error}=await sb.from('equipment').insert({hotel_id:hotel.id,name:v.name.trim(),category:v.category.trim(),location:v.location.trim(),status:'operational',notes:v.notes.trim(),model:v.model.trim(),serial_number:v.serial_number.trim()||null,photo_path:path,created_by:user.id}).select('*').single();if(error)throw error;
      toast('Activo guardado; QR e historial creados');await loadWorkspace();const created=assets.find(x=>x.id===data.id);if(created)showAsset(created);
    }catch(err){if(path)await sb.storage.from('equipment-photos').remove([path]).catch(()=>{});fail(err,'No se pudo registrar el activo.');btn.disabled=false;}
  }
  async function showAsset(x){if(!x)return;activeAsset=x;const {data:photo}=x.photo_path?await sb.storage.from('equipment-photos').createSignedUrl(x.photo_path,1800):{data:null};
    const editable=canManage();root.innerHTML=`${shell('Ficha del activo',`${esc(x.category)} · ${esc(x.location)}`,`<button class="btn" id="backAssets">← Volver a activos</button>`)}<div class="grid" style="grid-template-columns:minmax(250px,.7fr) minmax(300px,1.3fr)"><section class="panel"><div class="row"><div><h2>${esc(x.name)}</h2><p>${esc(x.code)} · ${esc(x.model)} ${x.serial_number?`· Serie ${esc(x.serial_number)}`:''}</p></div><span class="badge ${esc(x.status)}">${esc(statusLabels[x.status]||x.status)}</span></div>${x.notes?`<p><b>Observaciones:</b> ${esc(x.notes)}</p>`:''}${photo?.signedUrl?`<img src="${esc(photo.signedUrl)}" alt="${esc(x.name)}" style="width:100%;max-height:300px;object-fit:cover;border-radius:10px">`:''}<div class="qrbox"><canvas id="qrCanvas"></canvas><b>QR del activo</b><small>Escanealo con la cámara después de iniciar sesión en DubIoT Beta.</small><button class="btn primary" id="downloadQr">Descargar QR para imprimir</button></div>${editable?`<form id="statusForm" class="field"><label>Estado</label><select class="input" name="status">${Object.entries(statusLabels).map(([k,v])=>`<option value="${k}" ${x.status===k?'selected':''}>${v}</option>`).join('')}</select><button class="btn">Actualizar estado</button></form>`:''}</section><section class="panel"><div class="row"><div><h2>Historial compartido</h2><p>${x.history.length} eventos · orden cronológico</p></div></div><form id="eventForm" class="field"><label>Nuevo evento</label><select name="event_type" class="input"><option value="inspection">Inspección</option><option value="maintenance">Mantenimiento</option><option value="repair">Reparación</option><option value="part_replaced">Repuesto</option><option value="issue">Incidencia</option><option value="note">Observación</option></select><input name="title" class="input" required maxlength="160" placeholder="Título breve"><textarea name="details" class="input" maxlength="5000" placeholder="Trabajo realizado, mediciones, piezas o próximo control"></textarea><button class="btn primary">Guardar en historial</button></form><div class="timeline">${x.history.length?x.history.map(ev=>`<article class="event"><b>${esc(ev.kind)} · ${esc(ev.at)}</b><p>${esc(ev.text)}</p><small class="muted">${esc(ev.actor)}</small></article>`).join(''):'<p class="muted">Todavía no hay eventos.</p>'}</div></section></div>`;
    $('#backAssets').onclick=renderHome;
    if(window.QRCode)QRCode.toCanvas($('#qrCanvas'),`${location.origin}${location.pathname}#asset=${encodeURIComponent(x.qr_code)}`,{width:220,margin:2,color:{dark:'#052039',light:'#ffffff'}});
    $('#downloadQr').onclick=()=>{const a=document.createElement('a');a.download=`${x.code}-qr.png`;a.href=$('#qrCanvas').toDataURL('image/png');a.click();};
    $('#eventForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;const v=Object.fromEntries(new FormData(e.currentTarget));try{const {error}=await sb.from('equipment_history').insert({hotel_id:hotel.id,equipment_id:x.id,event_type:v.event_type,title:v.title.trim(),details:v.details.trim(),actor_id:user.id});if(error)throw error;toast('Evento guardado para todo el equipo');await loadWorkspace();showAsset(assets.find(a=>a.id===x.id));}catch(err){fail(err);b.disabled=false;}};
    $('#statusForm')?.addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const {error}=await sb.from('equipment').update({status:e.currentTarget.elements.status.value}).eq('id',x.id).eq('hotel_id',hotel.id);if(error)throw error;toast('Estado actualizado e incorporado al historial');await loadWorkspace();showAsset(assets.find(a=>a.id===x.id));}catch(err){fail(err);b.disabled=false;}});
  }
  async function signOut(){await sb.auth.signOut();user=null;membership=null;hotel=null;assets=[];showAuth();}
  async function start(){
    if(!sb){root.innerHTML='<section class="panel auth"><h1>Configuración pendiente</h1><p>No se encontró la URL o la clave publicable de Supabase. Revisá <code>supabase-config.js</code>.</p></section>';return;}
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./beta-sw.js').catch(()=>{});
    const {data,error}=await sb.auth.getSession();if(error)throw error;
    sb.auth.onAuthStateChange((_event,session)=>{if(session?.user)setTimeout(()=>acceptSession(session.user).catch(e=>{fail(e,'No se pudieron cargar los datos del hotel.');showAuth();}),0);else{user=null;membership=null;hotel=null;showAuth();}});
    if(data.session?.user)await acceptSession(data.session.user);else showAuth();
  }
  start().catch(e=>{fail(e,'No se pudo conectar con Supabase.');root.innerHTML=`<section class="panel auth"><h1>No se pudo conectar</h1><p>${esc(e.message||'Revisá la conexión y la clave publicable.')}</p><button class="btn" onclick="location.reload()">Reintentar</button></section>`;});
})();
