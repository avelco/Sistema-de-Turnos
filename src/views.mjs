import { SERVICE_NAMES } from './db.mjs';

const STATUS_LABELS = {
  waiting: 'En espera',
  called: 'Llamado',
  attending: 'En atención',
  completed: 'Atendido',
  absent: 'Ausente',
  cancelled: 'Cancelado',
  blocked: 'En toma de muestras'
};

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name, className = 'icon') {
  const paths = {
    logo: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="m9 12 2 2 5-5"/>',
    reception: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    attention: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/>',
    display: '<rect width="18" height="13" x="3" y="4" rx="2"/><path d="M8 21h8M12 17v4"/>',
    lab: '<path d="M9 3h6M10 3v6.5l-5 8.8A1.8 1.8 0 0 0 6.6 21h10.8a1.8 1.8 0 0 0 1.6-2.7l-5-8.8V3"/><path d="M7.2 16h9.6"/>',
    xray: '<path d="M9.5 4.5c-2-2-5 .2-4 2.7l2 4.8-2 4.8c-1 2.5 2 4.7 4 2.7L12 17l2.5 2.5c2 2 5-.2 4-2.7l-2-4.8 2-4.8c1-2.5-2-4.7-4-2.7L12 7 9.5 4.5Z"/><path d="M12 7v10"/>',
    refresh: '<path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 2 8"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    ticket: '<path d="M2 9a3 3 0 0 0 0 6v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a3 3 0 0 1 0-6V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    absent: '<circle cx="9" cy="7" r="4"/><path d="M2 21a7 7 0 0 1 11.6-5.3M16 16l5 5M21 16l-5 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    sparkle: '<path d="m12 3-1.4 3.6L7 8l3.6 1.4L12 13l1.4-3.6L17 8l-3.6-1.4L12 3Z"/><path d="m5 15-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8L5 15Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    admin: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4M12 15v2"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><rect x="9" y="10" width="6" height="5" rx="1"/><path d="M10.5 10V8.7a1.5 1.5 0 0 1 3 0V10"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/>',
    stopwatch: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6M12 2v3"/>'
  };
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
}

function firstName(name) {
  return name.split(/\s+/)[0] || name;
}

