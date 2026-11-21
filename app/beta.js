(() => {
  const root = document.querySelector('#root');
  const sessionBox = document.querySelector('#session');
  const toastBox = document.querySelector('#toast');
  const cfg = window.DUBIOT_SUPABASE_CONFIG || {};
  const sb = cfg.enabled && window.supabase?.createClient && cfg.url && cfg.publishableKey
    ? window.supabase.createClient(cfg.url, cfg.publishableKey) : null;
  let user = null, profile = null, membership = null, hotel = null, membershipConflict = false;
  let assets = [], members = [], activeAsset = null, toastTimer, presenceTimer=null, maintenanceTasks = [], openIssues = [], dailyChecks = [], activeView = document.body.dataset.appMode === 'field' ? 'field' : 'dashboard', lastPanelView='assets';
  const appMode = document.body.dataset.appMode || 'field';
  const $ = (sel, scope = document) => scope.querySelector(sel);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusLabels = {operational:'Operativo',review:'En revisión',critical:'Crítico',out_of_service:'Fuera de servicio'};
  const eventLabels = {created:'Alta',inspection:'Inspección',maintenance:'Mantenimiento',repair:'Reparación',replacement:'Reemplazo',part_replaced:'Repuesto',status_change:'Cambio de estado',issue:'Incidencia',note:'Observación'};
  const roleLabels = {hotel_manager:'Responsable del hotel',supervisor:'Supervisor',technician:'Técnico',staff:'Personal operativo'};
  const membershipStatusLabels = {pending:'Pendiente',active:'Activo',rejected:'Rechazado',suspended:'Suspendido'};
  const statusText = value => statusLabels[value] || value || 'Sin estado';
  const roleText = value => roleLabels[value] || value || 'Personal';
  const dateTime = value => value ? new Date(value).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'}) : 'Fecha no disponible';
  const canManage = () => ['hotel_manager','supervisor'].includes(membership?.role);
  const canManageTeam = () => membership?.role === 'hotel_manager';
  const toast = text => { toastBox.textContent = text; toastBox.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastBox.classList.remove('show'), 3200); };
  const fail = (error, fallback = 'No se pudo completar la operación.') => { console.error(error); toast(error?.message || fallback); };
  function bindPasswordToggle(input,button){const field=$(input),toggle=$(button);if(!field||!toggle)return;toggle.addEventListener('click',()=>{const reveal=field.type==='password';field.type=reveal?'text':'password';toggle.textContent=reveal?'Ocultar':'Mostrar';toggle.setAttribute('aria-label',reveal?'Ocultar contraseña':'Mostrar contraseña');toggle.setAttribute('aria-pressed',String(reveal));field.focus();});}
  window.DubIoTApp = {
    context: () => ({sb,user,profile,membership,hotel,assets,members,dailyChecks,maintenanceTasks,openIssues,activeAsset,activeView,mode:appMode,canManage,canManageTeam}),
    canManage,canManageTeam,toast,fail,
    load: loadWorkspace,
    render: () => { renderHome(); },
    setView: view => { activeView=view; renderHome(); },
    showAsset
  };

  function shell(title, subtitle, actions = '') {
    return `<div class="row mobile-stack"><div><p class="muted">DubIoT · ${esc(hotel?.name || 'Hotel Demo')}</p><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;
  }
  function showLoading(){root.innerHTML=`<section class="loading-view"><div class="loading-line"></div><h1>${appMode==='panel'?'Preparando el panel de PC':'Preparando la app de campo'}</h1><p>Conectando con el hotel y sincronizando la información…</p><div class="loading-cards"><i></i><i></i><i></i></div></section>`;}
  function showAuth(message = '') {
    sessionBox.innerHTML = '';
    root.classList.add('auth-layout');
    root.innerHTML = `<section class="panel auth"><div class="auth-heading"><span class="auth-kicker">DUBIOT · HOTEL OPERATIONS</span><h1>Acceso del equipo</h1><p>Entrá para consultar activos y registrar el mantenimiento del hotel.</p></div>${message ? `<div class="notice">${esc(message)}</div>` : ''}<div class="auth-switch" role="tablist" aria-label="Tipo de acceso"><button class="auth-tab active" id="showLogin" type="button" role="tab" aria-selected="true">Ingresar</button><button class="auth-tab" id="showSignup" type="button" role="tab" aria-selected="false">Crear cuenta</button></div><form id="authForm"><div id="nameField" class="field" hidden><label for="fullName">Nombre y apellido</label><input id="fullName" class="input" autocomplete="name"></div><div class="field"><label for="email">Correo electrónico</label><input id="email" class="input" type="email" required autocomplete="email" placeholder="nombre@hotel.com"></div><div class="field"><label for="password">Contraseña</label><div class="password-control"><input id="password" class="input" type="password" required minlength="8" autocomplete="current-password" placeholder="Ingresá tu contraseña"><button class="password-toggle" id="togglePassword" type="button" aria-label="Mostrar contraseña" aria-pressed="false">Mostrar</button></div></div><button class="btn primary auth-submit" id="authSubmit" type="submit">Ingresar</button><div class="auth-help" id="authHelp"><button class="auth-link" id="forgotPassword" type="button">Olvidé mi contraseña</button><span aria-hidden="true">·</span><button class="auth-link" id="resendConfirmation" type="button">Reenviar confirmación</button></div><p class="auth-notice muted" id="authNotice" aria-live="polite">La cuenta y los registros se guardan de forma segura en DubIoT.</p></form></section>`;
    bindPasswordToggle('#password', '#togglePassword');
    let mode = 'login'; $('#nameField').style.display = 'none';
    const setMode = next => { mode = next; $('#nameField').hidden = next !== 'signup'; $('#nameField').style.display = next === 'signup' ? 'grid' : 'none'; $('#fullName').required = next === 'signup'; $('#password').autocomplete = next === 'signup' ? 'new-password' : 'current-password'; $('#authSubmit').textContent = next === 'signup' ? 'Crear cuenta' : 'Ingresar'; $('#showLogin').classList.toggle('active', next === 'login'); $('#showSignup').classList.toggle('active', next === 'signup'); $('#showLogin').setAttribute('aria-selected',String(next==='login')); $('#showSignup').setAttribute('aria-selected',String(next==='signup')); $('#authHelp').hidden = next === 'signup'; $('#authNotice').textContent = next === 'signup' ? 'Usá al menos 8 caracteres. Después confirmá tu correo para ingresar.' : 'La cuenta y los registros se guardan de forma segura en DubIoT.'; };
    $('#showLogin').onclick = () => setMode('login'); $('#showSignup').onclick = () => setMode('signup');
    $('#resendConfirmation').onclick = async () => {
      const email = $('#email').value.trim();
      if (!email) { $('#authNotice').textContent = 'Ingresá tu correo para reenviar la confirmación.'; $('#email').focus(); return; }
      const button = $('#resendConfirmation'); button.disabled = true;
      try {
        const {error} = await sb.auth.resend({type:'signup',email,options:{emailRedirectTo:window.location.origin+window.location.pathname}});
        if (error) throw error;
        $('#authNotice').textContent = 'Si la cuenta necesita confirmación, te enviamos un correo nuevo. Usá el enlace más reciente.';
      } catch (err) { fail(err,'No se pudo reenviar la confirmación.'); }
      finally { button.disabled = false; }
    };
    $('#forgotPassword').onclick=async()=>{
      const email=$('#email').value.trim();if(!email){$('#authNotice').textContent='Ingresá tu correo para solicitar un enlace de recuperación.';$('#email').focus();return;}
      const button=$('#forgotPassword');button.disabled=true;
      try{const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});if(error)throw error;$('#authNotice').textContent='Si el correo corresponde a una cuenta, Supabase enviará un enlace para crear una contraseña nueva. Revisá también spam y correo no deseado.';}
      catch(err){fail(err,'No se pudo solicitar la recuperación.');}
      finally{button.disabled=false;}
    };
    $('#authForm').onsubmit = async e => { e.preventDefault(); const email = $('#email').value.trim(), password = $('#password').value; $('#authSubmit').disabled = true;
      try {
        if (mode === 'signup') {
          const {data,error} = await sb.auth.signUp({email,password,options:{data:{full_name:$('#fullName').value.trim()},emailRedirectTo:window.location.origin+window.location.pathname}}); if (error) throw error;
          if (!data.session) showAuth('Cuenta creada. Revisá tu correo para confirmar la dirección y después volvé para iniciar sesión.');
          else await acceptSession(data.session.user);
        } else { const {data,error} = await sb.auth.signInWithPassword({email,password}); if (error) throw error; await acceptSession(data.user); }
      } catch (err) { fail(err, 'No se pudo iniciar sesión.'); $('#authSubmit') && ($('#authSubmit').disabled = false); }
    };
  }
  async function acceptSession(authUser, autoJoinAttempted = false) {
    user = authUser;
    recordPresence();
    const [{data:p,error:pe},{data:allMemberships,error:me}] = await Promise.all([
      sb.from('profiles').select('id,full_name').eq('id',user.id).maybeSingle(),
      sb.from('hotel_memberships').select('id,hotel_id,role,status,requested_at').eq('user_id',user.id).order('requested_at',{ascending:false})
    ]);
    if (pe) throw pe; if (me) throw me;
    profile = p;
    const memberships=allMemberships||[];
    const activeMemberships=memberships.filter(m=>m.status==='active');
    if (!profile && !memberships.length && authUser.email_confirmed_at) {
      const {data: assurance} = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance?.currentLevel === 'aal1') return showAccountVerification();
    }
    const selectedHotel=localStorage.getItem(`dubiot-selected-hotel-${user.id}`);
    membership=activeMemberships.find(m=>m.hotel_id===selectedHotel)||activeMemberships[0]||memberships[0]||null;
    // Real hotel access requires an approved active membership.
    // Never automatically enroll authenticated users in the shared demo hotel.
    if (!membership || membership.status !== 'active') {
      return authUser.email && !authUser.email_confirmed_at
        ? showEmailConfirmation(authUser.email)
        : showMembershipGate();
    }
    const {data:h,error:he} = await sb.from('hotels').select('id,name,slug,timezone').eq('id',membership.hotel_id).maybeSingle();
    if (he) throw he; if (!h) { membershipConflict=true; return showMembershipGate(); }
    membershipConflict=false; hotel = h; await loadWorkspace();
  }
  function recordPresence(){
    if(!user||!sb)return;
    sb.rpc('record_my_presence').then(({error})=>{if(error&&!/record_my_presence|schema cache|does not exist/i.test(error.message||''))console.warn('No se pudo actualizar actividad',error);}).catch(()=>{});
    if(presenceTimer===null)presenceTimer=setInterval(()=>{if(document.visibilityState==='visible')recordPresence();},60000);
  }
  function showPasswordRecovery(){
    sessionBox.innerHTML='';
    root.classList.add('auth-layout');
    root.innerHTML=`<section class="panel auth"><h1>Recuperar contraseña</h1><p>Elegí una contraseña nueva para tu cuenta de DubIoT.</p><form id="passwordRecoveryForm" class="field"><label for="newPassword">Nueva contraseña</label><div class="password-control"><input id="newPassword" class="input" type="password" minlength="8" autocomplete="new-password" required><button class="btn" id="toggleNewPassword" type="button" aria-label="Mostrar contraseña" aria-pressed="false">Mostrar</button></div><button class="btn primary">Guardar contraseña</button></form></section>`;
    bindPasswordToggle('#newPassword', '#toggleNewPassword');
    $('#passwordRecoveryForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const {error}=await sb.auth.updateUser({password:$('#newPassword').value});if(error)throw error;await sb.auth.signOut();showAuth('Contraseña actualizada. Ya podés iniciar sesión con la nueva contraseña.');}catch(err){fail(err,'No se pudo actualizar la contraseña.');b.disabled=false;}};
  }
  function showAccountVerification() {
    root.classList.add('auth-layout');
    sessionBox.innerHTML = '<button class="btn quiet" id="logout">Cerrar sesión</button>';
    $('#logout').onclick = signOut;
    root.innerHTML = `<section class="panel auth">
      <div class="auth-heading">
        <h1>Verificá tu cuenta</h1>
        <p>La sesión está abierta, pero la app no pudo leer el perfil del hotel. Si usás la cuenta administradora, completá la verificación en dos pasos en el panel de administración.</p>
      </div>
      <div class="actions"><a class="btn primary" href="./admin.html">Abrir administración</a><button class="btn" id="retryAccount" type="button">Volver a comprobar</button></div>
    </section>`;
    $('#retryAccount').onclick = () => location.reload();
  }
  function showEmailConfirmation(email) {
    root.classList.add('auth-layout');
    sessionBox.innerHTML = '<button class="btn quiet" id="logout">Cerrar sesión</button>';
    $('#logout').onclick = signOut;
    root.innerHTML = `<section class="panel auth" aria-labelledby="confirmEmailTitle">
      <div class="auth-heading">
        <h1 id="confirmEmailTitle">Confirmá tu correo</h1>
        <p>Abrí el enlace de confirmación que enviamos a <strong>${esc(email)}</strong> para entrar a Hotel Demo.</p>
      </div>
      <button class="btn primary auth-submit" id="checkConfirmation" type="button">Ya confirmé mi correo</button>
      <div class="auth-help"><button class="auth-link" id="resendPendingEmail" type="button">Enviar un enlace nuevo</button></div>
      <p class="auth-notice" id="confirmationStatus" role="status"></p>
    </section>`;
    const status = $('#confirmationStatus');
    const check = $('#checkConfirmation');
    const resend = $('#resendPendingEmail');
    check.onclick = async () => {
      check.disabled = true;
      resend.disabled = true;
      status.textContent = 'Comprobando tu correo…';
      try {
        const {data, error} = await sb.auth.getUser();
        if (error) throw error;
        if (!data.user?.email_confirmed_at) {
          status.textContent = 'Todavía falta confirmar el correo. Usá el enlace del mensaje más reciente.';
          return;
        }
        await acceptSession(data.user);
      } catch (error) {
        console.error(error);
        status.textContent = 'No pudimos comprobar el acceso. Volvé a intentar o cerrá sesión y entrá nuevamente.';
      } finally {
        check.disabled = false;
        resend.disabled = false;
      }
    };
    resend.onclick = async () => {
      check.disabled = true;
      resend.disabled = true;
      status.textContent = 'Solicitando un enlace nuevo…';
      try {
        const {error} = await sb.auth.resend({
          type: 'signup',
          email,
          options: {emailRedirectTo: location.origin + location.pathname}
        });
        if (error) throw error;
        status.textContent = 'Revisá tu bandeja de entrada y spam. Abrí el mensaje más reciente.';
      } catch (error) {
        console.error(error);
        status.textContent = 'No pudimos enviar otro enlace. Esperá un momento y volvé a intentar.';
      } finally {
        check.disabled = false;
        resend.disabled = false;
      }
    };
  }
  function showMembershipGate() {
    root.classList.add('auth-layout');
    const waiting = membership?.status === 'pending';
    const blocked = ['rejected','suspended'].includes(membership?.status);
    const canRequest = !membership && !membershipConflict;
    const title = membershipConflict ? 'No pudimos abrir tu hotel' : waiting ? 'Acceso pendiente' : blocked ? 'Acceso sin habilitar' : 'Ingresar al hotel';
    const description = membershipConflict ? 'Encontramos un acceso, pero no pudimos cargar el hotel.' : waiting ? 'El responsable del hotel debe aprobar tu solicitud.' : blocked ? 'Contactá al responsable del hotel para revisar tu acceso.' : 'Indicá el código de tu hotel para solicitar acceso.';
    sessionBox.innerHTML = '<button class="btn quiet" id="logout">Cerrar sesión</button>';
    $('#logout').onclick = signOut;
    root.innerHTML = `<section class="panel auth" aria-labelledby="hotelAccessTitle">
      <div class="auth-heading" style="text-align:center">
        <h1 id="hotelAccessTitle">${title}</h1><p>${description}</p>
      </div>
      ${canRequest ? `<form id="requestForm">
        <div class="field"><label for="hotelSlug">Código del hotel</label><input id="hotelSlug" class="input" required value="hotel-demo" autocomplete="off"></div>
        <div class="field"><label for="role">Rol solicitado</label><select id="role" class="input"><option value="technician">Técnico</option><option value="staff">Personal operativo</option><option value="supervisor">Supervisor</option></select></div>
        <button class="btn primary auth-submit" type="submit">Solicitar acceso</button>
      </form>` : ''}
      <div class="auth-help"><button class="auth-link" id="retryMembership" type="button">Volver a comprobar el acceso</button></div>
      <p class="auth-notice muted" id="hotelAccessStatus" role="status"></p>
    </section>`;
    const refreshAccess = async () => {
      const {data, error} = await sb.auth.getUser();
      if (error) throw error;
      await acceptSession(data.user);
    };
    const report = message => {
      const status = $('#hotelAccessStatus');
      if (status) status.textContent = message;
    };
    $('#retryMembership').onclick = async ({currentTarget: button}) => {
      button.disabled = true;
      try {
        await refreshAccess();
        if (!membership) report('Todavía no podemos leer un acceso para esta cuenta.');
      } catch (error) {
        console.error(error);
        report('No pudimos comprobar el acceso. Volvé a intentar.');
      } finally {
        button.disabled = false;
      }
    };
    $('#requestForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        const {error} = await sb.rpc('request_hotel_membership_by_slug',{
          _hotel_slug: $('#hotelSlug').value.trim(),
          _requested_role: $('#role').value
        });
        if (error && !/active membership already exists/i.test(error.message)) throw error;
        await refreshAccess();
        if (!membership) report('El servidor recibió el pedido, pero la app todavía no pudo leer el acceso.');
      } catch (error) {
        console.error(error);
        if (/verified email/i.test(error.message)) return showEmailConfirmation(user.email);
        report(/active hotel not found/i.test(error.message) ? 'No encontramos un hotel activo con ese código.' : 'No pudimos completar el acceso. Volvé a comprobarlo.');
      } finally {
        button.disabled = false;
      }
    });
  }
  async function loadWorkspace() {
    const hid = hotel.id;
    const [eq, hist, tasks, issues, checks, msResult] = await Promise.all([
      sb.from('equipment').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('equipment_history').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('maintenance_tasks').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('issues').select('*').eq('hotel_id',hid).order('created_at',{ascending:false}),
      sb.from('daily_checks').select('*').eq('hotel_id',hid).order('checked_at',{ascending:false}),
      sb.from('hotel_memberships').select('id,user_id,role,status,requested_at').eq('hotel_id',hid).order('requested_at',{ascending:false})
    ]);
    for (const result of [eq,hist,tasks,issues,checks,msResult]) if (result.error) throw result.error;
    const names = new Map((eq.data||[]).map(x=>[x.id,x.name]));
    const timeline = new Map();
    for (const ev of hist.data||[]) { if (!timeline.has(ev.equipment_id)) timeline.set(ev.equipment_id,[]); const happenedAt=ev.occurred_at||ev.created_at; timeline.get(ev.equipment_id).push({id:ev.id,sortAt:happenedAt,at:new Date(happenedAt).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'}),kind:eventLabels[ev.event_type]||ev.event_type,text:ev.title+(ev.details?` · ${ev.details}`:''),actor:ev.actor_id===user.id?(profile?.full_name||user.email):'Equipo técnico',photo_paths:ev.photo_paths||[]}); }
    assets=(eq.data||[]).map(x=>({...x,code:`DB-${x.id.slice(0,8).toUpperCase()}`,qrCode:x.qr_code,name:x.name,model:x.model||'',serialNumber:x.serial_number||'',photo_path:x.photo_path,history:timeline.get(x.id)||[],updated:new Date(x.updated_at).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'})}));
    maintenanceTasks=tasks.data||[]; openIssues=issues.data||[]; dailyChecks=checks.data||[];
    window.betaTasks=maintenanceTasks.map(x=>({...x,equipment:names.get(x.equipment_id)||'—',assignee:x.assigned_to||'Sin asignar',due:x.due_date||'Sin fecha'}));
    window.betaIssues=openIssues.map(x=>({...x,equipment:names.get(x.equipment_id)||'—',area:x.description||'General',reported:new Date(x.created_at).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'})}));
    window.betaChecks=dailyChecks.map(x=>({...x,title:x.check_name,sector:x.notes||'General',person:x.checked_by===user.id?(profile?.full_name||user.email):'Personal del hotel',time:new Date(x.checked_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),verified:x.verification_status==='verified'}));
    const ms=msResult.data;
    const ids=(ms||[]).map(x=>x.user_id); let profs=[]; if(ids.length){const {data,error}=await sb.from('profiles').select('id,full_name').in('id',ids);if(error)throw error;profs=data||[];}
    const pmap=new Map(profs.map(x=>[x.id,x.full_name])); members=(ms||[]).map(x=>({...x,full_name:pmap.get(x.user_id)||'Usuario'}));
    sessionBox.innerHTML=`<span class="muted">${esc(profile?.full_name||user.email)} · ${esc(roleText(membership.role))}</span><button class="btn quiet" id="logout">Salir</button>`; $('#logout').onclick=signOut;
    if(location.hash.startsWith('#asset=')){const qr=decodeURIComponent(location.hash.slice(7));const found=assets.find(x=>x.qr_code===qr||x.id===qr);if(found)return showAsset(found);}
    renderHome(); window.dispatchEvent(new Event('dubiot:render'));
  }
  function bindDailyCheckToggle() {
    const button = $('#toggleDailyCheck');
    const form = $('#dailyCheckForm');
    button.onclick = () => {
      const open = form.hidden;
      form.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? 'Cerrar control' : 'Abrir control';
    };
  }
  function renderFieldApp(){root.innerHTML=`${shell('App de campo','Alta de activos, controles e historial QR para el equipo de mantenimiento.','<a class="btn" href="./panel.html">Panel de PC ↗</a><button class="btn primary" id="newAsset">＋ Dar de alta un activo</button>')}<div class="field-banner"><b>¿Ya tiene QR?</b><span>Usá la cámara del teléfono para escanearlo y abrir su historial.</span></div><div class="field-layout"><section class="panel field-control" aria-labelledby="field-control-title"><div class="row field-control-title"><div><h2 id="field-control-title">Cargar control diario</h2><p>El responsable lo revisa desde el panel de PC.</p></div><button class="btn" id="toggleDailyCheck" type="button" aria-expanded="false" aria-controls="dailyCheckForm">Abrir control</button></div><form id="dailyCheckForm" class="field" hidden><label for="checkEquipment">Activo</label><select class="input" id="checkEquipment" name="equipment_id" required><option value="">Elegir activo</option>${assets.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.location)}</option>`).join('')}</select><label for="checkName">Tipo de control</label><input id="checkName" class="input" name="check_name" required maxlength="120" placeholder="Ej.: Control diario de caldera"><label for="checkResult">Resultado</label><select id="checkResult" class="input" name="result"><option value="ok">Correcto</option><option value="observation">Con observación</option><option value="failure">Falla encontrada</option><option value="not_done">No realizado</option></select><label for="checkNotes">Detalle / mediciones</label><textarea id="checkNotes" class="input" name="notes" maxlength="2000" placeholder="Lectura, estado encontrado, trabajo requerido…"></textarea><button class="btn primary">Enviar control a verificación</button></form></section><section><div class="row field-assets-head"><div><h2>Activos del hotel</h2><p>${assets.length} equipos · abrí una ficha o escaneá su QR.</p></div><input id="search" class="input" placeholder="Buscar equipo o ubicación"></div><div class="grid field-assets-grid" id="assetGrid"></div></section></div>`;$('#newAsset').onclick=showNewAsset;$('#search').oninput=filterAssets;$('#dailyCheckForm').onsubmit=saveDailyCheck;bindDailyCheckToggle();drawAssets();window.dispatchEvent(new Event('dubiot:render'));}
  async function saveDailyCheck(e){e.preventDefault();const f=e.currentTarget,b=e.submitter;const v=Object.fromEntries(new FormData(f));b.disabled=true;try{const {error}=await sb.from('daily_checks').insert({hotel_id:hotel.id,equipment_id:v.equipment_id,check_name:v.check_name.trim(),result:v.result,notes:v.notes.trim(),checked_by:user.id});if(error)throw error;toast('Control enviado al panel de PC para verificación');f.reset();await loadWorkspace();}catch(err){fail(err,'No se pudo guardar el control diario.');b.disabled=false;}}
  async function reviewDailyCheck(id,decision,button){button.disabled=true;try{const {error}=await sb.from('daily_checks').update({verification_status:decision}).eq('id',id).eq('hotel_id',hotel.id).eq('verification_status','pending');if(error)throw error;toast(decision==='verified'?'Control aprobado':'Control devuelto para corregir');await loadWorkspace();activeView='maintenance';}catch(error){fail(error,'No se pudo actualizar la verificación.');button.disabled=false;}}
  async function changeAssetStatus(id,nextStatus,button,returnToDetail=false){const asset=assets.find(a=>a.id===id);if(!asset||asset.status===nextStatus)return;if(!canManage())return;let reason='';if(['critical','out_of_service'].includes(nextStatus)){reason=window.prompt(`Motivo obligatorio para cambiar ${asset.name} a «${statusText(nextStatus)}»:`)?.trim()||'';if(!reason){toast('Indicá el motivo para aplicar este estado.');renderHome();return;}}button&&(button.disabled=true);try{const {error}=await sb.from('equipment').update({status:nextStatus,status_reason:reason}).eq('id',id).eq('hotel_id',hotel.id);if(error)throw error;toast(`Estado actualizado: ${statusText(nextStatus)}`);await loadWorkspace();if(returnToDetail&&!location.hash.startsWith('#asset='))await showAsset(assets.find(a=>a.id===id));}catch(err){fail(err,'No se pudo cambiar el estado. Aplicá la migración 006 y volvé a intentar.');if(button)button.disabled=false;}}
  function renderHome() {
    root.classList.remove('auth-layout');
    if(appMode==='field'){renderFieldApp();return;}
    if(activeView==='maintenance'&&!canManage())activeView='dashboard';
    const pendingChecks=dailyChecks.filter(c=>c.verification_status==='pending').length;
    const activeTasks=maintenanceTasks.filter(t=>!['completed','cancelled'].includes(t.status));
    const activeIssues=openIssues.filter(i=>['open','in_review'].includes(i.status));
    const openRepairs=activeTasks.length+activeIssues.length;
    const operational=assets.filter(a=>a.status==='operational').length;
    const nav=`<nav class="desktop-nav"><a class="brand" href="#"><img src="dubiot-logo-hotel.png" alt=""><span><b>DubIoT</b><small>HOTEL OPERATIONS · BETA</small></span></a><div class="desktop-tabs"><button class="navtab ${activeView==='dashboard'?'active':''}" data-tab="dashboard">Resumen</button><button class="navtab ${activeView==='assets'?'active':''}" data-tab="assets">Activos</button>${canManage()?`<button class="navtab ${activeView==='maintenance'?'active':''}" data-tab="maintenance">Verificar controles</button>`:''}</div><a class="btn" href="./beta.html">Abrir app de campo ↗</a></nav>`;
    let content='';
    if(activeView==='dashboard') content=`${shell('Panel general','Estado operativo de '+esc(hotel?.name||'el hotel')+' · '+new Date().toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'}),'<button class="btn" id="exportCsv">Descargar activos CSV</button><button class="btn primary" id="newAsset">＋ Registrar activo</button>')}<div class="metric-grid"><button class="metric-card" data-goto="maintenance"><span>Controles por revisar</span><strong>${pendingChecks}</strong><small>Controles diarios pendientes de verificación</small></button><button class="metric-card" data-goto="maintenance"><span>Órdenes e incidencias abiertas</span><strong>${openRepairs}</strong><small>${activeTasks.length} órdenes · ${activeIssues.length} incidencias</small></button><button class="metric-card" data-goto="maintenance"><span>Tareas en curso</span><strong>${maintenanceTasks.filter(t=>t.status==='in_progress').length}</strong><small>De ${activeTasks.length} órdenes abiertas</small></button><button class="metric-card" data-goto="assets"><span>Activos operativos</span><strong>${operational}<i> / ${assets.length}</i></strong><small>Inventario registrado del hotel</small></button></div><div class="dashboard-columns"><section class="panel"><div class="row"><div><h2>Actividad reciente</h2><p>Últimos movimientos de control y mantenimiento</p></div><button class="btn quiet" data-goto="maintenance">Ver seguimiento →</button></div><div class="recent-list">${recentActivity().slice(0,7).map(a=>`<article class="recent-row"><span class="activity-dot ${a.color}"></span><div><b>${esc(a.title)}</b><p>${esc(a.asset)} · ${esc(a.subtitle)}</p></div><time>${esc(a.date)}</time></article>`).join('')||'<p class="muted">Todavía no hay actividad registrada.</p>'}</div></section><section class="panel"><h2>Estado del inventario</h2><p>Situación actual de los equipos</p><div class="status-bars">${Object.entries(statusLabels).map(([key,label])=>`<div class="status-line"><span>${esc(label)}</span><div><i class="${key}" style="width:${assets.length?Math.max(assets.filter(a=>a.status===key).length/assets.length*100,assets.some(a=>a.status===key)?5:0):0}%"></i></div><b>${assets.filter(a=>a.status===key).length}</b></div>`).join('')}</div><button class="btn" style="margin-top:18px" data-goto="assets">Abrir inventario →</button></section></div>${canManageTeam()?'<section class="panel member-panel"><h2>Solicitudes del personal</h2><div id="memberList"></div></section>':''}`;
    else if(activeView==='assets') content=`${shell('Inventario de activos','Administrá fichas, ubicaciones, estado y códigos QR.','<button class="btn" id="exportCsv">Descargar activos CSV</button><button class="btn primary" id="newAsset">＋ Registrar activo</button>')}<div class="toolbar"><input id="search" class="input" placeholder="Buscar por nombre, serie o ubicación"><select id="statusFilter" class="input" style="max-width:210px"><option value="">Todos los estados</option>${Object.entries(statusLabels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><span class="muted" id="assetCount">${assets.length} activos · CSV compatible con Excel</span></div><div class="asset-table-wrap"><table class="asset-table"><thead><tr><th>Activo</th><th>Ubicación</th><th>Estado</th><th>Último movimiento</th><th></th></tr></thead><tbody id="assetRows"></tbody></table></div>`;
    else content=`${shell('Verificar controles','La hora del control y la de su aprobación quedan registradas por separado.','<button class="btn" id="exportCsv">Descargar controles CSV</button>')}<section class="panel verification-panel"><div class="row"><div><h2>Controles pendientes de verificación</h2><p>Validá el resultado y las observaciones del técnico.</p></div><b class="badge review">${dailyChecks.filter(c=>c.verification_status==='pending').length} pendientes</b></div><div class="verification-list">${dailyChecks.filter(c=>c.verification_status==='pending').map(c=>{const a=assets.find(x=>x.id===c.equipment_id);return `<article class="verification-row"><span class="badge ${c.result==='failure'?'critical':c.result==='observation'?'review':'operational'}">${esc(c.result==='failure'?'Falla':c.result==='observation'?'Observación':c.result==='not_done'?'No realizado':'Correcto')}</span><div class="verification-copy"><b>${esc(c.check_name)} · ${esc(a?.name||'Control general')}</b><p>${esc(c.notes||'Sin observaciones')}</p><small class="muted">Control realizado: ${esc(dateTime(c.checked_at))} · Cargado por ${esc(members.find(m=>m.user_id===c.checked_by)?.full_name||'Personal del hotel')}</small></div>${canManage()?`<div class="actions"><button class="btn primary" data-verify="${esc(c.id)}">Aprobar</button><button class="btn danger" data-reject-check="${esc(c.id)}">Devolver</button></div>`:''}</article>`}).join('')||'<p class="muted">No hay controles pendientes. Cuando los técnicos carguen controles desde el teléfono, aparecerán acá para revisión.</p>'}</div></section><div class="life-grid"><section class="panel"><h2>Historial de controles</h2><p>Resultados aprobados y devueltos para corregir</p>${dailyChecks.filter(c=>c.verification_status!=='pending').slice(0,40).map(c=>{const a=assets.find(x=>x.id===c.equipment_id),reviewer=members.find(m=>m.user_id===c.verified_by)?.full_name||'Responsable del hotel';return `<article class="life-row"><span class="badge ${c.verification_status==='verified'?'operational':'critical'}">${c.verification_status==='verified'?'Aprobado':'Corregir'}</span><div><b>${esc(c.check_name)} · ${esc(a?.name||'Control general')}</b><p>${esc(c.notes||'Sin observaciones')}</p><small class="muted">Control realizado: ${esc(dateTime(c.checked_at))}</small><small class="muted">${c.verification_status==='verified'?'Aprobado':'Devuelto'}: ${esc(c.verified_at?dateTime(c.verified_at):'fecha no disponible')} · ${esc(reviewer)}</small></div></article>`}).join('')||'<p class="muted">Todavía no hay controles verificados.</p>'}</section><section class="panel"><h2>Órdenes e incidencias abiertas</h2><p>Órdenes e incidencias abiertas para seguimiento.</p>${[...activeTasks.map(t=>({title:t.title,details:t.description,at:t.due_date||t.created_at,type:t.status==='in_progress'?'En reparación':'Pendiente',asset:assets.find(a=>a.id===t.equipment_id)?.name||'Tarea general'})),...activeIssues.map(i=>({title:i.title,details:i.description,at:i.created_at,type:'Incidencia',asset:assets.find(a=>a.id===i.equipment_id)?.name||'Activo'}))].sort((a,b)=>new Date(a.at)-new Date(b.at)).map(t=>`<article class="life-row"><span class="badge ${t.type==='En reparación'?'critical':'review'}">${esc(t.type)}</span><div><b>${esc(t.title)}</b><p>${esc(t.asset)} · ${esc(t.details||'Sin detalle')}</p></div><time>${esc(new Date(t.at).toLocaleDateString('es-AR'))}</time></article>`).join('')||'<p class="muted">No hay órdenes ni incidencias abiertas.</p>'}</section></div>`;
    root.innerHTML=nav+`<main class="pc-main">${content}</main>`;
    root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{activeView=b.dataset.tab;renderHome();});root.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>{activeView=b.dataset.goto;renderHome();});$('#newAsset')?.addEventListener('click',showNewAsset);$('#exportCsv')?.addEventListener('click',()=>activeView==='maintenance'?exportChecksCsv():exportAssetsCsv());root.querySelectorAll('[data-verify]').forEach(b=>b.onclick=()=>reviewDailyCheck(b.dataset.verify,'verified',b));root.querySelectorAll('[data-reject-check]').forEach(b=>b.onclick=()=>reviewDailyCheck(b.dataset.rejectCheck,'rejected',b));
    if(activeView==='assets'){ $('#search').oninput=filterAssets;$('#statusFilter').onchange=filterAssets;drawAssetRows(); }
    if(canManageTeam())drawMembers(); window.dispatchEvent(new Event('dubiot:render'));
  }
  function recentActivity(){const rows=[];for(const a of assets)for(const h of a.history){let subtitle=h.text;const change=subtitle.match(/([a-z_]+)\s*→\s*([a-z_]+)/);if(change)subtitle=subtitle.replace(change[0],`${statusText(change[1])} → ${statusText(change[2])}`);rows.push({title:h.kind,asset:a.name,subtitle,date:h.at,color:/repar|incidencia|falla/i.test(h.kind+' '+h.text)?'red':/inspecci|control/i.test(h.kind)?'orange':'teal',sort:new Date(h.sortAt).getTime()});}for(const c of dailyChecks){const a=assets.find(x=>x.id===c.equipment_id);rows.push({title:c.check_name,asset:a?.name||'Control diario',subtitle:c.notes||{ok:'Correcto',observation:'Con observación',failure:'Falla encontrada',not_done:'No realizado'}[c.result]||c.result,date:dateTime(c.checked_at),color:c.result==='failure'?'red':c.result==='observation'?'orange':'teal',sort:new Date(c.checked_at).getTime()});}return rows.sort((a,b)=>b.sort-a.sort);}
  function csvCell(value){return '"'+String(value??'').replace(/"/g,'""')+'"';}
  function exportAssetsCsv(){const rows=[['Activo','Código','Categoría','Ubicación','Marca / modelo','Número de serie','Estado','Último control','Inicio de reparación','Reparación terminada','Vuelta al servicio','Último movimiento','Observaciones']];for(const a of assets){const typed=(pattern)=>{const h=a.history.find(item=>pattern.test(item.text+' '+item.kind));return h?.sortAt?new Date(h.sortAt).toLocaleDateString('sv-SE'):'';};rows.push([a.name,a.code,a.category,a.location,a.model,a.serial_number,statusLabels[a.status]||a.status,typed(/control|inspecci/i),typed(/inicio.*repar|repar.*inici/i),typed(/reparaci[oó]n terminada|reparaci[oó]n finalizada|reparaci[oó]n completa/i),typed(/devoluci[oó]n al servicio|vuelta al servicio|regreso.*servicio/i),a.history[0]?.sortAt?new Date(a.history[0].sortAt).toLocaleDateString('sv-SE'):'',a.notes]);}const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download=`DubIoT - Activos - ${new Date().toISOString().slice(0,10)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1200);toast('Planilla de activos descargada');}
  function exportChecksCsv(){const rows=[['Activo','Ubicación','Control','Resultado','Detalle','Control realizado','Cargado por','Estado de revisión','Revisado el','Revisado por']];for(const c of dailyChecks){const a=assets.find(x=>x.id===c.equipment_id),actor=members.find(m=>m.user_id===c.checked_by),reviewer=members.find(m=>m.user_id===c.verified_by);rows.push([a?.name||'Control general',a?.location||'',c.check_name,{ok:'Correcto',observation:'Con observación',failure:'Falla encontrada',not_done:'No realizado'}[c.result]||c.result,c.notes,dateTime(c.checked_at),actor?.full_name||'Personal del hotel',{pending:'Pendiente',verified:'Aprobado',rejected:'Devuelto'}[c.verification_status]||c.verification_status,c.verified_at?dateTime(c.verified_at):'',reviewer?.full_name||'']);}const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download=`DubIoT - Controles - ${new Date().toISOString().slice(0,10)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1200);toast('Planilla de controles descargada');}
  function drawAssetRows(){const body=$('#assetRows');if(!body)return;const q=$('#search')?.value.trim().toLowerCase()||'',s=$('#statusFilter')?.value||'',visible=assets.filter(x=>JSON.stringify([x.name,x.model,x.serial_number,x.location,x.code,x.category]).toLowerCase().includes(q)&&(!s||x.status===s));const count=$('#assetCount');if(count)count.textContent=`${visible.length} de ${assets.length} activos · CSV compatible con Excel`;if(!assets.length){body.innerHTML=`<tr><td colspan="5" class="empty">Todavía no hay activos. <button class="btn primary" id="emptyNew">Registrar primer activo</button></td></tr>`;$('#emptyNew').onclick=showNewAsset;return;}if(!visible.length){body.innerHTML='<tr><td colspan="5" class="empty">No hay activos que coincidan con la búsqueda.</td></tr>';return;}body.innerHTML=visible.map(x=>`<tr data-asset="${esc(x.id)}"><td><b>${esc(x.name)}</b><small>${esc(x.code)} · ${esc(x.category)}${x.model?' · '+esc(x.model):''}</small></td><td>${esc(x.location)}</td><td>${canManage()?`<div class="status-inline"><select class="input" aria-label="Estado de ${esc(x.name)}" data-status-select="${esc(x.id)}">${Object.entries(statusLabels).map(([k,v])=>`<option value="${k}" ${x.status===k?'selected':''}>${v}</option>`).join('')}</select><button class="btn" data-status-save="${esc(x.id)}">Guardar</button></div>`:`<span class="badge ${esc(x.status)}">${esc(statusText(x.status))}</span>`}</td><td>${esc(x.history[0]?.at||'Sin movimientos')}</td><td><button class="btn" data-view="${esc(x.id)}">Abrir ficha / editar</button></td></tr>`).join('');body.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{lastPanelView=activeView;showAsset(assets.find(x=>x.id===b.dataset.view));});body.querySelectorAll('[data-status-save]').forEach(b=>b.onclick=()=>changeAssetStatus(b.dataset.statusSave,$(`[data-status-select="${b.dataset.statusSave}"]`).value,b));}
  function drawAssets() {
    const grid=$('#assetGrid'); if(!grid)return;
    if(!assets.length){grid.innerHTML='<section class="panel empty"><h2>Todavía no hay activos</h2><p>Registrá el primer equipo para generar su código QR y comenzar el historial.</p><button class="btn primary" id="emptyNew">Registrar primer activo</button></section>';$('#emptyNew').onclick=showNewAsset;return;}
    grid.innerHTML=assets.map(x=>`<article class="panel asset" data-asset="${esc(x.id)}"><div class="thumb placeholder">▤</div><div><div class="row"><h3>${esc(x.name)}</h3><span class="badge ${esc(x.status)}">${esc(statusLabels[x.status]||x.status)}</span></div><p>${esc(x.category)} · ${esc(x.location)}</p><p class="muted">${esc(x.code)} · ${esc(x.model)} ${x.serial_number?`· Serie ${esc(x.serial_number)}`:''}</p><div class="actions"><button class="btn primary" data-view="${esc(x.id)}">Ficha e historial</button></div></div></article>`).join('');
    grid.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showAsset(assets.find(x=>x.id===b.dataset.view)));
    hydratePhotos(grid);
  }
  async function hydratePhotos(scope) { for(const x of assets.filter(a=>a.photo_path)){const el=scope.querySelector(`[data-asset="${CSS.escape(x.id)}"] .thumb`);if(!el)continue;const {data,error}=await sb.storage.from('equipment-photos').createSignedUrl(x.photo_path,1800);if(!error&&data?.signedUrl){el.classList.remove('placeholder');el.innerHTML=`<img class="thumb" src="${esc(data.signedUrl)}" alt="${esc(x.name)}">`;}} }
  function filterAssets(){if(appMode==='panel'){drawAssetRows();return;}const q=$('#search').value.trim().toLowerCase();const visible=assets.filter(x=>JSON.stringify([x.name,x.model,x.serial_number,x.location,x.code,x.category]).toLowerCase().includes(q));document.querySelectorAll('#assetGrid [data-asset]').forEach(el=>{el.hidden=!visible.some(x=>x.id===el.dataset.asset);});const head=$('.field-assets-head p');if(head)head.textContent=`${visible.length} de ${assets.length} equipos · abrí una ficha o escaneá su QR.`;const grid=$('#assetGrid');if(grid&&!visible.length)grid.innerHTML='<p class="muted">No hay activos que coincidan con la búsqueda.</p>';else if(grid&&visible.length&& !grid.querySelector('[data-asset]'))drawAssets();}
  function drawMembers(){const box=$('#memberList');if(!box)return;const pending=members.filter(m=>m.status==='pending');box.innerHTML=pending.length?pending.map(m=>`<div class="row" style="padding:12px 0;border-bottom:1px solid var(--line)"><div><b>${esc(m.full_name)}</b><p class="muted">${esc(roleText(m.role))} · solicitó ${new Date(m.requested_at).toLocaleDateString('es-AR')}</p></div><div class="actions"><select class="input" data-role="${esc(m.id)}"><option value="technician" ${m.role==='technician'?'selected':''}>Técnico</option><option value="supervisor" ${m.role==='supervisor'?'selected':''}>Supervisor</option><option value="staff" ${m.role==='staff'?'selected':''}>Personal operativo</option></select><button class="btn primary" data-approve="${esc(m.id)}">Aprobar</button><button class="btn danger" data-reject="${esc(m.id)}">Rechazar</button></div></div>`).join(''):'<p class="muted">No hay solicitudes pendientes.</p>';
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
    const technician=membership?.role==='technician',editable=canManage()||technician,detailNav=appMode==='panel'?`<nav class="desktop-nav"><a class="brand" href="#"><img src="dubiot-logo-hotel.png" alt=""><span><b>DubIoT</b><small>HOTEL OPERATIONS · BETA</small></span></a><div class="desktop-tabs"><button class="navtab ${lastPanelView==='dashboard'?'active':''}" data-detail-tab="dashboard">Resumen</button><button class="navtab ${lastPanelView==='assets'?'active':''}" data-detail-tab="assets">Activos</button><button class="navtab ${lastPanelView==='maintenance'?'active':''}" data-detail-tab="maintenance">Verificar controles</button></div><a class="btn" href="./beta.html">Abrir app de campo ↗</a></nav>`:'';root.innerHTML=`${detailNav}${shell('Ficha del activo',`${esc(x.category)} · ${esc(x.location)}`,`<button class="btn" id="backAssets">← ${appMode==='panel'?'Volver a activos':'Volver a la app de campo'}</button>`)}<div class="grid" style="grid-template-columns:minmax(300px,.75fr) minmax(360px,1.25fr)"><section class="panel"><div class="row"><div><h2>${esc(x.name)}</h2><p>${esc(x.code)} · ${esc(x.model)} ${x.serial_number?`· Serie ${esc(x.serial_number)}`:''}</p></div><span class="badge ${esc(x.status)}">${esc(statusText(x.status))}</span></div>${x.notes?`<p><b>Observaciones:</b> ${esc(x.notes)}</p>`:''}${photo?.signedUrl?`<img src="${esc(photo.signedUrl)}" alt="${esc(x.name)}" style="width:100%;max-height:300px;object-fit:cover;border-radius:10px">`:''}<div class="qrbox"><div id="qrCode" role="img" aria-label="Código QR del activo"></div><b>QR del activo</b><small id="qrStatus" role="status">Generando código QR…</small><button class="btn primary" id="downloadQr" disabled>Descargar ficha QR en PDF</button></div>${editable?`<details class="edit-details" open><summary>Editar datos del activo</summary><form id="editAssetForm" class="field"><label>Nombre</label><input class="input" name="name" value="${esc(x.name)}" ${technician?'disabled':''} required><label>Categoría</label><input class="input" name="category" value="${esc(x.category)}" ${technician?'disabled':''} required><label>Ubicación</label><input class="input" name="location" value="${esc(x.location)}" ${technician?'disabled':''} required><label>Marca / modelo</label><input class="input" name="model" value="${esc(x.model)}"><label>Número de serie</label><input class="input" name="serial_number" value="${esc(x.serial_number||'')}"><label>Foto nueva</label><input class="input" name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment">${!technician?`<label>Observaciones</label><textarea class="input" name="notes">${esc(x.notes||'')}</textarea>`:''}<button class="btn primary">Guardar cambios</button></form></details>`:''}${canManage()?`<form id="statusForm" class="field"><label>Estado actual</label><select class="input" name="status">${Object.entries(statusLabels).map(([k,v])=>`<option value="${k}" ${x.status===k?'selected':''}>${v}</option>`).join('')}</select><button class="btn">Actualizar estado</button></form>`:''}</section><section class="panel"><div class="row"><div><h2>Historial compartido</h2><p>${x.history.length} eventos · seguimiento cronológico</p></div></div><div class="lifecycle-strip"><span>1 · Control</span><span>2 · Reparación</span><span>3 · Retorno al servicio</span></div><form id="eventForm" class="field"><label>Registrar un hito del activo</label><select name="phase" class="input"><option value="inspection|Control realizado|inspection">Control / inspección realizada</option><option value="repair|Reparación iniciada|repair">Inicio de reparación</option><option value="repair|Reparación terminada|repair">Reparación terminada</option><option value="maintenance|Devolución al servicio|maintenance">Devolución al servicio</option><option value="maintenance|Mantenimiento preventivo|maintenance">Mantenimiento preventivo</option><option value="part_replaced|Repuesto instalado|part_replaced">Repuesto instalado</option><option value="issue|Incidencia detectada|issue">Incidencia detectada</option><option value="note|Observación|note">Observación</option></select><input name="title" class="input" required maxlength="160" placeholder="Detalle breve del hito"><textarea name="details" class="input" maxlength="5000" placeholder="Trabajo realizado, mediciones, piezas, resultado y próximo control"></textarea><button class="btn primary">Guardar hito con fecha de hoy</button></form><div class="timeline">${x.history.length?x.history.map(ev=>`<article class="event"><b>${esc(ev.kind)} · ${esc(ev.at)}</b><p>${esc(ev.text)}</p><small class="muted">${esc(ev.actor)}</small></article>`).join(''):'<p class="muted">Todavía no hay eventos.</p>'}</div></section></div>`;
    $('#backAssets').onclick=()=>{if(appMode==='panel'){activeView=lastPanelView;renderHome();}else{location.hash='';renderHome();}};root.querySelectorAll('[data-detail-tab]').forEach(b=>b.onclick=()=>{activeView=b.dataset.detailTab;lastPanelView=activeView;renderHome();});
    const qrStatus=$('#qrStatus'),qrButton=$('#downloadQr'),qrTarget=$('#qrCode');
    try {
      if(typeof window.QRCode!=='function') throw new Error('No se cargó la biblioteca QR local');
      qrTarget.style.minHeight='220px';
      const qrText=location.origin+location.pathname+'#asset='+encodeURIComponent(x.qr_code);
      const qrWork=document.createElement('div');
      const qrGenerator=new QRCode(qrWork,{text:qrText,width:960,height:960,colorDark:'#052039',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
      const qrSource=qrWork.querySelector('canvas');
      if(!qrSource||!qrSource.width) throw new Error('El navegador no pudo dibujar el QR');
      const qrCanvas=document.createElement('canvas');qrCanvas.width=1152;qrCanvas.height=1152;
      const qrContext=qrCanvas.getContext('2d');qrContext.fillStyle='#ffffff';qrContext.fillRect(0,0,qrCanvas.width,qrCanvas.height);qrContext.drawImage(qrSource,96,96,960,960);
      qrTarget.appendChild(qrCanvas);
      qrStatus.textContent='QR de alta resolución, listo para descargar e imprimir.';qrButton.disabled=false;qrButton.textContent='Descargar ficha QR en PDF';
      qrButton.onclick=()=>{
        try {
          const model=qrGenerator._oQRCode,count=model.getModuleCount(),pageW=595,pageH=842,qrSize=410,unit=qrSize/(count+8),quiet=unit*4,qrX=(pageW-qrSize)/2;
          const clean=s=>String(s??'').normalize('NFC').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
          const winAnsi=s=>Array.from(clean(s)).map(ch=>{const code=ch.codePointAt(0);return code<=255?code:63;}).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
          const wrap=(s,max)=>{const words=clean(s).split(' '),lines=[];let line='';for(const word of words){if(!word)continue;if(line&&line.length+word.length+1>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;};
          const titleLines=wrap(x.name,42),content=[];let y=797;
          const put=(value,size,bold=true)=>{for(const line of wrap(value,82)){const width=line.length*size*.51,x0=(pageW-width)/2;content.push(`BT /${bold?'F2':'F1'} ${size} Tf ${x0.toFixed(2)} ${y.toFixed(2)} Td <${winAnsi(line)}> Tj ET`);y-=size+7;}};
          titleLines.forEach(line=>{const x0=(pageW-line.length*20*.52)/2;content.push(`BT /F2 20 Tf ${x0.toFixed(2)} ${y.toFixed(2)} Td <${winAnsi(line)}> Tj ET`);y-=27;});
          put(`Código ${x.code}`,11,true);put([x.model,x.serial_number?`Serie ${x.serial_number}`:null].filter(Boolean).join(' · '),10,false);y-=8;
          content.push('0.02 0.13 0.22 rg');
          for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(model.isDark(row,col)){const px=qrX+quiet+col*unit,py=y-qrSize+quiet+(count-1-row)*unit;content.push(`${px.toFixed(3)} ${py.toFixed(3)} ${unit.toFixed(3)} ${unit.toFixed(3)} re`);}
          content.push('f');const labelY=y-qrSize-34;content.push(`BT /F2 13 Tf ${(pageW-78)/2} ${labelY.toFixed(2)} Td <${winAnsi('QR del activo')}> Tj ET`);content.push(`BT /F1 10 Tf ${(pageW-175)/2} ${(labelY-19).toFixed(2)} Td <${winAnsi('Escaneá para consultar el historial')}> Tj ET`);
          const stream=content.join('\n')+'\n',objects=[
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
            `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`
          ];
          let pdf='%PDF-1.4\n%DubIoT QR\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(new TextEncoder().encode(pdf).length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
          const xref=new TextEncoder().encode(pdf).length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offsets.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
          const url=URL.createObjectURL(new Blob([pdf],{type:'application/pdf'})),a=document.createElement('a');a.download=`${clean(x.name)||x.code} - QR.pdf`;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
        } catch(error) { fail(error,'No se pudo generar el PDF del QR.'); }
      };
    } catch(error) { qrStatus.textContent='No se pudo generar el QR: '+(error.message||'error desconocido');console.error('No se pudo generar el QR del activo',error); }

    $('#editAssetForm')?.addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;const f=e.currentTarget,v=Object.fromEntries(new FormData(f));let path=null;const file=f.elements.photo.files[0];try{if(file){path=`${hotel.id}/${x.id}/${crypto.randomUUID()}.${file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg'}`;const {error}=await sb.storage.from('equipment-photos').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;}const changes={model:v.model.trim(),serial_number:v.serial_number.trim()||null};if(!technician)Object.assign(changes,{name:v.name.trim(),category:v.category.trim(),location:v.location.trim(),notes:v.notes.trim()});if(path)changes.photo_path=path;const {error}=await sb.from('equipment').update(changes).eq('id',x.id).eq('hotel_id',hotel.id);if(error)throw error;toast('Datos del activo actualizados');await loadWorkspace();showAsset(assets.find(a=>a.id===x.id));}catch(err){if(path)await sb.storage.from('equipment-photos').remove([path]).catch(()=>{});fail(err,'No se pudieron guardar los cambios.');b.disabled=false;}});
    $('#eventForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;const v=Object.fromEntries(new FormData(e.currentTarget)),[event_type,preset]=v.phase.split('|');try{const {error}=await sb.from('equipment_history').insert({hotel_id:hotel.id,equipment_id:x.id,event_type,title:`${preset}: ${v.title.trim()}`.slice(0,160),details:v.details.trim(),actor_id:user.id});if(error)throw error;if(preset==='Devolución al servicio'&&canManage()){const {error:se}=await sb.from('equipment').update({status:'operational'}).eq('id',x.id).eq('hotel_id',hotel.id);if(se)throw se;}toast('Hito guardado en el historial compartido');await loadWorkspace();showAsset(assets.find(a=>a.id===x.id));}catch(err){fail(err);b.disabled=false;}};
    $('#statusForm')?.addEventListener('submit',async e=>{e.preventDefault();await changeAssetStatus(x.id,e.currentTarget.elements.status.value,e.submitter,true);});
    window.dispatchEvent(new Event('dubiot:render'));
  }
  async function signOut(){await sb.auth.signOut();user=null;membership=null;hotel=null;membershipConflict=false;assets=[];showAuth();}
  async function start(){
    showLoading();
    if(!sb){root.innerHTML='<section class="panel auth"><h1>Configuración pendiente</h1><p>No se encontró la URL o la clave publicable de Supabase. Revisá <code>supabase-config.js</code>.</p></section>';return;}
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./beta-sw.js').then(reg=>reg.update()).catch(()=>{});
    const callback = new URLSearchParams(location.hash.slice(1));
    let recovering = callback.get('type') === 'recovery';
    const handleAccessError = error => {
      console.error(error);
      showAuth('La sesión se abrió, pero no pudimos cargar los datos del hotel. Volvé a intentar.');
    };
    sb.auth.onAuthStateChange((event,session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        showPasswordRecovery();
        return;
      }
      if (event === 'SIGNED_OUT') {
        recovering = false;
        user = membership = hotel = null;
        membershipConflict = false;
        showAuth();
        return;
      }
      if (recovering || event === 'INITIAL_SESSION' || !session?.user) return;
      setTimeout(() => {
        if (!recovering) acceptSession(session.user).catch(handleAccessError);
      }, 0);
    });
    const {data,error}=await sb.auth.getSession();
    if(error) throw error;
    if (callback.has('error')) {
      history.replaceState(history.state, '', location.pathname + location.search);
      showAuth('El enlace del correo venció o ya se usó. Pedí uno nuevo desde esta pantalla.');
    } else if (recovering && data.session?.user) {
      showPasswordRecovery();
    } else if (data.session?.user) {
      await acceptSession(data.session.user).catch(handleAccessError);
    } else {
      showAuth();
    }
  }
  start().catch(e=>{fail(e,'No se pudo conectar con Supabase.');root.innerHTML=`<section class="panel auth"><h1>No se pudo conectar</h1><p>${esc(e.message||'Revisá la conexión y la clave publicable.')}</p><button class="btn" onclick="location.reload()">Reintentar</button></section>`;});
})();

