import Fastify from 'fastify';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './db.mjs';
import {
  adminDashboardPage,
  adminLoginPage,
  attentionPage,
  configurationPage,
  displayPage,
  notFoundPage,
  receptionPage,
  renderAttentionContent,
  renderAttentionWorkspace,
  renderDisplayContent,
  renderQueueSummary,
  renderRecentArrivals,
  renderRegistrationPanel,
  renderStationsPanel
} from './views.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DEFAULT_DB = join(ROOT, 'data', 'turnos.db');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function cleanService(value) {
  return value === 'xray' ? 'xray' : 'lab';
}

function selectedStation(store, service, value) {
  const stations = store.listStations(service);
  return stations.find((station) => station.id === Number(value)) || stations[0] || null;
}

function html(reply, content, status = 200) {
  return reply
    .code(status)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'same-origin')
    .send(content);
}

function sendStatic(pathname, reply) {
  const relative = normalize(pathname).replace(/^[/\\]+/, '');
  const filePath = join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  try {
    if (!statSync(filePath).isFile()) return false;
    reply
      .type(MIME_TYPES[extname(filePath)] || 'application/octet-stream')
      .header('Cache-Control', pathname.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('X-Content-Type-Options', 'nosniff')
      .send(readFileSync(filePath));
    return true;
  } catch {
    return false;
  }
}

function formatSse(event, data, id) {
  const lines = String(data).split(/\r?\n/).map((line) => `data: ${line}`).join('\n');
  return `id: ${id}\nevent: ${event}\n${lines}\n\n`;
}

function cookiesFrom(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    const name = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    try {
      return [name, decodeURIComponent(rawValue)];
    } catch {
      return [name, ''];
    }
  }).filter(([name]) => name));
}

