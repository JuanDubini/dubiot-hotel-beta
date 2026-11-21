(() => {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusLabels = {operational:'Operativo',review:'En revisión',critical:'Crítico',out_of_service:'Fuera de servicio'};
  const orderStatusLabels = {open:'Abierta',assigned:'Asignada',in_progress:'En curso',waiting_parts:'En espera de repuestos',resolved:'Resuelta',verified:'Verificada y cerrada'};
  const priorityLabels = {urgent:'Urgente',high:'Alta',medium:'Media',low:'Baja'};
  const sourceLabels = {manual:'Manual',control:'Control',sensor:'Sensor',preventive:'Preventivo',request:'Solicitud'};
  const resultLabels = {ok:'Correcto',observation:'Con observación',failure:'Falla encontrada',not_done:'No realizado'};
  let orders=[], categories=[], checkTypes=[], schemaReady=false, activeSection='', boardMode=false, orderFilter={status:'',priority:'',assignee:'',overdue:false}, queueCount=0, dbPromise;
  const priorityRank = {urgent:0,high:1,medium:2,low:3};
  const app = () => window.DubIoTApp;
  const ctx = () => app()?.context?.();
  const today = () => new Date().toLocaleDateString('sv-SE');
  const toast = msg => app()?.toast?.(msg);
  const fail = (e,msg) => app()?.fail?.(e,msg);
  const stateName = s => statusLabels[s] || s || 'Sin estado';
  const humanizeStatusText = text => String(text||'').replace(/\b(out_of_service|operational|review|critical)\b/g, v=>stateName(v)).replace(/\s*->\s*/g,' → ');
  const properEventCount = n => `${n} ${n===1?'evento':'eventos'} · seguimiento cronológico`;

  async function refreshData() {
    const c=ctx(); if(!c?.sb||!c.hotel?.id) return;
    try {
      const [o,cat,types]=await Promise.all([
        c.sb.from('work_orders').select('*').eq('hotel_id',c.hotel.id).order('created_at',{ascending:false}),
        c.sb.from('categories').select('id,name').eq('hotel_id',c.hotel.id).order('name'),
        c.sb.from('check_types').select('id,name').eq('hotel_id',c.hotel.id).order('name')
      ]);
      const error=[o,cat,types].find(x=>x.error);
      if(error) throw error;
      orders=o.data||[];categories=cat.data||[];checkTypes=types.data||[];schemaReady=true;
    } catch(error) {
      schemaReady=false;
      if(!/work_orders|categories|check_types|schema cache|does not exist/i.test(error?.message||'')) console.warn('No se pudieron cargar datos del sprint 2',error);
    }
  }

  function openDb(){
    if(!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no está disponible en este navegador'));
    if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open('dubiot-hotel-field',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('queue'))req.result.createObjectStore('queue',{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    return dbPromise;
  }
  async function queueRows(){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('queue','readonly').objectStore('queue').getAll();r.onsuccess=()=>resolve((r.result||[]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));r.onerror=()=>reject(r.error);});}
  async function queuePut(row){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('queue','readwrite').objectStore('queue').put(row);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
  async function queueDelete(id){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction('queue','readwrite').objectStore('queue').delete(id);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});}
  async function updateConnection(){
    try { queueCount=(await queueRows()).length; } catch { queueCount=0; }
    const session=$('#session'); if(!session)return;
    let el=$('#sprint2Connection');
    if(!el){el=document.createElement('span');el.id='sprint2Connection';el.className='connection-indicator';session.prepend(el);}
    el.textContent=!navigator.onLine?`Sin conexión · ${queueCount} en cola`:queueCount?`Conectado · ${queueCount} pendiente${queueCount===1?'':'s'}`:'Conectado';
    el.classList.toggle('offline',!navigator.onLine);el.classList.toggle('queued',queueCount>0);
  }
  function isNetworkError(e){return !navigator.onLine||/network|fetch|failed to fetch|load failed|connection|timeout/i.test(e?.message||'');}
  const readFile = file => new Promise((resolve,reject)=>{if(!file)return resolve(null);const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsArrayBuffer(file);});

  async function queueOrSend(kind,payload,file){
    const id=crypto.randomUUID(),fileData=await readFile(file);
    const item={id,kind,payload,fileData,fileType:file?.type||null,createdAt:new Date().toISOString()};
    if(!navigator.onLine){await queuePut(item);await updateConnection();return {queued:true};}
    try { await sendItem(item); await updateConnection(); return {queued:false}; }
    catch(error){if(!isNetworkError(error))throw error;await queuePut(item);await updateConnection();return {queued:true};}
  }
  async function sendItem(item){
    const c=ctx(),sb=c.sb;
    if(item.kind==='daily_check'){
      const {error}=await sb.from('daily_checks').insert(item.payload);if(error)throw error;return;
    }
    if(item.kind==='history'){
      const payload={...item.payload};
      if(item.fileData){const path=`${payload.hotel_id}/${payload.equipment_id}/history-${item.id}.${item.fileType==='image/png'?'png':item.fileType==='image/webp'?'webp':'jpg'}`;
        const {error}=await sb.storage.from('equipment-photos').upload(path,new Blob([item.fileData],{type:item.fileType}),{contentType:item.fileType,upsert:true});if(error)throw error;payload.photo_paths=[path];}
      const {error}=await sb.from('equipment_history').insert(payload);if(error)throw error;return;
    }
    if(item.kind==='asset_status'){
      const {error}=await sb.from('equipment').update({status:item.payload.status,status_reason:item.payload.status_reason||''})
        .eq('id',item.payload.equipment_id).eq('hotel_id',item.payload.hotel_id);
      if(error)throw error;return;
    }
    throw new Error('Tipo de registro sin conexión desconocido');
  }
  async function syncQueue(){
    if(!navigator.onLine)return;
    let rows=[];try{rows=await queueRows();}catch{return;}
    for(const item of rows){try{await sendItem(item);await queueDelete(item.id);}catch(error){console.warn('Registro en cola, no se pudo sincronizar',error);break;}}
    await updateConnection();
    if(rows.length&&queueCount===0){toast('Se sincronizaron los registros guardados sin conexión');await app()?.load?.();}
  }

  function setupConnection(){
    window.addEventListener('online',()=>{updateConnection();syncQueue();});
    window.addEventListener('offline',updateConnection);
    updateConnection();
  }

  function categoryNames(){const c=ctx();return categories.length?categories.map(x=>x.name):[...new Set((c?.assets||[]).map(x=>x.category).filter(Boolean))];}
  function checkTypeNames(){const c=ctx();return checkTypes.length?checkTypes.map(x=>x.name):[...new Set((c?.dailyChecks||[]).map(x=>x.check_name).filter(Boolean))];}
  function optionsFor(values,selected=''){
    const base=values.map(v=>`<option value="${esc(v)}" ${selected===v?'selected':''}>${esc(v)}</option>`).join('');
    return `<option value="">Elegir…</option>${base}<option value="__other__" ${selected==='__other__'?'selected':''}>Otro</option>`;
  }
  async function addCatalog(table,name){
    const c=ctx();if(!c?.canManageTeam())throw new Error('Solo el responsable del hotel puede agregar opciones');
    const {error}=await c.sb.from(table).insert({hotel_id:c.hotel.id,name:name.trim(),created_by:c.user.id});if(error)throw error;
    await refreshData();
  }
  function replaceInputWithSelect(input,values,selected=''){
    if(!input||input.dataset.catalogEnhanced)return input;
    const select=document.createElement('select');select.className=input.className;select.id=input.id;select.name=input.name;select.required=input.required;select.disabled=input.disabled;select.dataset.catalogEnhanced='true';select.innerHTML=optionsFor(values,selected);
    if(selected&&!values.includes(selected))select.innerHTML=`<option value="${esc(selected)}" selected>${esc(selected)}</option>`+select.innerHTML;
    input.replaceWith(select);return select;
  }
  function addOtherField(select,fieldName,managerOnly){
    if(!select||select.dataset.otherBound)return;select.dataset.otherBound='1';
    const wrap=document.createElement('div');wrap.className='field other-catalog';wrap.hidden=true;
    wrap.innerHTML=`<label for="${esc(fieldName)}">${managerOnly?'Nombre de la nueva opción':'Escribí el tipo de control'}</label><input class="input" id="${esc(fieldName)}" maxlength="120" placeholder="Nombre" ${managerOnly?'':''}><small class="muted"></small>`;
    select.after(wrap);const input=$('input',wrap),help=$('small',wrap),isManager=app()?.canManageTeam?.();
    if(managerOnly&&!isManager){help.textContent='Pedile al responsable que agregue esta opción en Configuración.';input.disabled=true;}
    select.addEventListener('change',()=>{wrap.hidden=select.value!=='__other__';input.required=select.value==='__other__'&&(!managerOnly||isManager);});
  }
  function enhanceCatalogs(){
    const c=ctx();if(!c)return;
    const assetForm=$('#assetForm');if(assetForm&&!assetForm.dataset.sprintCatalog){
      const cat=assetForm.elements.category;
      if(cat){const select=replaceInputWithSelect(cat,categoryNames());if(select){assetForm.dataset.sprintCatalog='1';addOtherField(select,'newCategory',true);}}
    }
    const checkForm=$('#dailyCheckForm');if(checkForm&&!checkForm.dataset.sprintCatalog){
      const old=checkForm.elements.check_name;
      if(old){const select=replaceInputWithSelect(old,checkTypeNames());if(select){checkForm.dataset.sprintCatalog='1';addOtherField(select,'newCheckType',true);}}
    }
    const edit=$('#editAssetForm');if(edit&&!edit.dataset.sprintCatalog){const input=edit.elements.category;if(input){const select=replaceInputWithSelect(input,categoryNames(),input.value);if(select){edit.dataset.sprintCatalog='1';addOtherField(select,'editCategory',true);}}}
  }
  function statusIndicator(){
    const root=$('#root');if(!root)return;
    root.querySelectorAll('.timeline .event p').forEach(p=>{if(p.dataset.translated)return;p.textContent=humanizeStatusText(p.textContent);p.dataset.translated='1';});
    const count=root.querySelector('.row h2 + p');if(count&&/eventos · seguimiento cronológico/.test(count.textContent)){const number=Number.parseInt(count.textContent,10);count.textContent=properEventCount(number);}
    if(!app()?.canManage?.())root.querySelectorAll('.desktop-tabs .navtab').forEach(b=>{if(/verificar controles/i.test(b.textContent))b.remove();});
  }
  function addPanelNav(){
    const nav=$('.desktop-tabs');if(!nav||nav.dataset.sprintNav)return;nav.dataset.sprintNav='1';
    const c=ctx();const ordersBtn=document.createElement('button');ordersBtn.className='navtab';ordersBtn.textContent='Órdenes de trabajo';ordersBtn.dataset.sprintSection='orders';nav.append(ordersBtn);
    if(c?.canManageTeam()){const cfgBtn=document.createElement('button');cfgBtn.className='navtab';cfgBtn.textContent='Configuración';cfgBtn.dataset.sprintSection='settings';nav.append(cfgBtn);}
  }
  function route(section,filters={}){activeSection=section;orderFilter={...orderFilter,...filters};app()?.render?.();}
  function onDocumentClick(e){
    const baseTab=e.target.closest('[data-tab]');if(baseTab){activeSection='';return;}
    const detailTab=e.target.closest('[data-detail-tab]');if(detailTab){activeSection='';return;}
    const baseAction=e.target.closest('[data-goto]');if(baseAction&&baseAction.dataset.goto==='assets'&&!baseAction.classList.contains('metric-card')){activeSection='';return;}
    const fieldRoute=e.target.closest('[data-sprint-section="field"]');if(fieldRoute){e.preventDefault();e.stopImmediatePropagation();route('');return;}
    const backBtn=e.target.closest('[data-sprint-back]');if(backBtn){const target=backBtn.dataset.sprintBack;if(target==='assets'||target==='maintenance'){e.preventDefault();e.stopImmediatePropagation();activeSection='';app()?.setView?.(target);return;}if(target==='dashboard'){e.preventDefault();e.stopImmediatePropagation();activeSection='';app()?.setView?.('dashboard');return;}}
    const sectionBtn=e.target.closest('[data-sprint-section]');
    if(sectionBtn){e.preventDefault();e.stopImmediatePropagation();const section=sectionBtn.dataset.sprintSection;
      if(section==='dashboard'||section==='assets'||section==='maintenance'){activeSection='';app()?.setView?.(section);return;}
      route(section);return;}
    const kpi=e.target.closest('.metric-card[data-goto]');
    if(kpi){const text=kpi.textContent.toLowerCase();if(text.includes('controles por revisar')){activeSection='';app()?.setView?.('maintenance');e.preventDefault();e.stopImmediatePropagation();return;}
      if(text.includes('órdenes de trabajo abiertas')||text.includes('órdenes e incidencias')){e.preventDefault();e.stopImmediatePropagation();route('orders',{status:'active'});return;}
      if(text.includes('tareas en curso')){e.preventDefault();e.stopImmediatePropagation();route('orders',{status:'in_progress'});return;}
      if(text.includes('activos operativos')){e.preventDefault();e.stopImmediatePropagation();activeSection='';app()?.setView?.('assets');setTimeout(()=>{const f=$('#statusFilter');if(f){f.value='operational';f.dispatchEvent(new Event('change',{bubbles:true}));}},0);return;}}
    const follow=e.target.closest('[data-goto="maintenance"]');if(follow&&/ver seguimiento/i.test(follow.textContent)){e.preventDefault();e.stopImmediatePropagation();route('orders');return;}
    const newAsset=e.target.closest('#newAsset');if(newAsset)setTimeout(()=>{ensurePanelMenu();enhanceCatalogs();},20);
    if(e.target.closest('[data-view]'))setTimeout(enhanceAssetDetail,120);
    if(e.target.closest('#search'))setTimeout(showClearSearch,20);
  }
  function ensurePanelMenu(){if(ctx()?.mode!=='panel')return;const root=$('#root');if(!root||root.querySelector('.sprint2-form-nav'))return;const nav=document.createElement('nav');nav.className='desktop-nav sprint2-form-nav';nav.innerHTML=`<a class="brand" href="./panel.html"><img src="dubiot-logo-canal.svg" alt=""><span><b>DubIoT</b><small>HOTEL OPERATIONS · PANEL DE PC</small></span></a><div class="desktop-tabs"><button class="navtab" data-sprint-section="dashboard">Resumen</button><button class="navtab" data-sprint-back="assets">Activos</button><button class="navtab" data-sprint-back="maintenance">Verificar controles</button><button class="navtab" data-sprint-section="orders">Órdenes de trabajo</button>${app()?.canManageTeam?.()?'<button class="navtab" data-sprint-section="settings">Configuración</button>':''}</div><a class="btn" href="./beta.html">Abrir app de campo ↗</a>`;root.prepend(nav);}
  function showClearSearch(){const s=$('#search');if(!s)return;const root=s.closest('.toolbar,.field-assets-head');if(!root||root.querySelector('[data-clear-search]'))return;const b=document.createElement('button');b.className='btn';b.dataset.clearSearch='1';b.textContent='Limpiar búsqueda';b.onclick=()=>{s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));};root.append(b);}
  function showEmptyActions(){
    if(ctx()?.mode==='panel'&&activeSection===''&&app()?.context?.().activeView==='maintenance'){
      const section=$('.verification-list');if(section&&!section.querySelector('[data-first-check]')&&/no hay controles pendientes/i.test(section.textContent)){const b=document.createElement('a');b.href='./beta.html';b.className='btn primary';b.dataset.firstCheck='1';b.textContent='Cargar primer control';section.append(b);}
    }
  }

  const orderByPriority = list => [...list].sort((a,b)=>(priorityRank[a.priority]??9)-(priorityRank[b.priority]??9)||new Date(a.due_at||'9999-01-01')-new Date(b.due_at||'9999-01-01'));
  function refreshDashboardKpis(){
    const c=ctx();if(c?.mode!=='panel'||c.activeView!=='dashboard')return;
    const cards=$$('.metric-card');if(cards.length<4)return;
    const active=orders.filter(o=>!['verified','resolved'].includes(o.status));
    const inProgress=orders.filter(o=>o.status==='in_progress');
    cards[1].querySelector('span').textContent='Órdenes de trabajo abiertas';
    cards[1].querySelector('strong').textContent=String(active.length);
    cards[1].querySelector('small').textContent='Órdenes que requieren seguimiento';
    cards[2].querySelector('strong').textContent=String(inProgress.length);
    cards[2].querySelector('small').textContent=`De ${active.length} órdenes abiertas`;
  }
  const overdue = o => o.due_at&&new Date(o.due_at)<new Date()&&!['verified','resolved'].includes(o.status);
  function orderCard(o,field=false){
    const c=ctx(),asset=c.assets.find(a=>a.id===o.asset_id),technician=!c.canManage(),assignee=c.members.find(m=>m.user_id===o.assigned_to);
    const photoInput=field&&technician?`<label class="photo-prompt">Foto de resolución (obligatoria)<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-order-photo="${esc(o.id)}"></label>`:'';
    let actions='';
    if(field&&technician){
      if(['assigned','waiting_parts'].includes(o.status))actions+=`<button class="btn primary" data-order-action="start" data-id="${esc(o.id)}">Tomar / Reanudar</button>`;
      if(o.status==='in_progress')actions+=`<button class="btn" data-order-action="pause" data-id="${esc(o.id)}">Pausar</button>${photoInput}<button class="btn primary" data-order-action="resolve" data-id="${esc(o.id)}" disabled>Resolver con foto</button>`;
    } else if(c.canManage()){
      if(o.status==='resolved')actions+=`<button class="btn primary" data-order-action="verify" data-id="${esc(o.id)}">Verificar y cerrar</button>`;
      else if(o.status!=='verified')actions+=`<select class="input order-assignee" data-order-assignee="${esc(o.id)}"><option value="">Sin asignar</option>${c.members.filter(m=>m.role==='technician'&&m.status==='active').map(m=>`<option value="${esc(m.user_id)}" ${o.assigned_to===m.user_id?'selected':''}>${esc(m.full_name)}</option>`).join('')}</select><button class="btn" data-order-action="assign" data-id="${esc(o.id)}">Guardar asignación</button>`;
    }
    return `<article class="order-card ${overdue(o)?'is-overdue':''}"><div class="order-top"><span class="badge ${esc(o.priority)}">${esc(priorityLabels[o.priority]||o.priority)}</span><span class="badge ${esc(o.status)}">${esc(orderStatusLabels[o.status]||o.status)}</span></div><h3>${esc(o.title)}</h3><p>${esc(asset?.name||'Activo eliminado')} · ${esc(asset?.location||'')}</p><p class="muted">${esc(o.description||'Sin detalle')}</p><div class="order-meta"><span>${esc(sourceLabels[o.source]||o.source)}</span><span>${esc(assignee?.full_name||'Sin asignar')}</span><span>${o.due_at?`Vence ${esc(new Date(o.due_at).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'}))}`:'Sin vencimiento'}</span>${overdue(o)?'<b class="danger">Vencida</b>':''}</div>${o.notes?`<p class="muted">Notas: ${esc(o.notes)}</p>`:''}<div class="actions">${actions}</div></article>`;
  }
  function filteredOrders(){
    const c=ctx(),technician=!c.canManage();let list=orders;
    if(technician)list=list.filter(o=>o.assigned_to===c.user.id);
    if(orderFilter.status==='active')list=list.filter(o=>!['verified','resolved'].includes(o.status));
    else if(orderFilter.status)list=list.filter(o=>o.status===orderFilter.status);
    if(orderFilter.priority)list=list.filter(o=>o.priority===orderFilter.priority);
    if(orderFilter.assignee)list=list.filter(o=>o.assigned_to===orderFilter.assignee);
    if(orderFilter.overdue)list=list.filter(overdue);
    return orderByPriority(list);
  }
  function renderOrders(){
    const c=ctx(),main=$('.pc-main');if(!main)return;
    const list=filteredOrders();
    const technicians=c.members.filter(m=>m.role==='technician'&&m.status==='active');
    const filters=`<div class="toolbar order-filters"><select class="input" id="orderStatus"><option value="">Todos los estados</option><option value="active" ${orderFilter.status==='active'?'selected':''}>Abiertas y asignadas</option>${Object.entries(orderStatusLabels).map(([k,v])=>`<option value="${k}" ${orderFilter.status===k?'selected':''}>${v}</option>`).join('')}</select><select class="input" id="orderPriority"><option value="">Todas las prioridades</option>${Object.entries(priorityLabels).map(([k,v])=>`<option value="${k}" ${orderFilter.priority===k?'selected':''}>${v}</option>`).join('')}</select>${!c.canManage()?'':`<select class="input" id="orderAssignee"><option value="">Todos los técnicos</option>${technicians.map(m=>`<option value="${esc(m.user_id)}" ${orderFilter.assignee===m.user_id?'selected':''}>${esc(m.full_name)}</option>`).join('')}</select>`}<label class="check-filter"><input type="checkbox" id="orderOverdue" ${orderFilter.overdue?'checked':''}> Solo vencidas</label><button class="btn" id="toggleBoard">${boardMode?'Ver lista':'Ver Kanban'}</button><button class="btn" id="exportOrders">Descargar órdenes CSV</button></div>`;
    const create=c.canManage()?`<details class="panel create-order"><summary class="btn primary">＋ Nueva orden de trabajo</summary><form id="newOrderForm" class="grid"><label class="field">Activo<select class="input" name="asset_id" required>${c.assets.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.location)}</option>`).join('')}</select></label><label class="field">Título<input class="input" name="title" required maxlength="160"></label><label class="field">Prioridad<select class="input" name="priority">${Object.entries(priorityLabels).map(([k,v])=>`<option value="${k}" ${k==='medium'?'selected':''}>${v}</option>`).join('')}</select></label><label class="field">Asignar a<select class="input" name="assigned_to"><option value="">Sin asignar</option>${technicians.map(m=>`<option value="${esc(m.user_id)}">${esc(m.full_name)}</option>`).join('')}</select></label><label class="field">Fecha límite<input class="input" name="due_at" type="datetime-local"></label><label class="field" style="grid-column:1/-1">Descripción<textarea class="input" name="description" maxlength="5000"></textarea></label><button class="btn primary">Crear orden</button></form></details>`:'';
    const content=boardMode?`<div class="kanban">${Object.entries(orderStatusLabels).map(([status,label])=>`<section class="kanban-column"><h3>${esc(label)} <span>${list.filter(o=>o.status===status).length}</span></h3>${list.filter(o=>o.status===status).map(o=>orderCard(o)).join('')||'<p class="muted">Sin órdenes</p>'}</section>`).join('')}</div>`:`<div class="orders-list">${list.map(o=>orderCard(o)).join('')||`<section class="panel empty"><h2>${orders.length?'No hay órdenes con estos filtros':'Todavía no hay órdenes de trabajo'}</h2><p>${orders.length?'Cambiá los filtros para ver otras órdenes.':'Una falla de control puede crear una orden automáticamente.'}</p>${orders.length?'<button class="btn" id="clearOrderFilters">Limpiar filtros</button>':''}</section>`}</div>`;
    main.innerHTML=`<div class="row mobile-stack"><div><p class="muted">DubIoT · ${esc(c.hotel.name)}</p><h1>${c.canManage()?'Órdenes de trabajo':'Mis tareas de hoy'}</h1><p>${c.canManage()?'Asigná, priorizá y seguí el trabajo del hotel.':'Órdenes asignadas a tu usuario, ordenadas por prioridad y vencimiento.'}</p></div>${c.canManage()?'<span class="badge">'+orders.length+' órdenes</span>':''}</div>${!schemaReady?'<div class="notice">Falta aplicar la migración 007 para habilitar órdenes y catálogos.</div>':''}${c.canManage()?create:''}${filters}${content}`;
    $('#orderStatus')?.addEventListener('change',e=>{orderFilter.status=e.target.value;renderOrders();});$('#orderPriority')?.addEventListener('change',e=>{orderFilter.priority=e.target.value;renderOrders();});$('#orderAssignee')?.addEventListener('change',e=>{orderFilter.assignee=e.target.value;renderOrders();});$('#orderOverdue')?.addEventListener('change',e=>{orderFilter.overdue=e.target.checked;renderOrders();});$('#toggleBoard')?.addEventListener('click',()=>{boardMode=!boardMode;renderOrders();});$('#clearOrderFilters')?.addEventListener('click',()=>{orderFilter={status:'',priority:'',assignee:'',overdue:false};renderOrders();});$('#exportOrders')?.addEventListener('click',exportOrdersCsv);
    $('#newOrderForm')?.addEventListener('submit',createOrder);
  }
  function exportOrdersCsv(){
    const rows=[['Activo','Ubicación','Orden','Prioridad','Estado','Asignado a','Vencimiento','Inicio','Resolución','Minutos','Detalle']];
    for(const o of filteredOrders()){const c=ctx(),asset=c.assets.find(a=>a.id===o.asset_id),person=c.members.find(m=>m.user_id===o.assigned_to);rows.push([asset?.name||'',asset?.location||'',o.title,priorityLabels[o.priority]||o.priority,orderStatusLabels[o.status]||o.status,person?.full_name||'',o.due_at||'',o.started_at||'',o.resolved_at||'',o.time_spent_min,o.description]);}
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='DubIoT - Órdenes de trabajo.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200);
  }
  async function refreshOrders(){const c=ctx();const {data,error}=await c.sb.from('work_orders').select('*').eq('hotel_id',c.hotel.id).order('created_at',{ascending:false});if(error)throw error;orders=data||[];}
  async function createOrder(e){
    e.preventDefault();const c=ctx(),f=e.currentTarget,b=e.submitter,v=Object.fromEntries(new FormData(f));b.disabled=true;
    try{const {error}=await c.sb.from('work_orders').insert({hotel_id:c.hotel.id,asset_id:v.asset_id,title:v.title.trim(),description:v.description.trim(),source:'manual',priority:v.priority,assigned_to:v.assigned_to||null,due_at:v.due_at?new Date(v.due_at).toISOString():null,created_by:c.user.id});if(error)throw error;toast('Orden de trabajo creada');await refreshOrders();renderOrders();}
    catch(error){fail(error,'No se pudo crear la orden.');b.disabled=false;}
  }
  async function updateOrder(id,patch){const c=ctx();const {error}=await c.sb.from('work_orders').update(patch).eq('id',id).eq('hotel_id',c.hotel.id);if(error)throw error;await refreshOrders();await app().load();}
  async function orderAction(e){
    const b=e.target.closest('[data-order-action]');if(!b)return;const c=ctx(),o=orders.find(x=>x.id===b.dataset.id);if(!o)return;b.disabled=true;
    try{
      if(b.dataset.orderAction==='assign'){const assignee=$(`[data-order-assignee="${CSS.escape(o.id)}"]`)?.value||null;await updateOrder(o.id,{assigned_to:assignee,status:assignee?'assigned':'open'});return;}
      if(b.dataset.orderAction==='verify'){await updateOrder(o.id,{status:'verified'});toast('Orden verificada y cerrada');return;}
      const elapsed=o.started_at?Math.max(0,Math.floor((Date.now()-new Date(o.started_at).getTime())/60000)):0;
      if(b.dataset.orderAction==='start'){await updateOrder(o.id,{status:'in_progress'});return;}
      if(b.dataset.orderAction==='pause'){await updateOrder(o.id,{status:'waiting_parts',time_spent_min:(o.time_spent_min||0)+elapsed});return;}
      if(b.dataset.orderAction==='resolve'){
        const file=$(`[data-order-photo="${CSS.escape(o.id)}"]`)?.files?.[0];if(!file)throw new Error('Sacá o seleccioná una foto para resolver la orden');
        const asset=c.assets.find(a=>a.id===o.asset_id),path=`${c.hotel.id}/${o.asset_id}/order-${o.id}-${Date.now()}.${file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg'}`;
        const {error:uploadError}=await c.sb.storage.from('equipment-photos').upload(path,file,{contentType:file.type,upsert:false});if(uploadError)throw uploadError;
        const {error}=await c.sb.from('work_orders').update({status:'resolved',time_spent_min:(o.time_spent_min||0)+elapsed,photos:[...(o.photos||[]),path],notes:window.prompt('Nota de resolución (opcional):','')||o.notes||''}).eq('id',o.id).eq('hotel_id',c.hotel.id);if(error)throw error;
        toast(`Resolución registrada${asset?' para '+asset.name:''}`);await refreshOrders();await app().load();return;
      }
    }catch(error){fail(error,'No se pudo actualizar la orden.');b.disabled=false;}
  }

  function fieldTaskBlock(){
    const c=ctx();if(c?.mode!=='field')return;
    const container=$('.field-layout');if(!container||$('#myWorkOrders'))return;
    const mine=orderByPriority(orders.filter(o=>o.assigned_to===c.user.id&&!['verified','resolved'].includes(o.status)));
    const section=document.createElement('section');section.id='myWorkOrders';section.className='panel my-work-orders';
    section.innerHTML=`<div class="row"><div><h2>Mis tareas de hoy</h2><p>${mine.length?`${mine.length} orden${mine.length===1?'':'es'} asignada${mine.length===1?'':'s'}`:'No tenés órdenes asignadas.'}</p></div><button class="btn" data-sprint-section="orders">Abrir tareas</button></div>${mine.map(o=>orderCard(o,true)).join('')||'<p class="muted">Las órdenes que te asigne el responsable aparecerán acá.</p>'}`;
    container.prepend(section);
    section.querySelectorAll('[data-order-photo]').forEach(input=>input.onchange=()=>{const btn=section.querySelector(`[data-order-action="resolve"][data-id="${CSS.escape(input.dataset.orderPhoto)}"]`);if(btn)btn.disabled=!input.files?.length;});
  }
  function renderFieldOrders(){
    const c=ctx(),root=$('#root');if(!root)return;
    const mine=orderByPriority(orders.filter(o=>o.assigned_to===c.user.id&&!['verified','resolved'].includes(o.status)));
    root.innerHTML=`<main class="wrap"><div class="row mobile-stack"><div><p class="muted">DubIoT · ${esc(c.hotel.name)}</p><h1>Mis tareas de hoy</h1><p>Órdenes asignadas, ordenadas por prioridad y vencimiento.</p></div><button class="btn" data-sprint-section="field">← Volver a la app de campo</button></div><div class="orders-list field-orders-list">${mine.map(o=>orderCard(o,true)).join('')||'<section class="panel empty"><h2>No tenés tareas pendientes</h2><p>Cuando el responsable te asigne una orden, aparecerá acá.</p></section>'}</div></main>`;
    root.querySelectorAll('[data-order-photo]').forEach(input=>input.onchange=()=>{const b=root.querySelector(`[data-order-action="resolve"][data-id="${CSS.escape(input.dataset.orderPhoto)}"]`);if(b)b.disabled=!input.files?.length;});
  }

  async function renderSettings(){
    const c=ctx(),main=$('.pc-main');if(!main||!c.canManageTeam())return;
    main.innerHTML=`<div class="row mobile-stack"><div><p class="muted">DubIoT · ${esc(c.hotel.name)}</p><h1>Configuración del hotel</h1><p>Administrá las listas que aparecen en la app de campo.</p></div></div><div class="catalog-grid"><section class="panel"><h2>Categorías de activos</h2><form id="addCategoryForm" class="field"><label>Nueva categoría<input class="input" name="name" required maxlength="80" placeholder="Ej.: Refrigeración"></label><button class="btn primary">Agregar categoría</button></form><ul class="catalog-list">${categories.map(x=>`<li>${esc(x.name)}</li>`).join('')||'<li>No hay categorías cargadas.</li>'}</ul></section><section class="panel"><h2>Tipos de control</h2><form id="addCheckTypeForm" class="field"><label>Nuevo tipo de control<input class="input" name="name" required maxlength="120" placeholder="Ej.: Temperatura de cámara"></label><button class="btn primary">Agregar tipo de control</button></form><ul class="catalog-list">${checkTypes.map(x=>`<li>${esc(x.name)}</li>`).join('')||'<li>No hay tipos cargados.</li>'}</ul></section></div>`;
    $('#addCategoryForm').onsubmit=e=>saveCatalog(e,'categories');$('#addCheckTypeForm').onsubmit=e=>saveCatalog(e,'check_types');
  }
  async function saveCatalog(e,table){e.preventDefault();const b=e.submitter,name=new FormData(e.currentTarget).get('name').trim();b.disabled=true;try{await addCatalog(table,name);toast('Opción agregada a la lista');await renderSettings();}catch(error){fail(error,'No se pudo agregar la opción.');b.disabled=false;}}

  function enhanceAssetDetail(){
    const c=ctx(),form=$('#eventForm');if(!form||form.dataset.sprintEnhanced)return;form.dataset.sprintEnhanced='1';
    const date=document.createElement('div');date.className='field';date.innerHTML=`<label for="eventDate">Fecha del hito (no futura)</label><input class="input" id="eventDate" name="occurred_on" type="date" value="${today()}" max="${today()}" required>`;
    const file=document.createElement('div');file.className='field';file.innerHTML='<label for="eventPhoto">Foto (opcional)</label><input class="input" id="eventPhoto" name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment">';
    const button=form.querySelector('button[type="submit"],button:not([type])');form.insertBefore(date,button);form.insertBefore(file,button);if(button)button.textContent='Guardar hito';
    const historyHeader=$('.row h2',form.closest('.panel')?.parentElement||document);
    const historyPanel=form.closest('.panel');const count=historyPanel?.querySelector('.row h2 + p');if(count){const n=Number.parseInt(count.textContent,10)||0;count.textContent=properEventCount(n);}
    const actions=document.createElement('div');actions.className='actions';actions.innerHTML='<button class="btn" type="button" data-export-history>Descargar historial CSV</button>';historyPanel?.insertBefore(actions,form);
    form.onsubmit=async e=>{
      e.preventDefault();const b=e.submitter;b.disabled=true;const v=Object.fromEntries(new FormData(form)),f=form.elements.photo.files[0];
      const localDate=v.occurred_on||today();if(localDate>today()){toast('La fecha del hito no puede ser futura.');b.disabled=false;return;}
      const occurredAt=new Date(`${localDate}T00:00:00`).toISOString();const [event_type,preset]=v.phase.split('|');
      const payload={hotel_id:c.hotel.id,equipment_id:c.activeAsset?.id,
        event_type,title:`${preset}: ${v.title.trim()}`.slice(0,160),details:v.details.trim(),actor_id:c.user.id,occurred_at:occurredAt,photo_paths:[]};
      const assetId=payload.equipment_id;
      payload.equipment_id=assetId;
      if(!assetId){toast('No se pudo identificar el activo de esta ficha.');b.disabled=false;return;}
      try{const res=await queueOrSend('history',payload,f);if(preset==='Devolución al servicio'&&c.canManage()){const statusPayload={hotel_id:c.hotel.id,equipment_id:assetId,status:'operational',status_reason:''};if(res.queued)await queuePut({id:crypto.randomUUID(),kind:'asset_status',payload:statusPayload,createdAt:new Date().toISOString()});else await queueOrSend('asset_status',statusPayload);}toast(res.queued?'Hito guardado en la cola; se sincronizará al volver la conexión':'Hito agregado al historial');await app().load();}
      catch(error){fail(error,'No se pudo guardar el hito.');b.disabled=false;}
    };
  }
  function exportHistoryCsv(asset){
    const rows=[['Activo','Fecha del hito','Tipo','Título','Detalle','Responsable']];
    for(const h of asset.history)rows.push([asset.name,h.occurred_at||h.sortAt,h.kind,h.title||h.text,h.text||'',h.actor]);
    const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`DubIoT - Historial - ${String(asset.name).replace(/[\\/:*?"<>|]/g,'-')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200);
  }

  async function attachHistoryExport(e){const b=e.target.closest('[data-export-history]');if(!b)return;const c=ctx(),hash=location.hash.startsWith('#asset=')?decodeURIComponent(location.hash.slice(7)):'',asset=c.activeAsset||c.assets.find(a=>a.qr_code===hash||a.id===hash);if(asset)exportHistoryCsv(asset);}
  function scanButton(){
    if(ctx()?.mode!=='field')return;const banner=$('.field-banner');if(!banner||banner.querySelector('#scanQr'))return;
    const b=document.createElement('button');b.id='scanQr';b.className='btn primary scan-button';b.type='button';b.textContent='▣ Escanear QR del activo';banner.append(b);b.onclick=openScanner;
  }
  function openScanner(){
    let dialog=$('#qrScannerDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='qrScannerDialog';dialog.className='scanner-dialog';dialog.innerHTML='<div class="row"><h2>Escanear QR</h2><button class="btn" type="button" data-close-scanner>Cerrar</button></div><p class="muted" id="scanMessage">Apuntá la cámara al código del activo.</p><video id="qrVideo" playsinline muted></video><canvas id="qrCanvas" hidden></canvas><label class="btn" for="qrImage">Escanear una foto del QR</label><input id="qrImage" type="file" accept="image/*" capture="environment"><div class="actions"><button class="btn" type="button" data-close-scanner>Cancelar</button></div>';document.body.append(dialog);dialog.querySelectorAll('[data-close-scanner]').forEach(x=>x.onclick=closeScanner);$('#qrImage',dialog).onchange=scanImage;}
    dialog.showModal();beginCameraScan(dialog);
  }
  let scanStream=null,scanRaf=0;
  function closeScanner(){const d=$('#qrScannerDialog');if(d?.open)d.close();if(scanStream)scanStream.getTracks().forEach(t=>t.stop());scanStream=null;if(scanRaf)cancelAnimationFrame(scanRaf);}
  function openScannedAsset(value){
    closeScanner();const match=String(value||'').match(/#asset=([^&]+)/),qr=match?decodeURIComponent(match[1]):String(value||'').trim(),c=ctx();
    const asset=c.assets.find(a=>a.qr_code===qr||a.id===qr);if(asset){if(c.mode==='panel')history.replaceState(null,'',`#asset=${encodeURIComponent(asset.qr_code)}`);app().showAsset(asset);}else if(match)location.hash=`asset=${encodeURIComponent(qr)}`;else toast('El QR no corresponde a un activo de este hotel.');
  }
  async function beginCameraScan(dialog){
    const video=$('#qrVideo',dialog),message=$('#scanMessage',dialog),canvas=$('#qrCanvas',dialog),ctx2=canvas.getContext('2d',{willReadFrequently:true});
    if(!navigator.mediaDevices?.getUserMedia){message.textContent='Este navegador no habilita cámara; elegí una imagen del QR.';return;}
    try{scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.srcObject=scanStream;await video.play();
      let detector=null;if('BarcodeDetector'in window){try{detector=new BarcodeDetector({formats:['qr_code']});}catch{}}
      const loop=async()=>{if(!dialog.open||!video.videoWidth)return;try{if(detector){const codes=await detector.detect(video);if(codes.length){openScannedAsset(codes[0].rawValue);return;}}
        else if(window.jsQR){canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx2.drawImage(video,0,0,canvas.width,canvas.height);const code=window.jsQR(ctx2.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});if(code){openScannedAsset(code.data);return;}}}
        catch{}scanRaf=requestAnimationFrame(loop);};loop();
    }catch(error){message.textContent='No se pudo abrir la cámara. Elegí una imagen del QR.';console.warn('Camera access unavailable',error);}
  }
  function scanImage(e){
    const file=e.target.files?.[0];if(!file)return;if(!window.jsQR){$('#scanMessage').textContent='No se pudo cargar el lector QR. Conectate a internet o usá un teléfono compatible con BarcodeDetector.';return;}
    const image=new Image();image.onload=()=>{const canvas=$('#qrCanvas'),cx=canvas.getContext('2d',{willReadFrequently:true});canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;cx.drawImage(image,0,0);const code=window.jsQR(cx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'attemptBoth'});if(code)openScannedAsset(code.data);else $('#scanMessage').textContent='No encontramos un QR legible en esa imagen.';URL.revokeObjectURL(image.src);};image.src=URL.createObjectURL(file);
  }

  async function saveControlOfflineAware(e){
    e.preventDefault();const c=ctx(),f=e.currentTarget,b=e.submitter,v=Object.fromEntries(new FormData(f));b.disabled=true;
    try{
      if(v.check_name==='__other__'){
        const name=$('#newCheckType',f)?.value.trim();if(!name)throw new Error('Elegí un tipo de control');
        if(!c.canManageTeam())throw new Error('Solo el responsable puede agregar tipos de control');await addCatalog('check_types',name);v.check_name=name;
      }
      const payload={hotel_id:c.hotel.id,equipment_id:v.equipment_id,check_name:v.check_name.trim(),result:v.result,notes:v.notes.trim(),checked_by:c.user.id};
      const result=await queueOrSend('daily_check',payload,null);toast(result.queued?'Control guardado en la cola; se enviará cuando vuelva la conexión':'Control enviado al panel de PC para verificación');f.reset();if(!result.queued)await app().load();
    }catch(error){fail(error,'No se pudo guardar el control diario.');b.disabled=false;}
  }
  function interceptForms(e){
    if(e.target?.id==='dailyCheckForm'){e.preventDefault();e.stopImmediatePropagation();saveControlOfflineAware(e);return;}
    if(['assetForm','editAssetForm'].includes(e.target?.id)){
      const f=e.target,cat=f.elements.category,submitter=e.submitter;if(f.dataset.sprintSavingOther==='1'){delete f.dataset.sprintSavingOther;return;}
      if(cat?.value==='__other__'){
        e.preventDefault();e.stopImmediatePropagation();
        const name=$(`#${f.id==='assetForm'?'newCategory':'editCategory'}`,f)?.value.trim();
        if(!name){toast('Ingresá el nombre de la categoría nueva.');return;}
        if(!app()?.canManageTeam?.()){toast('Solo el responsable puede agregar una categoría.');return;}
        addCatalog('categories',name).then(()=>{cat.value=name;f.dataset.sprintSavingOther='1';f.requestSubmit(submitter||undefined);}).catch(error=>fail(error,'No se pudo agregar la categoría.'));
      }
      return;
    }
    if(e.target?.id==='newOrderForm'){/* handled by the own listener */return;}
  }

  async function onRender(){
    const c=ctx();if(!c?.hotel?.id)return;
    await refreshData();updateConnection();refreshDashboardKpis();
    enhanceCatalogs();statusIndicator();showEmptyActions();if(c.activeView==='assets')showClearSearch();
    if(c.mode==='panel'){addPanelNav();if(activeSection==='orders')renderOrders();else if(activeSection==='settings')renderSettings();}
    else {if(activeSection==='orders')renderFieldOrders();else{scanButton();fieldTaskBlock();}}
  }

  document.addEventListener('click',onDocumentClick,true);
  document.addEventListener('click',orderAction);
  document.addEventListener('click',attachHistoryExport,true);
  document.addEventListener('submit',interceptForms,true);
  document.addEventListener('change',e=>{if(e.target.matches('[data-order-photo]')){const b=$(`[data-order-action="resolve"][data-id="${CSS.escape(e.target.dataset.orderPhoto)}"]`);if(b)b.disabled=!e.target.files?.length;}});
  window.addEventListener('dubiot:render',onRender);
  setupConnection();
  window.addEventListener('load',()=>{onRender();syncQueue();});
})();
