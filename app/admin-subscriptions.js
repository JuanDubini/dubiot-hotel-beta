(() => {
  'use strict';

  const root = document.querySelector('#subscriptionRoot');
  const content = root.querySelector('[data-subscription-content]');
  const dialog = root.querySelector('dialog');
  const DAY = 86400000;
  const plans = { basic: 'Básico', professional: 'Profesional', enterprise: 'Empresa' };
  const states = {
    trial: 'En prueba', active: 'Activa', pending_renewal: 'Pendiente de renovación',
    suspended: 'Suspendida', offboarded: 'Dada de baja'
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  let client, snapshot, pickedId, timer, clockOffset, generation = 0;

  function formatDate(value, timeZone) {
    if (!value) return '—';
    const options = { dateStyle: 'medium', timeStyle: 'short' };
    try {
      return new Intl.DateTimeFormat('es-AR', { ...options, timeZone }).format(new Date(value));
    } catch {
      return new Intl.DateTimeFormat('es-AR', options).format(new Date(value));
    }
  }

  function inputDate(value) {
    const date = new Date(value);
    return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function timeLeft(milliseconds) {
    if (milliseconds <= 0) return 'Venció';
    const days = Math.floor(milliseconds / DAY);
    const hours = Math.floor(milliseconds / 3600000) % 24;
    const minutes = Math.ceil(milliseconds / 60000);
    if (days) return `${days} d ${hours} h`;
    if (hours) return `${hours} h ${Math.floor(milliseconds / 60000) % 60} min`;
    return `${Math.min(minutes, 60)} min`;
  }

  function badge(status) {
    const styles = { trial: 'operational', pending_renewal: 'pending', offboarded: 'suspended' };
    return `<span class="badge ${styles[status] || escape(status)}">${states[status] || 'Sin suscripción'}</span>`;
  }

  function periodFor(hotel) {
    return hotel.current_period || hotel.previous_period || hotel.next_period;
  }

  function updateTime() {
    const hotel = snapshot?.hotels.find(item => item.hotel_id === pickedId);
    if (!hotel) return;
    const now = Date.now() + clockOffset;
    const period = periodFor(hotel);
    const remaining = content.querySelector('[data-time-left]');
    if (period && remaining) {
      remaining.textContent = hotel.status === 'offboarded' ? '—'
        : timeLeft(Date.parse(period.ends_at) - now);
    }
    if (!hotel.trial) return;
    const elapsed = Math.max(0, Math.min(14, (now - Date.parse(hotel.trial.starts_at)) / DAY));
    const progress = content.querySelector('progress');
    if (progress) progress.value = elapsed;
    const caption = content.querySelector('[data-trial-days]');
    if (caption) caption.textContent = `${Math.floor(elapsed)} de 14 días`;
    const trialLeft = content.querySelector('[data-trial-left]');
    if (trialLeft) trialLeft.textContent = timeLeft(Date.parse(hotel.trial.ends_at) - now);
  }

  function managerLabel(manager) {
    return manager.name || manager.email || 'Responsable sin nombre';
  }

  function details(hotel) {
    const date = value => formatDate(value, hotel.timezone);
    const manager = hotel.managers[0];
    const phone = hotel.contact_phone || manager?.phone;
    const period = periodFor(hotel);
    const scheduled = hotel.next_period;
    const chosenPlan = period?.plan || scheduled?.plan;
    const offboarded = hotel.status === 'offboarded';
    const automatic = hotel.renewal_mode === 'automatic';
    const currentAuthorization = hotel.authorizations.find(item => item.id === hotel.renewal_authorization_id);
    const overLimit = hotel.user_limit !== null && hotel.active_users > hotel.user_limit;
    const planLabel = chosenPlan ? `${plans[chosenPlan]}${period?.plan ? '' : ' · programado'}` : 'Sin plan contratado';
    const contacts = hotel.managers.map(person =>
      `<span><strong>${escape(managerLabel(person))}</strong>${person.email ? `<small>${escape(person.email)}</small>` : ''}</span>`
    ).join('');
    const consentRows = hotel.authorizations.map(item => {
      const person = hotel.managers.find(candidate => candidate.id === item.customer_user_id);
      return `<li><div><strong>${escape(person ? managerLabel(person) : 'Responsable anterior')}</strong>
        <small>${date(item.agreed_at)} · Términos ${escape(item.terms_version)}</small>
        <small>Referencia ${escape(item.evidence_reference)}</small></div>
        ${item.revoked_at ? `<span class="muted">Revocada · ${date(item.revoked_at)}</span>`
          : `<button type="button" class="btn quiet danger" data-action="revoke" data-consent="${escape(item.id)}">Revocar</button>`}</li>`;
    }).join('');
    return `<article class="panel subscription-detail">
      <div class="subscription-heading"><div><h2>${escape(hotel.name)}</h2><small>${escape(hotel.slug)}</small></div>${badge(hotel.status)}</div>
      <dl class="subscription-facts">
        <div><dt>Responsable y correo</dt><dd class="subscription-contacts">${contacts || 'Sin responsable activo'}</dd></div>
        <div><dt>Teléfono de contacto</dt><dd>${escape(phone || 'Sin registrar')}</dd></div>
        <div><dt>Alta del hotel</dt><dd>${date(hotel.created_at)}<small>${escape(hotel.timezone)}</small></dd></div>
        <div><dt>Plan contratado</dt><dd>${escape(planLabel)}</dd></div>
        <div><dt>Usuarios activos / límite</dt><dd>${hotel.active_users} / ${hotel.user_limit ?? 'Sin configurar'}
          ${overLimit ? '<small class="danger">Supera el límite registrado</small>' : ''}</dd></div>
        <div><dt>Vencimiento del período</dt><dd>${date(period?.ends_at)}<small data-time-left>—</small></dd></div>
      </dl>
      ${hotel.trial ? `<section class="subscription-trial">
        <div class="subscription-heading"><h3>Prueba de 14 días</h3><strong data-trial-days></strong></div>
        <progress max="14" value="0" aria-label="Días transcurridos de prueba"></progress>
        <div class="subscription-heading muted"><span>Inicio ${date(hotel.trial.starts_at)}</span><span>Vencimiento ${date(hotel.trial.ends_at)} · <b data-trial-left></b></span></div>
      </section>` : '<p class="muted">Este hotel todavía no tiene una prueba registrada.</p>'}
      ${scheduled ? `<p class="muted">Próximo período · ${plans[scheduled.plan] || 'Prueba'} · ${date(scheduled.starts_at)} al ${date(scheduled.ends_at)}</p>` : ''}
      <section class="subscription-block">
        <h3>Renovación y avisos</h3>
        ${hotel.status ? `<p>Modalidad <strong>${automatic ? 'Automática autorizada' : 'Manual'}</strong>
          ${currentAuthorization ? ` · Autorizada el ${date(currentAuthorization.agreed_at)}` : ''}</p>` : '<p>Iniciá una prueba o registrá un plan para configurar la renovación.</p>'}
        <p>Avisos por correo <strong>${hotel.email_notices_enabled ? 'Habilitados' : 'Deshabilitados'}</strong></p>
        <div class="actions">
          ${hotel.status ? `<button type="button" class="btn primary" data-action="renew" ${automatic || offboarded ? 'disabled' : ''}>Renovar manualmente</button>
          <button type="button" class="btn" data-action="mode" ${offboarded ? 'disabled' : ''}>Cambiar modalidad</button>
          ${!offboarded && hotel.status !== 'active' && hotel.current_period?.kind === 'paid' ? '<button type="button" class="btn" data-action="activate">Activar período contratado</button>' : ''}`
            : '<button type="button" class="btn primary" data-action="trial">Iniciar prueba</button><button type="button" class="btn" data-action="start">Registrar plan</button>'}
          <button type="button" class="btn quiet" data-action="preferences">Editar contacto, límite y avisos</button>
        </div>
      </section>
      ${hotel.status ? `<section class="subscription-block">
        <div class="subscription-heading"><h3>Autorizaciones del cliente</h3>
        <button type="button" class="btn" data-action="record" ${offboarded || !hotel.managers.length ? 'disabled' : ''}>Registrar autorización</button></div>
        ${!hotel.managers.length && !offboarded ? '<p class="muted">Asigná un responsable activo para registrar una autorización.</p>' : ''}
        ${consentRows ? `<ul class="subscription-consents">${consentRows}</ul>` : '<p class="muted">Todavía no hay autorizaciones registradas.</p>'}
      </section>` : ''}
      ${hotel.status && !offboarded ? `<div class="subscription-block"><button type="button" class="btn quiet danger" data-action="offboard">Dar de baja al cliente</button></div>` : ''}
    </article>`;
  }

  function render() {
    const hotels = snapshot.hotels;
    const hotel = hotels.find(item => item.hotel_id === pickedId) || hotels[0];
    if (!hotel) {
      content.innerHTML = '<p class="panel">Todavía no hay establecimientos registrados.</p>';
      return;
    }
    pickedId = hotel.hotel_id;
    content.innerHTML = `<div class="subscription-layout">
      <nav class="panel subscription-menu" aria-label="Establecimientos">
        <h2>Establecimientos <small>${hotels.length}</small></h2>
        ${hotels.map(item => `<button type="button" class="subscription-hotel" data-hotel="${escape(item.hotel_id)}"
          ${item === hotel ? 'aria-current="true"' : ''}><b>${escape(item.name)}</b>${badge(item.status)}</button>`).join('')}
      </nav>${details(hotel)}
    </div>`;
    updateTime();
  }

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function load() {
    const version = ++generation;
    const refresh = root.querySelector('[data-subscription-refresh]');
    refresh.disabled = true;
    if (!snapshot) content.innerHTML = '<p class="panel" role="status">Cargando suscripciones…</p>';
    try {
      const result = await rpc('platform_admin_subscription_overview');
      if (version !== generation) return;
      snapshot = result;
      clockOffset = Date.parse(result.generated_at) - Date.now();
      render();
    } catch (error) {
      if (version !== generation) return;
      snapshot = null;
      const message = error.code === 'PGRST202'
        ? 'Esta versión de la base aún no tiene el módulo de suscripciones. Aplicá las migraciones 010 y 011 antes de usarlo.'
        : error.code === '42501' ? 'Volvé a ingresar con la cuenta administradora y verificá tu identidad.'
          : 'No se pudieron cargar las suscripciones. Probá actualizar.';
      content.innerHTML = `<p class="panel" role="alert">${message}</p>`;
    } finally {
      if (version === generation) refresh.disabled = false;
    }
  }

  function showAction(hotel, action, consentId) {
    const args = { _hotel_id: hotel.hotel_id };
    const notes = '<label class="field">Motivo o nota (opcional)<textarea class="input" name="notes" maxlength="1000"></textarea></label>';
    const date = value => formatDate(value, hotel.timezone);
    const planOptions = Object.entries(plans).map(([value, label]) =>
      `<option value="${value}" ${hotel.latest_period?.plan === value ? 'selected' : ''}>${label}</option>`
    ).join('');
    const value = (form, key) => String(form.get(key) ?? '').trim();
    const renewalStart = Math.max(Date.now() + clockOffset, Date.parse(hotel.latest_period?.ends_at) || 0);
    const periodFields = `<label class="field">Plan<select class="input" name="plan" required>${planOptions}</select></label>
      <label class="field">Nuevo vencimiento (hora de este dispositivo)
      <input class="input" name="ends" type="datetime-local" required min="${inputDate(renewalStart + 60000)}" value="${inputDate(renewalStart + 30 * DAY)}"></label>`;
    let title, body, run, confirm = 'Guardar', danger = false;

    switch (action) {
      case 'trial':
        title = 'Iniciar prueba';
        body = '<p>La prueba empieza al confirmar y dura 336 horas.</p>';
        confirm = 'Confirmar inicio';
        run = () => rpc('platform_admin_start_hotel_subscription', args);
        break;
      case 'start':
      case 'renew':
        title = action === 'renew' ? 'Renovar manualmente' : 'Registrar plan';
        body = `${action === 'renew' ? `<p>El nuevo período empieza al terminar el último registrado o al confirmar, si ya venció. Inicio previsto ${date(renewalStart)}.</p>` : ''}${periodFields}${action === 'renew' ? notes : ''}`;
        run = form => {
          const end = new Date(value(form, 'ends')).toISOString();
          const data = { ...args, _plan: value(form, 'plan') };
          return action === 'renew'
            ? rpc('platform_admin_renew_hotel_subscription', { ...data, _ends_at: end, _notes: value(form, 'notes') })
            : rpc('platform_admin_start_hotel_subscription', { ...data, _paid_until: end });
        };
        break;
      case 'activate':
        title = 'Activar período contratado';
        body = '<p>La suscripción quedará activa durante el período contratado vigente.</p>';
        confirm = 'Activar';
        run = () => rpc('platform_admin_set_hotel_subscription_status', { ...args, _status: 'active' });
        break;
      case 'preferences':
        title = 'Contacto, límite y avisos';
        body = `<label class="field">Teléfono de contacto del hotel<input class="input" type="tel" name="phone" maxlength="40" value="${escape(hotel.contact_phone)}" placeholder="${escape(hotel.managers[0]?.phone || 'Ej. +54 11 1234 5678')}"></label>
          <label class="field">Límite de usuarios<input class="input" type="number" name="limit" min="1" max="2147483647" step="1" value="${escape(hotel.user_limit)}" placeholder="Sin configurar"></label>
          <label class="subscription-check"><input type="checkbox" name="notices" ${hotel.email_notices_enabled ? 'checked' : ''} ${hotel.status === 'offboarded' ? 'disabled' : ''}> Habilitar avisos opcionales por correo</label>
          <p class="muted">Se guarda la preferencia. El envío de avisos todavía está desactivado.</p>`;
        run = form => rpc('platform_admin_save_subscription_preferences', {
          ...args, _contact_phone: value(form, 'phone') || null, _user_limit: Number(value(form, 'limit')) || null,
          _email_notices_enabled: form.has('notices')
        });
        break;
      case 'mode': {
        const authorizations = hotel.authorizations.filter(item => !item.revoked_at);
        const automatic = hotel.renewal_mode === 'automatic';
        title = 'Modalidad de renovación';
        body = `<fieldset class="subscription-modes"><legend>Elegí una modalidad</legend>
          <label><input type="radio" name="mode" value="manual" ${automatic ? '' : 'checked'}> Manual</label>
          <label><input type="radio" name="mode" value="automatic" ${automatic ? 'checked' : ''} ${authorizations.length ? '' : 'disabled'}> Automática autorizada</label>
          </fieldset>
          ${authorizations.length ? `<label class="field" data-mode-consent>Autorización vigente
            <select class="input" name="consent">${authorizations.map(item => `<option value="${escape(item.id)}" ${item.id === hotel.renewal_authorization_id ? 'selected' : ''}>${date(item.agreed_at)} · ${escape(item.terms_version)} · ${escape(item.evidence_reference)}</option>`).join('')}</select></label>`
            : '<p class="muted">Registrá una autorización para habilitar la modalidad automática.</p>'}
          <p class="muted">La modalidad automática guarda la autorización. La ejecución se habilitará en una etapa posterior.</p>`;
        run = form => rpc('platform_admin_set_hotel_renewal_mode', {
          ...args, _authorization_id: value(form, 'mode') === 'automatic' ? value(form, 'consent') : null
        });
        break;
      }
      case 'record':
        title = 'Registrar autorización del cliente';
        body = `<label class="field">Responsable que autorizó<select class="input" name="customer" required>
          ${hotel.managers.map(person => `<option value="${escape(person.id)}">${escape(managerLabel(person))}</option>`).join('')}</select></label>
          <label class="field">Fecha y hora de autorización (hora de este dispositivo)
          <input class="input" type="datetime-local" name="agreed" required max="${inputDate(Date.now() + clockOffset)}" value="${inputDate(Date.now() + clockOffset)}"></label>
          <label class="field">Versión de los términos<input class="input" name="terms" maxlength="80" required></label>
          <label class="field">Referencia de la constancia<input class="input" name="evidence" maxlength="300" required placeholder="Número de documento o referencia interna"></label>`;
        run = form => rpc('platform_admin_record_hotel_renewal_authorization', {
          ...args, _customer_user_id: value(form, 'customer'), _agreed_at: new Date(value(form, 'agreed')).toISOString(),
          _terms_version: value(form, 'terms'), _evidence_reference: value(form, 'evidence')
        });
        break;
      case 'revoke':
        title = 'Revocar autorización';
        body = `<p>${consentId === hotel.renewal_authorization_id
          ? 'La renovación volverá a modalidad manual.' : 'La autorización dejará de estar disponible para futuras renovaciones.'}</p>${notes}`;
        confirm = 'Confirmar revocación';
        danger = true;
        run = form => rpc('platform_admin_revoke_hotel_renewal_authorization', {
          ...args, _authorization_id: consentId, _notes: value(form, 'notes')
        });
        break;
      case 'offboard':
        title = 'Dar de baja al cliente';
        body = `<p>La suscripción quedará dada de baja, pasará a renovación manual y se deshabilitarán los avisos. El historial se conserva.</p>
          <label class="field">Escribí <strong>${escape(hotel.slug)}</strong> para confirmar
          <input class="input" name="confirmation" autocomplete="off" required></label>${notes}`;
        confirm = 'Confirmar baja';
        danger = true;
        run = form => rpc('platform_admin_offboard_hotel_subscription', {
          ...args, _confirmation: value(form, 'confirmation'), _notes: value(form, 'notes')
        });
        break;
      default:
        return;
    }

    dialog.innerHTML = `<form><h2 id="subscriptionDialogTitle">${title}</h2><p class="muted">${escape(hotel.name)}</p>
      ${body}<p class="notice" role="alert" hidden></p><div class="actions">
        <button class="btn quiet" type="button" data-cancel>Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${confirm}</button>
      </div></form>`;
    const form = dialog.querySelector('form');
    const submit = form.querySelector('[type=submit]');
    const cancel = form.querySelector('[data-cancel]');
    const feedback = form.querySelector('[role=alert]');
    const modeConsent = form.querySelector('[data-mode-consent]');
    const code = form.elements.confirmation;
    if (code) {
      submit.disabled = true;
      code.oninput = () => { submit.disabled = code.value.trim() !== hotel.slug; };
    }
    if (modeConsent) {
      const toggle = () => { modeConsent.hidden = form.elements.mode.value !== 'automatic'; };
      form.onchange = toggle;
      toggle();
    }
    cancel.onclick = () => dialog.close();
    dialog.oncancel = event => { if (cancel.disabled) event.preventDefault(); };
    form.onsubmit = async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = cancel.disabled = true;
      feedback.hidden = true;
      const version = generation;
      try {
        await run(new FormData(form));
        if (version !== generation) return;
        dialog.close();
        root.querySelector('[data-subscription-feedback]').textContent = 'Cambios guardados.';
        await load();
        content.querySelector('[aria-current]')?.focus();
      } catch (error) {
        if (version !== generation) return;
        const translations = {
          'Select manual renewal mode first': 'Cambiá a modalidad manual antes de renovar.',
          'Automatic renewal requires a current authorization for this hotel': 'Seleccioná una autorización vigente de este hotel.',
          'Hotel confirmation does not match': 'El código de confirmación no coincide.',
          'Authorization requires an active customer representative for this hotel': 'La autorización debe corresponder a un responsable activo de este hotel.'
        };
        feedback.textContent = translations[error.message] || (error.code === '42501'
          ? 'La operación requiere una cuenta administradora con MFA.'
          : 'No se pudo guardar. Revisá los datos e intentá de nuevo.');
        feedback.hidden = false;
        submit.disabled = cancel.disabled = false;
      }
    };
    dialog.showModal();
  }

  content.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !snapshot) return;
    if (button.dataset.hotel) {
      pickedId = button.dataset.hotel;
      render();
      content.querySelector('[aria-current]')?.focus();
    } else if (button.dataset.action) {
      const hotel = snapshot.hotels.find(item => item.hotel_id === pickedId);
      if (hotel) showAction(hotel, button.dataset.action, button.dataset.consent);
    }
  });
  root.querySelector('[data-subscription-refresh]').onclick = () => {
    root.querySelector('[data-subscription-feedback]').textContent = '';
    load();
  };

  window.DubiotSubscriptions = {
    async open(supabase) {
      client = supabase;
      root.hidden = false;
      root.querySelector('h1').focus();
      await load();
      if (!root.hidden) timer = setInterval(updateTime, 15000);
    },
    close() {
      generation++;
      clearInterval(timer);
      if (dialog.open) dialog.close();
      dialog.innerHTML = '';
      root.hidden = true;
      content.innerHTML = '';
      root.querySelector('[data-subscription-feedback]').textContent = '';
      snapshot = null;
      pickedId = null;
      client = null;
    }
  };
})();