export function createApplication({
  dbPath = process.env.TURNO_DB || DEFAULT_DB,
  seed = true,
  logger = false,
  adminPassword = process.env.ADMIN_PASSWORD || 'admin'
} = {}) {
  const server = Fastify({ logger, bodyLimit: 64 * 1024 });
  const store = createStore(dbPath);
  if (seed) store.seed();
  const clients = new Set();
  let eventId = 0;
  let storeClosed = false;
  const adminSessions = new Map();
  const loginAttempts = new Map();
  const adminSalt = randomBytes(16);
  const adminPasswordHash = scryptSync(String(adminPassword), adminSalt, 32);
  const adminSessionDuration = 8 * 60 * 60 * 1000;

  function passwordMatches(candidate) {
    const value = String(candidate || '');
    if (value.length > 256) return false;
    const candidateHash = scryptSync(value, adminSalt, 32);
    return timingSafeEqual(candidateHash, adminPasswordHash);
  }

  function activeAdminSession(request) {
    const token = cookiesFrom(request).turnos_admin_session;
    if (!token) return false;
    const expiresAt = adminSessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
      adminSessions.delete(token);
      return false;
    }
    return true;
  }

  function setAdminCookie(request, reply, token, maxAge = adminSessionDuration / 1000) {
    const secure = request.protocol === 'https' ? '; Secure' : '';
    reply.header('Set-Cookie', `turnos_admin_session=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
  }

  server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body)));
    } catch (error) {
      done(error);
    }
  });

  function broadcast(event, data) {
    eventId += 1;
    const packet = formatSse(event, data, eventId);
    for (const client of clients) {
      try {
        client.write(packet);
      } catch {
        clients.delete(client);
      }
    }
  }

  function broadcastState({ announce = false } = {}) {
    broadcast('queue-summary', renderQueueSummary(store.queueSummary()));
    broadcast('recent-arrivals', renderRecentArrivals(store.recentArrivals()));
    broadcast('queue-updated', 'refresh');
    broadcast('display-update', renderDisplayContent(store));
    if (announce) broadcast('turn-announced', 'announce');
  }

  function broadcastStations() {
    broadcast('stations-updated', 'refresh');
  }

  server.get('/styles.css', (request, reply) => {
    if (!sendStatic('/styles.css', reply)) return html(reply, notFoundPage(), 404);
    return reply;
  });
  server.get('/app.js', (request, reply) => {
    if (!sendStatic('/app.js', reply)) return html(reply, notFoundPage(), 404);
    return reply;
  });
  server.get('/vendor/:file', (request, reply) => {
    const file = String(request.params.file || '');
    if (!/^[a-z0-9.-]+$/i.test(file) || !sendStatic(`/vendor/${file}`, reply)) {
      return html(reply, notFoundPage(), 404);
    }
    return reply;
  });

  server.get('/salud', () => ({ status: 'ok', service: 'sistema-de-turnos' }));
  server.get('/', (request, reply) => reply.redirect('/recepcion'));
  server.get('/recepcion', (request, reply) => html(reply, receptionPage(store)));
  server.get('/atencion', (request, reply) => {
    const service = cleanService(request.query?.service);
    const station = selectedStation(store, service, request.query?.stationId);
    return html(reply, attentionPage(store, service, station?.id));
  });
  server.get('/pantalla', (request, reply) => html(reply, displayPage(store)));
  server.get('/configuracion', (request, reply) => html(reply, configurationPage(store)));
  server.get('/admin', (request, reply) => {
    if (!activeAdminSession(request)) return html(reply, adminLoginPage());
    const period = ['today', '7d', '30d'].includes(request.query?.period) ? request.query.period : 'today';
    return html(reply, adminDashboardPage(store.adminDashboard(period)));
  });

  server.post('/admin/login', (request, reply) => {
    const key = request.ip || 'local';
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (attempt?.blockedUntil > now) {
      const seconds = Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
      return html(reply, adminLoginPage({ error: `Demasiados intentos. Espera ${seconds} segundos antes de volver a intentar.` }), 429);
    }
    if (!passwordMatches(request.body?.password)) {
      const count = (attempt?.count || 0) + 1;
      loginAttempts.set(key, count >= 5 ? { count: 0, blockedUntil: now + 60_000 } : { count, blockedUntil: 0 });
      return html(reply, adminLoginPage({ error: 'La contraseña no es correcta.' }), 401);
    }
    loginAttempts.delete(key);
    const token = randomBytes(32).toString('base64url');
    adminSessions.set(token, now + adminSessionDuration);
    setAdminCookie(request, reply, token);
    return reply.redirect('/admin');
  });

  server.post('/admin/logout', (request, reply) => {
    const token = cookiesFrom(request).turnos_admin_session;
    if (token) adminSessions.delete(token);
    setAdminCookie(request, reply, '', 0);
    return reply.redirect('/admin');
  });

  server.get('/recepcion/formulario', (request, reply) => html(reply, renderRegistrationPanel()));
  server.get('/atencion/puesto', (request, reply) => {
    const service = cleanService(request.query?.service);
    const station = selectedStation(store, service, request.query?.stationId);
    return html(reply, renderAttentionWorkspace(store, service, station?.id));
  });
  server.get('/atencion/panel', (request, reply) => {
    const service = cleanService(request.query?.service);
    const station = selectedStation(store, service, request.query?.stationId);
    return html(reply, renderAttentionContent(store, service, station?.id));
  });

  server.get('/eventos', (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.write('retry: 2500\n: conexión establecida\n\n');
    clients.add(response);
    const heartbeat = setInterval(() => response.write(': pulso\n\n'), 20000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(response);
    });
    return reply;
  });

  server.post('/turnos', (request, reply) => {
    const values = {
      name: request.body?.name || '',
      service: request.body?.service || '',
      priority: request.body?.priority || ''
    };
    const errors = {};
    if (String(values.name).trim().length < 3) errors.name = 'Escribe el nombre completo.';
    if (!['lab', 'xray', 'both'].includes(values.service)) errors.service = 'Selecciona un servicio.';
    if (Object.keys(errors).length) return html(reply, renderRegistrationPanel({ values, errors }));

    try {
      const services = values.service === 'both' ? ['lab', 'xray'] : [values.service];
      const created = store.createVisit({ name: values.name, services, priority: values.priority === '1' });
      html(reply, renderRegistrationPanel({ created }));
      broadcastState();
      return reply;
    } catch (error) {
      return html(reply, renderRegistrationPanel({ values, errors: { form: error.message } }));
    }
  });

  const attentionRoutes = {
    '/atencion/llamar': ({ service, station }) => store.callNext(service, station.id),
    '/atencion/repetir': ({ body, station }) => store.repeatCall(Number(body.entryId), station.id),
    '/atencion/iniciar': ({ body, station }) => store.startAttention(Number(body.entryId), station.id),
    '/atencion/finalizar': ({ body, station }) => store.completeAttention(Number(body.entryId), station.id),
    '/atencion/ausente': ({ body, station }) => store.markAbsent(Number(body.entryId), station.id)
  };

  for (const [pathname, action] of Object.entries(attentionRoutes)) {
    server.post(pathname, (request, reply) => {
      const body = request.body || {};
      const service = cleanService(body.service);
      const station = selectedStation(store, service, body.stationId);
      try {
        if (!station) throw new Error('No hay puestos activos para este servicio.');
        const result = action({ body, service, station });
        const announce = pathname === '/atencion/llamar' || pathname === '/atencion/repetir';
        const text = pathname === '/atencion/llamar' ? `Paciente llamado a ${station.name}.` :
          pathname === '/atencion/repetir' ? `Llamado repetido para ${station.name}.` :
          pathname === '/atencion/iniciar' ? `Atención iniciada en ${station.name}.` :
          pathname === '/atencion/finalizar' && result.released ? 'Atención finalizada. El turno de Rayos X ya está disponible.' :
          pathname === '/atencion/finalizar' ? 'Atención finalizada. Ya puedes llamar al siguiente.' :
          result.cancelled ? 'Turno marcado como ausente. Su turno pendiente de Rayos X fue cancelado.' :
          'Turno marcado como ausente.';
        html(reply, renderAttentionContent(store, service, station.id, { type: 'success', text }));
        broadcastState({ announce });
        return reply;
      } catch (error) {
        return html(reply, renderAttentionContent(store, service, station?.id, { type: 'error', text: error.message }));
      }
    });
  }

  server.post('/configuracion/puestos', (request, reply) => {
    try {
      const service = cleanService(request.body?.service);
      const station = store.createStation(service, request.body?.name);
      html(reply, renderStationsPanel(store, { type: 'success', text: `${station.name} fue agregado.` }));
      broadcastStations();
      return reply;
    } catch (error) {
      return html(reply, renderStationsPanel(store, { type: 'error', text: error.message }));
    }
  });

  server.post('/configuracion/puestos/:id', (request, reply) => {
    try {
      const station = store.renameStation(Number(request.params.id), request.body?.name);
      html(reply, renderStationsPanel(store, { type: 'success', text: `Puesto actualizado: ${station.name}.` }));
      broadcastStations();
      return reply;
    } catch (error) {
      return html(reply, renderStationsPanel(store, { type: 'error', text: error.message }));
    }
  });

  server.post('/configuracion/puestos/:id/estado', (request, reply) => {
    try {
      const station = store.setStationActive(Number(request.params.id), request.body?.active === '1');
      html(reply, renderStationsPanel(store, { type: 'success', text: `${station.name} quedó ${station.active ? 'activo' : 'inactivo'}.` }));
      broadcastStations();
      return reply;
    } catch (error) {
      return html(reply, renderStationsPanel(store, { type: 'error', text: error.message }));
    }
  });

  server.setNotFoundHandler((request, reply) => html(reply, notFoundPage(), 404));
  server.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (!reply.sent) html(reply, '<h1>Error interno</h1><p>Inténtalo de nuevo.</p>', 500);
  });

  server.addHook('preClose', async () => {
    for (const client of clients) client.end();
    clients.clear();
  });
  server.addHook('onClose', async () => {
    if (!storeClosed) {
      store.close();
      storeClosed = true;
    }
  });

  return { server, store, close: () => server.close(), broadcastState, broadcastStations };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const application = createApplication({ logger: true });
  try {
    await application.server.listen({ port, host });
    console.log(`Lab. María Eugenia Tamayo Giraldo disponible en http://${host}:${port}`);
  } catch (error) {
    application.server.log.error(error);
    process.exit(1);
  }
  const shutdown = async () => {
    await application.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