function localTime(value) {
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function minutesWaiting(value) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

function serviceIcon(service, className = 'icon') {
  return icon(service === 'lab' ? 'lab' : 'xray', className);
}

function layout({ title, active, body, publicDisplay = false, adminState = '' }) {
  const nav = publicDisplay || adminState === 'login' ? '' : `
    <nav class="top-nav" aria-label="Navegación principal">
      <a class="nav-link ${active === 'reception' ? 'is-active' : ''}" href="/recepcion">${icon('reception')}<span>Recepción</span></a>
      <a class="nav-link ${active === 'attention' ? 'is-active' : ''}" href="/atencion">${icon('attention')}<span>Atención</span></a>
      <a class="nav-link ${active === 'display' ? 'is-active' : ''}" href="/pantalla">${icon('display')}<span>Pantalla</span></a>
      ${adminState === 'authenticated' ? '' : `<a class="nav-link ${active === 'settings' ? 'is-active' : ''}" href="/configuracion">${icon('settings')}<span>Configuración</span></a>`}
      <a class="nav-link nav-admin ${active === 'admin' ? 'is-active' : ''}" href="/admin">${icon('admin')}<span>Administración</span></a>
    </nav>`;

  const utility = publicDisplay
    ? `<div class="display-utility">
        <details class="voice-settings">
          <summary class="audio-status" data-audio-activate aria-label="Activar el audio de los llamados">
            ${icon('volume')}<span data-audio-label>Activar audio</span>${icon('chevron', 'icon voice-chevron')}
          </summary>
          <div class="voice-panel">
            <strong>Voz de los llamados</strong>
            <label for="voice-select">Voz en español</label>
            <select id="voice-select" data-voice-select aria-describedby="voice-status">
              <option value="">Buscando voces disponibles…</option>
            </select>
            <button class="button button-secondary voice-test" type="button" data-test-voice>${icon('volume')} Probar voz</button>
            <p id="voice-status" data-voice-status aria-live="polite">Se priorizarán las voces naturales instaladas en este equipo.</p>
          </div>
        </details>
        <time class="live-clock" aria-label="Hora actual">--:--:-- --</time>
      </div>`
    : adminState === 'authenticated'
      ? `<form class="admin-logout" method="post" action="/admin/logout"><button type="submit">${icon('logout')}<span>Cerrar sesión</span></button></form>`
      : adminState === 'login'
        ? ''
        : `<div class="user-block"><span class="user-avatar">MG</span><span><strong>María G.</strong><small>Recepción</small></span></div>`;

  const bodyClass = [publicDisplay ? 'display-body' : '', adminState ? `admin-${adminState}-body` : ''].filter(Boolean).join(' ');
  const eventAttributes = adminState ? '' : 'hx-ext="sse" sse-connect="/eventos"';
  const brandMark = adminState ? icon('lab', 'brand-mark admin-brand-mark') : icon('logo', 'brand-mark');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#087f78">
  <title>${escapeHtml(title)} · Lab. María Eugenia Tamayo Giraldo</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/vendor/htmx.min.js" defer></script>
  <script src="/vendor/htmx-ext-sse.js" defer></script>
  <script src="/app.js" defer></script>
</head>
<body class="${bodyClass}" ${eventAttributes}>
  <a class="skip-link" href="#contenido">Saltar al contenido</a>
  <header class="app-header ${publicDisplay ? 'display-header' : ''} ${adminState === 'login' ? 'admin-login-header' : ''}">
    <a class="brand" href="${adminState ? '/admin' : '/recepcion'}" aria-label="Lab. María Eugenia Tamayo Giraldo, inicio">${brandMark}<span>Lab. María Eugenia Tamayo Giraldo</span></a>
    ${nav}
    ${utility}
  </header>
  ${body}
  <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>
</body>
</html>`;
}

function fieldError(errors, key) {
  return errors?.[key] ? `<p class="field-error" id="${key}-error">${icon('info')} ${escapeHtml(errors[key])}</p>` : '';
}

export function renderRegistrationPanel({ values = {}, errors = {}, created = null } = {}) {
  const selected = values.service || 'lab';
  const priority = values.priority === '1' || values.priority === true;
  return `<section id="registration-panel" class="registration-panel" aria-labelledby="registration-title">
    <div class="registration-form-wrap">
      <form class="registration-form" hx-post="/turnos" hx-target="#registration-panel" hx-swap="outerHTML" novalidate>
        <ol class="form-steps">
          <li class="form-step">
            <span class="step-number">1</span>
            <div class="step-copy"><strong>Paciente</strong><small>Nombre completo</small></div>
            ${renderPatientNameControl(values.name || '', errors.name, true)}
          </li>
          <li class="form-step">
            <span class="step-number">2</span>
            <div class="step-copy"><strong>Servicio</strong><small>Elige una opción</small></div>
            <fieldset class="step-control service-fieldset">
              <legend>Servicio solicitado</legend>
              ${serviceChoice('lab', 'Toma de muestras', 'Recepción y procesamiento de muestras', selected, 'lab')}
              ${serviceChoice('xray', 'Rayos X', 'Imágenes diagnósticas', selected, 'xray')}
              ${serviceChoice('both', 'Toma de muestras + Rayos X', 'Crea un turno para cada cola', selected, 'lab')}
              ${fieldError(errors, 'service')}
            </fieldset>
          </li>
          <li class="form-step is-last">
            <span class="step-number">3</span>
            <div class="step-copy"><strong>Prioridad</strong><small>Opcional</small></div>
            <div class="step-control priority-control">
              <label class="switch-row" for="priority">
                <input type="checkbox" id="priority" name="priority" value="1" ${priority ? 'checked' : ''}>
                <span class="switch" aria-hidden="true"></span>
                <span><strong>Atención prioritaria</strong><small>Personas mayores, embarazadas o con indicación médica.</small></span>
              </label>
            </div>
          </li>
        </ol>
        ${errors.form ? `<div class="form-alert" role="alert">${icon('info')}<span>${escapeHtml(errors.form)}</span></div>` : ''}
        <div class="form-actions">
          <button class="button button-secondary" type="reset">Limpiar</button>
          <button class="button button-primary" type="submit">${icon('ticket')} Crear turno</button>
        </div>
      </form>
    </div>
    ${created ? renderCreatedTicket(created) : renderRegistrationReady()}
  </section>`;
}

function renderPatientNameControl(value = '', error = '', autofocus = false) {
  return `<div id="patient-name-control" class="step-control">
    <label for="name">Nombre del paciente</label>
    <input id="name" name="name" autocomplete="name" maxlength="100" value="${escapeHtml(value)}" placeholder="Ej. María López"
      aria-describedby="${error ? 'name-error' : 'name-help'}" ${autofocus ? 'autofocus' : ''}>
    <small id="name-help" class="field-help">Escribe el nombre completo.</small>
    ${error ? `<p class="field-error" id="name-error">${icon('info')} ${escapeHtml(error)}</p>` : ''}
  </div>`;
}

function serviceChoice(value, title, description, selected, iconService) {
  return `<label class="service-choice ${selected === value ? 'is-selected' : ''}">
    <input type="radio" name="service" value="${value}" ${selected === value ? 'checked' : ''}>
    <span class="radio-dot" aria-hidden="true"></span>
    <span class="service-choice-icons">
      ${serviceIcon(iconService, 'service-choice-icon')}
      ${value === 'both' ? serviceIcon('xray', 'service-choice-icon') : ''}
    </span>
    <span class="choice-copy"><strong>${title}</strong><small>${description}</small></span>
    ${icon('chevron', 'choice-chevron')}
  </label>`;
}

function renderRegistrationReady() {
  return `<aside class="registration-result is-ready" aria-label="Estado del registro">
    <span class="result-icon">${icon('sparkle')}</span>
    <h2 id="registration-title">Listo para registrar</h2>
    <p>Completa los datos y crearemos el turno en la cola correcta.</p>
    <div class="privacy-note">${icon('check')} El nombre se mostrará en la pantalla pública al hacer el llamado.</div>
  </aside>`;
}

function renderCreatedTicket(created) {
  const codes = created.entries.map((entry) => `<strong class="created-code">${escapeHtml(entry.publicCode)}</strong>`).join('');
  const services = created.entries.map((entry) => entry.serviceName).join(' y ');
  return `<aside class="registration-result is-created" aria-live="polite" data-created-turn="true">
    <span class="result-icon success">${icon('check')}</span>
    <p class="result-kicker">Turno creado</p>
    <div class="created-codes">${codes}</div>
    <h2>${escapeHtml(firstName(created.name))} ya está en cola</h2>
    <p>${escapeHtml(services)} · ${created.priority ? 'Atención prioritaria' : 'Atención regular'}</p>
    ${created.sequential ? `<p class="sequence-note">Primero Toma de muestras. Rayos X se habilitará al finalizar.</p>` : ''}
    <button type="button" class="button button-print js-print">${icon('print')} Imprimir turno</button>
    <button type="button" class="text-button" hx-get="/recepcion/formulario" hx-target="#registration-panel" hx-swap="outerHTML">Registrar otra persona</button>
  </aside>`;
}

export function renderQueueSummary(summary) {
  return `<div class="section-heading inline-heading"><div><h2>Colas ahora</h2><p>Actualización en tiempo real</p></div>${icon('refresh', 'heading-icon')}</div>
    <div class="queue-stack">
      ${queueSummaryItem(summary.lab)}
      ${queueSummaryItem(summary.xray)}
    </div>
    <p class="summary-note">${icon('info')} Los tiempos son estimados según la cantidad de personas en espera.</p>`;
}

function queueSummaryItem(item) {
  return `<section class="queue-summary-item queue-${item.service}">
    <div class="queue-title">${serviceIcon(item.service, 'queue-service-icon')}<h3>${item.name}</h3></div>
    <div class="queue-metrics">
      <div><span>En espera</span><strong>${item.waiting}</strong></div>
      <div><span>Espera estimada</span><strong class="estimate">${item.estimated}<small> min</small></strong></div>
    </div>
    ${item.blocked ? `<div class="transfer-note">${serviceIcon('lab')} ${item.blocked} ${item.blocked === 1 ? 'persona continúa' : 'personas continúan'} en Toma de muestras</div>` : ''}
    <div class="last-called"><span>Atendiendo ahora</span><strong>${item.activeCount} ${item.activeCount === 1 ? 'puesto' : 'puestos'}</strong></div>
  </section>`;
}

export function renderRecentArrivals(rows) {
  if (!rows.length) return `<div class="empty-row">Todavía no hay turnos registrados.</div>`;
  return `<div class="recent-table" role="table" aria-label="Últimos turnos">
    <div class="recent-row recent-head" role="row">
      <span role="columnheader">Turno</span><span role="columnheader">Paciente</span><span role="columnheader">Servicio</span><span role="columnheader">Estado</span><span role="columnheader">Hora</span>
    </div>
    ${rows.map((row) => {
      const status = row.status === 'waiting' && !row.available ? 'blocked' : row.status;
      return `<div class="recent-row" role="row">
      <strong role="cell">${escapeHtml(row.publicCode)}</strong>
      <span role="cell" class="recent-patient-name">${escapeHtml(row.patientName)}</span>
      <span role="cell">${SERVICE_NAMES[row.service]}</span>
      <span role="cell"><span class="status-dot status-${status}"></span>${STATUS_LABELS[status]}</span>
      <time role="cell">${localTime(row.createdAt)}</time>
    </div>`;
    }).join('')}
  </div>`;
}

export async function receptionPage(store, state = {}) {
  const body = `<main id="contenido" class="page reception-page">
    <header class="page-title">
      <div><h1>Recepción</h1><p>Registra una llegada en menos de un minuto.</p></div>
    </header>
    <div class="reception-grid">
      ${renderRegistrationPanel(state)}
      <aside id="queue-summary" class="queue-summary" sse-swap="queue-summary">${renderQueueSummary(await store.queueSummary())}</aside>
      <section class="recent-section" aria-labelledby="recent-title">
        <div class="section-heading"><h2 id="recent-title">Últimos turnos</h2><p>Las llegadas más recientes del día</p></div>
        <div id="recent-arrivals" sse-swap="recent-arrivals">${renderRecentArrivals(await store.recentArrivals())}</div>
      </section>
    </div>
  </main>`;
  return layout({ title: 'Recepción', active: 'reception', body });
}

async function selectedStation(store, service, stationId) {
  const stations = await store.listStations(service);
  return stations.find((station) => station.id === Number(stationId)) || stations[0] || null;
}

export async function renderAttentionContent(store, service = 'lab', stationId = null, message = null) {
  const station = await selectedStation(store, service, stationId);
  if (!station) return `<div class="attention-alert error" role="alert">${icon('info')} No hay puestos activos para este servicio.</div>`;
  const active = await store.getActive(service, station.id);
  const queue = await store.waitingQueue(service);
  const stats = await store.serviceStats(service);
  const serviceName = SERVICE_NAMES[service];
  const queueDescription = stats.waiting ?
  `${stats.waiting} ${stats.waiting === 1 ? 'persona espera' : 'personas esperan'} en ${serviceName}.` :
  stats.blocked ?
  `${stats.blocked} ${stats.blocked === 1 ? 'persona continúa' : 'personas continúan'} en Toma de muestras y todavía no ${stats.blocked === 1 ? 'puede' : 'pueden'} ser ${stats.blocked === 1 ? 'llamada' : 'llamadas'}.` :
  `La cola de ${serviceName} está al día.`;
  const alert = message ? `<div class="attention-alert ${message.type || ''}" role="status">${icon(message.type === 'error' ? 'info' : 'check')} ${escapeHtml(message.text)}</div>` : '';

  return `${alert}
    <section class="attention-command ${active ? 'has-active' : 'is-ready'}">
      ${active ? `<div class="current-turn">
        <span class="current-icon">${icon(active.status === 'attending' ? 'play' : 'attention')}</span>
        <div class="current-code"><small>Turno actual</small><strong>${escapeHtml(active.publicCode)}</strong><span>Paciente <b>${escapeHtml(active.patientName)}</b></span></div>
        <div class="current-status"><small>${serviceName}</small><strong>${escapeHtml(station.name)}</strong><span>${STATUS_LABELS[active.status]}</span></div>
      </div>
      <div class="attention-actions">
        ${active.status === 'called' ? `
          <button class="button button-primary action-main" hx-post="/atencion/iniciar" hx-vals='{"entryId":"${active.id}","service":"${service}","stationId":"${station.id}"}' hx-target="#attention-content">${icon('play')} Iniciar atención</button>
          <button class="button button-secondary" hx-post="/atencion/repetir" hx-vals='{"entryId":"${active.id}","service":"${service}","stationId":"${station.id}"}' hx-target="#attention-content">${icon('repeat')} Repetir llamado</button>
          <button class="button button-danger-quiet" hx-post="/atencion/ausente" hx-vals='{"entryId":"${active.id}","service":"${service}","stationId":"${station.id}"}' hx-target="#attention-content" hx-confirm="¿Marcar ${escapeHtml(active.publicCode)} como ausente?">${icon('absent')} Marcar ausente</button>` : `
          <button class="button button-primary action-main" hx-post="/atencion/finalizar" hx-vals='{"entryId":"${active.id}","service":"${service}","stationId":"${station.id}"}' hx-target="#attention-content">${icon('check')} Finalizar atención</button>`}
      </div>` : `<div class="ready-to-call">
        <span class="ready-icon">${icon('attention')}</span>
        <div><h2>${stats.blocked && !stats.waiting ? 'En espera de Toma de muestras' : `${escapeHtml(station.name)} está disponible`}</h2><p>${queueDescription}</p></div>
        <button class="button button-primary call-next" hx-post="/atencion/llamar" hx-vals='{"service":"${service}","stationId":"${station.id}"}' hx-target="#attention-content" ${stats.waiting ? '' : 'disabled'}>${icon('attention')} Llamar siguiente</button>
      </div>`}
    </section>

    <div class="attention-lower">
      <section class="upcoming-section">
        <div class="section-heading inline-heading"><div><h2>Próximos</h2><p>Ordenados por prioridad y llegada</p></div><span class="queue-count">${stats.waiting} en espera${stats.blocked ? ` · ${stats.blocked} en Toma de muestras` : ''}</span></div>
        ${renderWaitingQueue(queue, stats.blocked)}
      </section>
      <aside class="attention-stats">
        <div class="mini-stat"><span>En espera</span><strong>${stats.waiting}</strong></div>
        <div class="mini-stat"><span>Atendidos hoy</span><strong>${stats.completed}</strong></div>
        <div class="operator-tip">${icon('users')}<strong>${escapeHtml(station.name)}</strong><p>Este puesto consume la cola compartida de ${serviceName}.</p></div>
      </aside>
    </div>`;
}

function renderWaitingQueue(queue, blocked = 0) {
  if (!queue.length && blocked) return `<div class="queue-empty is-blocked">${serviceIcon('lab')}<div><strong>Sin pacientes disponibles</strong><span>${blocked === 1 ? 'La persona continúa' : `${blocked} personas continúan`} en Toma de muestras. Rayos X se habilitará al finalizar.</span></div></div>`;
  if (!queue.length) return `<div class="queue-empty">${icon('check')}<div><strong>No hay personas esperando</strong><span>Los nuevos turnos aparecerán aquí automáticamente.</span></div></div>`;
  return `<div class="waiting-table" role="table" aria-label="Próximos turnos">
    <div class="waiting-row waiting-head" role="row"><span>Turno</span><span>Paciente</span><span>Espera</span><span>Prioridad</span></div>
    ${queue.map((row) => `<div class="waiting-row" role="row">
      <strong>${row.publicCode}</strong><span class="waiting-patient-name">${escapeHtml(row.patientName)}</span><span>${minutesWaiting(row.createdAt)} min</span>
      <span class="priority-label ${row.priority ? 'is-priority' : ''}"><i></i>${row.priority ? 'Prioritaria' : 'Regular'}</span>
    </div>`).join('')}
  </div>`;
}

export async function renderAttentionWorkspace(store, service = 'lab', stationId = null, message = null) {
  const safeService = service === 'xray' ? 'xray' : 'lab';
  const stations = await store.listStations(safeService);
  const station = stations.find((item) => item.id === Number(stationId)) || stations[0] || null;
  return `<section id="attention-workspace" hx-get="/atencion/puesto" hx-trigger="sse:stations-updated" hx-target="this" hx-swap="outerHTML" hx-include=".service-control">
    <header class="attention-header">
      <div class="page-title"><div><h1>Atención</h1><p>Llama y acompaña cada turno con claridad.</p></div></div>
    </header>
    <details class="station-picker" open>
      <summary>
        <span class="station-current">${icon('users')}<span><small>Estás atendiendo en</small><strong>${escapeHtml(station?.name || 'Sin puesto disponible')}</strong><span>${SERVICE_NAMES[safeService]}</span></span></span>
        <span class="station-picker-toggle"><span class="picker-closed-label">Cambiar puesto</span><span class="picker-open-label">Ocultar opciones</span>${icon('chevron')}</span>
      </summary>
      <form class="service-control">
        <input type="hidden" name="service" value="${safeService}">
        <input type="hidden" name="stationId" value="${station?.id || ''}">
        <fieldset class="station-choice-group"><legend>Servicio</legend>
          <div class="service-buttons">
            ${['lab', 'xray'].map((item) => `<button type="button" class="station-choice service-button" data-station-choice aria-pressed="${item === safeService}" hx-get="/atencion/puesto" hx-vals='${JSON.stringify({ service: item, stationId: '' })}' hx-target="#attention-workspace" hx-swap="outerHTML" hx-sync="#attention-workspace:replace">${serviceIcon(item)}<span>${SERVICE_NAMES[item]}</span><span class="choice-check">${icon('check')}</span></button>`).join('')}
          </div>
        </fieldset>
        <fieldset class="station-choice-group"><legend>Puesto <span>Elige con un toque</span></legend>
          <div class="station-buttons">
            ${stations.map((item) => `<button type="button" class="station-choice station-button" data-station-choice aria-pressed="${item.id === station?.id}" hx-get="/atencion/puesto" hx-vals='${JSON.stringify({ service: safeService, stationId: item.id })}' hx-target="#attention-workspace" hx-swap="outerHTML" hx-sync="#attention-workspace:replace"><span>${escapeHtml(item.name)}</span><span class="choice-check">${icon('check')}</span></button>`).join('')}
          </div>
        </fieldset>
        <p class="station-remember">${icon('check')}Recordaremos este puesto en este navegador.</p>
      </form>
    </details>
    <div id="attention-content" hx-get="/atencion/panel" hx-trigger="sse:queue-updated" hx-include=".service-control" hx-target="this" hx-swap="innerHTML">${await renderAttentionContent(store, safeService, station?.id, message)}</div>
  </section>`;
}

export async function attentionPage(store, service = 'lab', stationId = null) {
  const body = `<main id="contenido" class="page attention-page">
    ${await renderAttentionWorkspace(store, service, stationId)}
  </main>`;
  return layout({ title: 'Atención', active: 'attention', body });
}

function stationRow(station) {
  return `<div class="station-row ${station.active ? '' : 'is-inactive'}">
    <form class="station-name-form" hx-post="/configuracion/puestos/${station.id}" hx-target="#stations-panel" hx-swap="outerHTML">
      <span class="station-state" aria-label="${station.active ? 'Puesto activo' : 'Puesto inactivo'}"></span>
      <input name="name" maxlength="40" value="${escapeHtml(station.name)}" aria-label="Nombre del puesto">
      <button class="button button-secondary" type="submit">Guardar</button>
    </form>
    <form hx-post="/configuracion/puestos/${station.id}/estado" hx-target="#stations-panel" hx-swap="outerHTML">
      <input type="hidden" name="active" value="${station.active ? '0' : '1'}">
      <button class="text-button station-toggle" type="submit">${station.active ? 'Desactivar' : 'Activar'}</button>
    </form>
  </div>`;
}

export async function renderStationsPanel(store, message = null) {
  const groups = (await Promise.all(['lab', 'xray'].map(async (service) => {
    const stations = await store.listStations(service, { includeInactive: true });
    const activeCount = stations.filter((station) => station.active).length;
    return `<section class="station-group">
      <header><div>${serviceIcon(service)}<span><h2>${SERVICE_NAMES[service]}</h2><p>${service === 'lab' ? 'Todos los módulos comparten una sola cola.' : 'Puestos disponibles para llamados de Rayos X.'}</p></span></div><strong>${activeCount} ${activeCount === 1 ? 'activo' : 'activos'}</strong></header>
      <div class="station-list">${stations.map(stationRow).join('')}</div>
      <form class="station-create" hx-post="/configuracion/puestos" hx-target="#stations-panel" hx-swap="outerHTML">
        <input type="hidden" name="service" value="${service}">
        <label for="new-station-${service}">Agregar puesto</label>
        <div><input id="new-station-${service}" name="name" maxlength="40" placeholder="Ej. ${service === 'lab' ? 'Módulo 3' : 'Sala 2'}" required><button class="button button-primary" type="submit">Agregar</button></div>
      </form>
    </section>`;
  }))).join('');
  const alert = message ? `<div class="attention-alert ${message.type || ''}" role="status">${icon(message.type === 'error' ? 'info' : 'check')} ${escapeHtml(message.text)}</div>` : '';
  return `<div id="stations-panel">${alert}<div class="station-groups">${groups}</div></div>`;
}

export async function configurationPage(store) {
  const body = `<main id="contenido" class="page settings-page">
    <header class="page-title"><div><h1>Configuración</h1><p>Administra los puestos que atienden cada cola.</p></div></header>
    <div class="settings-explanation">${icon('info')}<p><strong>Una cola, varios puestos.</strong> Módulo 1 y Módulo 2 pueden llamar pacientes distintos al mismo tiempo. Al agregar otro módulo, queda disponible inmediatamente en Atención.</p></div>
    ${await renderStationsPanel(store)}
  </main>`;
  return layout({ title: 'Configuración', active: 'settings', body });
}

function callDestination(call) {
  const serviceName = SERVICE_NAMES[call.service];
  if (!call.stationName || call.stationName.toLocaleLowerCase('es') === serviceName.toLocaleLowerCase('es')) return serviceName;
  return `${call.stationName} · ${serviceName}`;
}

function spokenDestination(call) {
  const serviceName = SERVICE_NAMES[call.service];
  if (!call.stationName || call.stationName.toLocaleLowerCase('es') === serviceName.toLocaleLowerCase('es')) return serviceName;
  return `${serviceName}, ${call.stationName}`;
}

export async function renderDisplayContent(store) {
  const calls = await store.displayCalls();
  const unique = [];
  const seen = new Set();
  for (const call of calls) {
    if (!seen.has(call.publicCode)) {
      seen.add(call.publicCode);
      unique.push(call);
    }
  }
  const primary = unique[0];
  const secondary = unique[1];
  if (!primary) {
    return `<section class="display-empty"><span>${icon('display')}</span><h1>Pacientes llamados</h1><p>Los próximos llamados aparecerán aquí.</p></section>`;
  }
  return `<section class="display-content" data-current-announcement="${primary.eventId}" data-current-name="${escapeHtml(primary.patientName)}" data-current-service="${escapeHtml(spokenDestination(primary))}">
    <h1>Pacientes llamados</h1>
    <article class="display-call primary-call">
      <strong>${escapeHtml(primary.patientName)}</strong>
      <span>Dirigirse a ${escapeHtml(callDestination(primary))}</span>
    </article>
    ${secondary ? `<article class="display-call secondary-call"><strong>${escapeHtml(secondary.patientName)}</strong><span>Dirigirse a ${escapeHtml(callDestination(secondary))}</span></article>` : ''}
    <section class="recent-calls">
      <h2>Llamados recientes</h2>
      <div class="recent-call-rail">
        ${unique.slice(1, 5).map((call) => `<div><strong>${escapeHtml(call.patientName)}</strong><span>${escapeHtml(callDestination(call))}</span><time>${localTime(call.calledAt)}</time></div>`).join('')}
      </div>
    </section>
    <footer class="display-instruction">${icon('users')}<span>Espera a que tu nombre aparezca en pantalla</span></footer>
  </section>`;
}

export async function displayPage(store) {
  const body = `<main id="contenido" class="public-display"><div id="display-content" sse-swap="display-update">${await renderDisplayContent(store)}</div><div id="announcement-trigger" hidden sse-swap="turn-announced"></div></main>`;
  return layout({ title: 'Pantalla de turnos', active: 'display', body, publicDisplay: true });
}

function formatMinutes(value) {
  return Number.isFinite(value) ? `${value} min` : '—';
}

function renderAdminMetric({ iconName, label, value, unit = '', context }) {
  return `<article class="admin-metric">
    <span class="admin-metric-icon">${icon(iconName)}</span>
    <div><span>${label}</span><strong>${value}${unit ? `<small>${unit}</small>` : ''}</strong><p>${context}</p></div>
  </article>`;
}

function renderAdminChart(dashboard) {
  const maximum = Math.max(1, ...dashboard.timeline.map((item) => item.value));
  return `<section class="admin-chart" aria-labelledby="admin-chart-title">
    <header><div><h2 id="admin-chart-title">${dashboard.chartTitle}</h2><p>Atenciones finalizadas durante el periodo</p></div><strong>${dashboard.metrics.completed}</strong></header>
    <div class="admin-chart-plot" role="img" aria-label="${dashboard.chartTitle}: ${dashboard.metrics.completed} atenciones completadas">
      ${dashboard.timeline.map((item) => {
        const height = item.value ? Math.max(7, Math.round((item.value / maximum) * 100)) : 2;
        return `<div class="admin-chart-column" title="${escapeHtml(item.label)}: ${item.value}">
          <span class="admin-chart-value">${item.value || ''}</span>
          <i style="--bar-height:${height}%"></i>
          <small>${escapeHtml(item.shortLabel)}</small>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function renderAdminServices(dashboard) {
  return `<section class="admin-services" aria-labelledby="admin-services-title">
    <header><h2 id="admin-services-title">Rendimiento por servicio</h2><p>Volumen y tiempos del periodo</p></header>
    <div class="admin-service-head" aria-hidden="true"><span>Servicio</span><span>Completados</span><span>Espera prom.</span><span>Atención prom.</span><span>En espera</span></div>
    ${dashboard.serviceRows.map((row) => `<div class="admin-service-row">
      <div>${serviceIcon(row.service)}<strong>${escapeHtml(row.name)}</strong></div>
      <span data-label="Completados">${row.completed}</span>
      <span data-label="Espera prom.">${formatMinutes(row.averageWait)}</span>
      <span data-label="Atención prom.">${formatMinutes(row.averageAttention)}</span>
      <span class="admin-service-wait" data-label="En espera">${row.waiting}${row.blocked ? `<small>+${row.blocked} pendiente</small>` : ''}</span>
    </div>`).join('')}
  </section>`;
}

function renderAdminRecent(dashboard) {
  const statusLabels = { waiting: 'En espera', called: 'Llamado', attending: 'En atención', completed: 'Completado', absent: 'Ausente', cancelled: 'Cancelado' };
  if (!dashboard.recent.length) return `<div class="admin-empty">No hay actividad registrada en este periodo.</div>`;
  return `<div class="admin-table-wrap"><table class="admin-table">
    <thead><tr><th>Paciente</th><th>Servicio</th><th>Llegada</th><th>Espera</th><th>Atención</th><th>Estado</th></tr></thead>
    <tbody>${dashboard.recent.map((row) => `<tr>
      <td><strong>${escapeHtml(row.patientName)}</strong>${row.priority ? '<small>Atención prioritaria</small>' : ''}</td>
      <td>${escapeHtml(SERVICE_NAMES[row.service])}</td>
      <td><time>${localTime(row.createdAt)}</time></td>
      <td>${formatMinutes(row.waitMinutes)}</td>
      <td>${formatMinutes(row.attentionMinutes)}</td>
      <td><span class="admin-status admin-status-${row.status}"><i></i>${statusLabels[row.status] || row.status}</span></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderAdminStations(dashboard) {
  return `<section class="admin-stations" aria-labelledby="admin-stations-title">
    <header><div><h2 id="admin-stations-title">Desempeño por puesto</h2><p>Atenciones completadas y duración promedio</p></div></header>
    <div class="admin-station-list">
      ${dashboard.stationRows.map((station) => `<div class="admin-station-row ${station.active ? '' : 'is-inactive'}">
        <div>${serviceIcon(station.service)}<span><strong>${escapeHtml(station.name)}</strong><small>${escapeHtml(station.serviceName)}${station.active ? '' : ' · Inactivo'}</small></span></div>
        <span><small>Completadas</small><strong>${station.completed}</strong></span>
        <span><small>Atención promedio</small><strong>${formatMinutes(station.averageAttention)}</strong></span>
      </div>`).join('')}
    </div>
  </section>`;
}

export function adminLoginPage({ error = '' } = {}) {
  const body = `<main id="contenido" class="admin-login-main">
    <section class="admin-login-panel" aria-labelledby="admin-login-title">
      <span class="admin-login-icon">${icon('shield')}</span>
      <h1 id="admin-login-title">Acceso administrativo</h1>
      <p>Ingresa la contraseña para consultar el resumen operativo.</p>
      <form class="admin-login-form" method="post" action="/admin/login">
        <label for="admin-password">Contraseña</label>
        <div class="admin-password-control">
          <input id="admin-password" name="password" type="password" autocomplete="current-password" required autofocus ${error ? 'aria-describedby="admin-login-error"' : ''}>
          <button type="button" data-password-toggle aria-label="Mostrar contraseña" aria-pressed="false">${icon('eye')}</button>
        </div>
        ${error ? `<div id="admin-login-error" class="admin-login-error" role="alert">${icon('info')}<span>${escapeHtml(error)}</span></div>` : ''}
        <button class="button button-primary admin-login-submit" type="submit">Ingresar</button>
      </form>
      <a class="admin-back-link" href="/recepcion">← Volver a recepción</a>
    </section>
  </main>`;
  return layout({ title: 'Acceso administrativo', active: '', body, adminState: 'login' });
}

export function adminDashboardPage(dashboard) {
  const metricContext = dashboard.metrics.priorityCompleted
    ? `${dashboard.metrics.priorityCompleted} prioritarias completadas`
    : 'Atenciones finalizadas en el periodo';
  const waitContext = Number.isFinite(dashboard.metrics.maxWait)
    ? `Mayor espera registrada: ${dashboard.metrics.maxWait} min`
    : 'Sin atenciones finalizadas en el periodo';
  const updatedTime = localTime(dashboard.updatedAt);
  const body = `<main id="contenido" class="page admin-page">
    <header class="admin-page-header">
      <div><h1>Resumen operativo</h1><p>${escapeHtml(dashboard.periodLabel)} · Actualizado a las ${updatedTime}</p></div>
      <nav class="admin-period" aria-label="Periodo del resumen">
        <a href="/admin?period=today" ${dashboard.periodKey === 'today' ? 'aria-current="page"' : ''}>Hoy</a>
        <a href="/admin?period=7d" ${dashboard.periodKey === '7d' ? 'aria-current="page"' : ''}>7 días</a>
        <a href="/admin?period=30d" ${dashboard.periodKey === '30d' ? 'aria-current="page"' : ''}>30 días</a>
      </nav>
    </header>

    <section class="admin-metrics" aria-label="Indicadores principales">
      ${renderAdminMetric({ iconName: 'chart', label: 'Atenciones completadas', value: dashboard.metrics.completed, context: metricContext })}
      ${renderAdminMetric({ iconName: 'clock', label: 'Espera promedio', value: dashboard.metrics.averageWait ?? '—', unit: Number.isFinite(dashboard.metrics.averageWait) ? ' min' : '', context: waitContext })}
      ${renderAdminMetric({ iconName: 'stopwatch', label: 'Atención promedio', value: dashboard.metrics.averageAttention ?? '—', unit: Number.isFinite(dashboard.metrics.averageAttention) ? ' min' : '', context: 'Desde el inicio hasta la finalización' })}
      ${renderAdminMetric({ iconName: 'absent', label: 'Ausencias', value: dashboard.metrics.absent, context: 'Pacientes llamados que no se presentaron' })}
    </section>

    <div class="admin-analysis-grid">
      ${renderAdminChart(dashboard)}
      ${renderAdminServices(dashboard)}
    </div>

    <section class="admin-state-rail" aria-labelledby="admin-state-title">
      <h2 id="admin-state-title">Estado actual</h2>
      <div><span class="state-waiting">${icon('clock')}</span><p><small>En espera</small><strong>${dashboard.states.waiting}</strong></p></div>
      <div><span class="state-active">${icon('reception')}</span><p><small>En atención</small><strong>${dashboard.states.active}</strong></p></div>
      <div><span class="state-completed">${icon('check')}</span><p><small>Completados</small><strong>${dashboard.states.completed}</strong></p></div>
      <div><span class="state-absent">${icon('absent')}</span><p><small>Ausentes</small><strong>${dashboard.states.absent}</strong></p></div>
    </section>

    <section class="admin-activity" aria-labelledby="admin-activity-title">
      <header><div><h2 id="admin-activity-title">Actividad reciente</h2><p>Últimos movimientos registrados en el periodo</p></div></header>
      ${renderAdminRecent(dashboard)}
    </section>
    ${renderAdminStations(dashboard)}
  </main>`;
  return layout({ title: 'Resumen operativo', active: 'admin', body, adminState: 'authenticated' });
}

export function notFoundPage() {
  const body = `<main id="contenido" class="page not-found"><h1>Página no encontrada</h1><p>La dirección que buscas no existe.</p><a class="button button-primary" href="/recepcion">Volver a recepción</a></main>`;
  return layout({ title: 'No encontrada', active: '', body });
}
