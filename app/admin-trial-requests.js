(() => {
  'use strict';

  const root = document.querySelector('#trialRequestsRoot');
  const content = root.querySelector('[data-trial-content]');
  const dialog = root.querySelector('dialog');
  const filter = root.querySelector('select');
  const feedback = root.querySelector('[data-trial-feedback]');
  const pageSize = 25;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const date = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
  const errors = {
    'The applicant needs a confirmed DubIoT account': 'El contacto necesita una cuenta confirmada con el mismo correo.',
    'Review the existing hotel subscription before activating access': 'Revisá la suscripción de ese hotel antes de activar el acceso.',
    'Review this user\'s suspended or rejected membership first': 'Revisá el acceso suspendido o rechazado en Administración de usuarios.',
    'Trial request is no longer pending': 'Otra sesión ya revisó esta solicitud. Actualizá la lista.'
  };
  let client, page, offset = 0, generation = 0;

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function render() {
    if (!page.requests.length) {
      content.innerHTML = '<p class="panel">No hay solicitudes en este estado.</p>';
      return;
    }
    const cards = page.requests.map(request => `<article class="panel subscription-block">
      <div class="subscription-heading"><h2>${escape(request.hotel_name || 'Hotel sin nombre')}</h2>
      <time class="muted">${date.format(new Date(request.submitted_at))}</time></div>
      <p>${escape(request.contact_name || 'Contacto sin nombre')}${request.contact_role ? ` · ${escape(request.contact_role)}` : ''}</p>
      <p>${escape(request.email)}${request.phone ? ` · ${escape(request.phone)}` : ''}</p>
      ${request.status === 'pending' ? `<div class="actions">
        <button class="btn primary" data-id="${escape(request.id)}" data-decision="approved">Aprobar solicitud</button>
        <button class="btn quiet danger" data-id="${escape(request.id)}" data-decision="rejected">Rechazar</button>
      </div>` : ''}
      ${request.status === 'approved' ? `<div class="actions">
        <button class="btn primary" data-id="${escape(request.id)}" data-decision="activate" ${request.account_confirmed ? '' : 'disabled'}>Activar acceso</button>
        ${request.account_confirmed ? '' : '<span class="muted">Falta que el contacto confirme su cuenta de DubIoT.</span>'}
      </div>` : ''}
      ${request.activated_hotel_name ? `<p>Acceso habilitado para ${escape(request.activated_hotel_name)}</p>` : ''}
    </article>`).join('');
    content.innerHTML = cards + (page.total > pageSize ? `<div class="actions">
      <button class="btn" data-page="-1" ${offset ? '' : 'disabled'}>Anterior</button>
      <span class="muted">${offset + 1}–${Math.min(offset + pageSize, page.total)} de ${page.total}</span>
      <button class="btn" data-page="1" ${offset + pageSize < page.total ? '' : 'disabled'}>Siguiente</button>
    </div>` : '');
  }

  async function load() {
    const version = ++generation;
    page = null;
    content.innerHTML = '<p class="panel" role="status">Cargando solicitudes…</p>';
    try {
      const result = await rpc('platform_admin_trial_requests', { _status: filter.value, _offset: offset });
      if (version !== generation) return;
      if (offset && !result.requests.length) {
        offset = Math.max(0, offset - pageSize);
        await load();
        return;
      }
      page = result;
      render();
    } catch (error) {
      if (version !== generation) return;
      content.innerHTML = `<p class="panel" role="alert">${error.code === 'PGRST202'
        ? 'La base de datos todavía no tiene instalada la bandeja de solicitudes.'
        : 'No se pudieron cargar las solicitudes. Verificá tu sesión de administrador y actualizá.'}</p>`;
    }
  }

  function showDialog(title, body, label, action) {
    dialog.innerHTML = `<form><h2 id="trialDialogTitle">${title}</h2>${body}
      <p class="notice" role="alert" hidden></p>
      <div class="actions"><button class="btn quiet" type="button" data-close>Cancelar</button>
      <button class="btn primary" type="submit">${label}</button></div></form>`;
    const form = dialog.querySelector('form');
    const submit = form.querySelector('[type=submit]');
    const close = form.querySelector('[data-close]');
    const alert = form.querySelector('[role=alert]');
    close.onclick = () => dialog.close();
    dialog.oncancel = event => { if (close.disabled) event.preventDefault(); };
    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      const version = generation;
      submit.disabled = close.disabled = true;
      alert.hidden = true;
      try {
        const done = await action(new FormData(form), version);
        if (version !== generation || done === false) return;
        dialog.close();
        feedback.textContent = 'Cambios guardados.';
        await load();
      } catch (error) {
        if (version !== generation) return;
        alert.textContent = errors[error.message] || (error.code === '23505'
          ? 'Ese código de hotel ya existe. Elegí un código diferente o vinculá el hotel existente.'
          : 'No se pudo completar la operación. Verificá los datos y tu sesión.');
        alert.hidden = false;
        submit.disabled = close.disabled = false;
      }
    };
    dialog.showModal();
    return form;
  }

  function activate(request) {
    const name = request.hotel_name || '';
    const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').slice(0, 80).replace(/^-|-$/g, '');
    const hotelOptions = page.hotels.map(hotel =>
      `<option value="${escape(hotel.id)}">${escape(hotel.name)} (${escape(hotel.slug)})</option>`).join('');
    const form = showDialog('Activar acceso', `<p>Se asignará a ${escape(request.email)} como responsable.
      Los 14 días empiezan al activar un establecimiento sin suscripción. Si ya tiene un período vigente, se conserva.</p>
      <label class="field">Establecimiento<select class="input" name="hotel" required>
        <option value="" disabled selected>Elegí si vas a crear o vincular un hotel</option>
        <option value="new">Crear hotel</option>${hotelOptions}</select></label>
      <div data-new-hotel hidden><label class="field">Nombre<input class="input" name="name" required maxlength="180" value="${escape(name)}" disabled></label>
      <label class="field">Código<input class="input" name="slug" required maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${escape(slug)}" disabled></label></div>`,
    'Confirmar activación', data => rpc('platform_admin_activate_trial_request', {
      _id: request.id, _hotel_id: data.get('hotel') === 'new' ? null : data.get('hotel'),
      _hotel_name: data.get('name'), _hotel_slug: data.get('slug')
    }));
    form.elements.hotel.onchange = () => {
      const isNew = form.elements.hotel.value === 'new';
      form.querySelector('[data-new-hotel]').hidden = !isNew;
      form.elements.name.disabled = form.elements.slug.disabled = !isNew;
    };
  }

  root.querySelector('[data-trial-key]').onclick = () => {
    showDialog('Clave de sincronización', '<p>Al generar una clave nueva, la anterior deja de funcionar. Guardala en las propiedades privadas del proyecto de Apps Script.</p>',
      'Generar clave', async (_, version) => {
        const key = await rpc('platform_admin_rotate_trial_import_key');
        if (version !== generation) return false;
        dialog.innerHTML = '<h2 id="trialDialogTitle">Clave de sincronización</h2><p>Copiala ahora. Se muestra una sola vez.</p><label class="field">Clave<input class="input" readonly></label><div class="actions"><button class="btn" type="button">Cerrar</button></div>';
        const field = dialog.querySelector('input');
        field.value = key;
        field.onclick = () => field.select();
        dialog.querySelector('button').onclick = () => dialog.close();
        dialog.oncancel = null;
        field.focus();
        field.select();
        return false;
      });
  };

  dialog.addEventListener('close', () => {
    if (!dialog.open) dialog.replaceChildren();
  });

  content.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !page || button.disabled) return;
    if (button.dataset.page) {
      offset += pageSize * Number(button.dataset.page);
      load();
      return;
    }
    const request = page.requests.find(item => item.id === button.dataset.id);
    if (!request) return;
    const decision = button.dataset.decision;
    if (decision === 'activate') {
      activate(request);
      return;
    }
    const accepting = decision === 'approved';
    showDialog(accepting ? 'Aprobar solicitud' : 'Rechazar solicitud',
      `<p>${escape(request.hotel_name || request.email)}</p>${accepting ? '<p>La solicitud queda aprobada para que después habilites el acceso.</p>' : ''}`,
      accepting ? 'Confirmar aprobación' : 'Confirmar rechazo',
      () => rpc('platform_admin_review_trial_request', { _id: request.id, _status: decision }));
  });

  filter.onchange = () => { offset = 0; feedback.textContent = ''; load(); };
  root.querySelector('[data-trial-refresh]').onclick = () => load();

  window.DubiotTrialRequests = {
    open(supabase) {
      client = supabase;
      root.hidden = false;
      root.querySelector('h1').focus();
      load();
    },
    close() {
      generation++;
      if (dialog.open) dialog.close();
      dialog.replaceChildren();
      root.hidden = true;
      page = client = null;
      offset = 0;
      filter.value = 'pending';
      content.replaceChildren();
      feedback.textContent = '';
    }
  };
})();
