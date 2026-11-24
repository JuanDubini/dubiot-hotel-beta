/** @OnlyCurrentDoc */
// Bind this script to the Google Form that receives DubIoT trial requests.
// Set DUBIOT_URL, DUBIOT_PUBLIC_KEY and DUBIOT_IMPORT_KEY in Script Properties.
function installDubiotTrialSync() {
  syncDubiotTrialRequests();
  const installed = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === 'syncDubiotTrialRequests');
  if (!installed) ScriptApp.newTrigger('syncDubiotTrialRequests').timeBased().everyMinutes(5).create();
}

function syncDubiotTrialRequests() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const baseUrl = (props.getProperty('DUBIOT_URL') || '').trim().replace(/\/$/, '');
    const publicKey = (props.getProperty('DUBIOT_PUBLIC_KEY') || '').trim();
    const importKey = (props.getProperty('DUBIOT_IMPORT_KEY') || '').trim();
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(baseUrl) || !publicKey || !/^[a-f0-9]{64}$/.test(importKey)) {
      throw new Error('Completá las tres propiedades de conexión de DubIoT.');
    }
    const form = FormApp.getActiveForm();
    if (!form) throw new Error('Este proyecto de Apps Script debe estar vinculado al formulario.');
    const saved = Number(props.getProperty('DUBIOT_LAST_RESPONSE_MS')) || 0;
    const responses = (saved ? form.getResponses(new Date(saved - 1000)) : form.getResponses())
      .sort((a, b) => a.getTimestamp() - b.getTimestamp());
    for (let index = 0; index < responses.length; index += 50) {
      const batch = responses.slice(index, index + 50);
      const payload = batch.map(dubiotTrialFormRow);
      const result = UrlFetchApp.fetch(baseUrl + '/rest/v1/rpc/ingest_hotel_trial_requests', {
        method: 'post',
        headers: { apikey: publicKey },
        contentType: 'application/json',
        payload: JSON.stringify({ _key: importKey, _responses: payload }),
        muteHttpExceptions: true
      });
      if (result.getResponseCode() !== 200) {
        throw new Error('DubIoT rechazó la sincronización (HTTP ' + result.getResponseCode() + ').');
      }
      props.setProperty('DUBIOT_LAST_RESPONSE_MS',
        String(Math.max(saved, batch[batch.length - 1].getTimestamp().getTime())));
    }
  } finally {
    lock.releaseLock();
  }
}

function dubiotTrialFormRow(response) {
  const normalize = title => title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const fields = Object.fromEntries(response.getItemResponses().map(item =>
    [normalize(item.getItem().getTitle()), String(item.getResponse()).trim()]));
  // Accept common field labels without requiring a specific Google Forms wording.
  const first = (...names) => names.map(name => fields[name]).find(value => value) || '';
  const email = first('email', 'correoelectronico', 'correoelectronicodecontacto',
    'emaildecontacto', 'correodecontacto') || response.getRespondentEmail() || '';
  const contactName = first('nombreyapellido', 'nombreyapellidos', 'nombrecompleto',
    'nombreyapellidodelresponsable', 'nombre', 'responsable', 'nombredecontacto');
  const hotelName = first('nombredelhotel', 'nombredelestablecimiento', 'nombrehotel',
    'hotel', 'establecimiento', 'empresa', 'nombredehotel');
  if (!email.trim()) throw new Error('Una respuesta carece de correo. Revisá el campo obligatorio Email del formulario.');
  if (!hotelName.trim()) throw new Error('No se reconoció el nombre del hotel. Revisá el título de esa pregunta en Google Forms.');
  return {
    id: response.getId(),
    submitted_at: response.getTimestamp().toISOString(),
    contact_name: contactName.slice(0, 160),
    hotel_name: hotelName.slice(0, 180),
    contact_role: first('cargo', 'puesto', 'funcion', 'rol', 'cargodentrodelhotel').slice(0, 100),
    email: email.trim(),
    phone: first('whatsapp', 'numerodewhatsapp', 'telefonodecontacto', 'telefono',
      'numerodetelefono', 'celular', 'movil').slice(0, 60)
  };
}
