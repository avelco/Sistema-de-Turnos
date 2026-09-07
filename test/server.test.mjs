import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/server.mjs';

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' };

test('Fastify expone salud y las cuatro superficies principales', async () => {
  const application = createApplication({ dbPath: ':memory:', seed: false });
  try {
    const health = await application.server.inject({ method: 'GET', url: '/salud' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok', service: 'sistema-de-turnos' });
    const stylesheet = await application.server.inject({ method: 'GET', url: '/styles.css' });
    assert.equal(stylesheet.statusCode, 200);
    assert.match(stylesheet.headers['content-type'], /text\/css/);
    const javascript = await application.server.inject({ method: 'GET', url: '/app.js' });
    assert.equal(javascript.statusCode, 200);
    assert.match(javascript.body, /second: '2-digit'/);
    assert.match(javascript.body, /hour12: true/);
    assert.match(javascript.body, /setInterval\(updateClock, 1000\)/);
    assert.match(javascript.body, /event\.target\.id === 'display-content'/);

    for (const [url, expected] of [
      ['/recepcion', 'Recepción'],
      ['/atencion', 'Módulo 1'],
      ['/pantalla', 'Pacientes llamados'],
      ['/configuracion', 'Una cola, varios puestos']
    ]) {
      const response = await application.server.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200);
      assert.match(response.body, new RegExp(expected));
      if (url === '/pantalla') {
        assert.match(response.body, />--:--:-- --<\/time>/);
        assert.match(response.body, /data-audio-activate/);
      }
      if (url === '/atencion') assert.match(response.body, /id="attention-content"[^>]+hx-target="this"[^>]+hx-swap="innerHTML"/);
    }
  } finally {
    await application.close();
  }
});

test('dos módulos llaman pacientes distintos mediante las rutas HTTP', async () => {
  const application = createApplication({ dbPath: ':memory:', seed: false });
  try {
    const [moduleOne, moduleTwo] = application.store.listStations('lab');
    application.store.createVisit({ name: 'Paciente Primero', services: ['lab'] });
    application.store.createVisit({ name: 'Paciente Segundo', services: ['lab'] });

    const first = await application.server.inject({
      method: 'POST',
      url: '/atencion/llamar',
      headers: formHeaders,
      payload: `service=lab&stationId=${moduleOne.id}`
    });
    const second = await application.server.inject({
      method: 'POST',
      url: '/atencion/llamar',
      headers: formHeaders,
      payload: `service=lab&stationId=${moduleTwo.id}`
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.match(first.body, /Módulo 1/);
    assert.match(second.body, /Módulo 2/);
    assert.notEqual(application.store.getActive('lab', moduleOne.id).id, application.store.getActive('lab', moduleTwo.id).id);

    const display = await application.server.inject({ method: 'GET', url: '/pantalla' });
    assert.match(display.body, /Módulo 1 · Toma de muestras/);
    assert.match(display.body, /Módulo 2 · Toma de muestras/);
  } finally {
    await application.close();
  }
});

test('configuración agrega un módulo disponible inmediatamente en Atención', async () => {
  const application = createApplication({ dbPath: ':memory:', seed: false });
  try {
    const response = await application.server.inject({
      method: 'POST',
      url: '/configuracion/puestos',
      headers: formHeaders,
      payload: 'service=lab&name=M%C3%B3dulo%203'
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Módulo 3 fue agregado/);

    const workspace = await application.server.inject({ method: 'GET', url: '/atencion?service=lab' });
    assert.match(workspace.body, /Módulo 3/);
    assert.equal(application.store.listStations('lab').length, 3);
  } finally {
    await application.close();
  }
});

test('el dashboard administrativo exige contraseña, crea sesión y permite cerrarla', async () => {
  const application = createApplication({ dbPath: ':memory:', seed: false, adminPassword: 'secreta' });
  try {
    const loginPage = await application.server.inject({ method: 'GET', url: '/admin' });
    assert.equal(loginPage.statusCode, 200);
    assert.match(loginPage.body, /Acceso administrativo/);
    assert.doesNotMatch(loginPage.body, /Rendimiento por servicio/);

    const rejected = await application.server.inject({
      method: 'POST',
      url: '/admin/login',
      headers: formHeaders,
      payload: 'password=incorrecta'
    });
    assert.equal(rejected.statusCode, 401);
    assert.match(rejected.body, /contraseña no es correcta/);

    const accepted = await application.server.inject({
      method: 'POST',
      url: '/admin/login',
      headers: formHeaders,
      payload: 'password=secreta'
    });
    assert.equal(accepted.statusCode, 302);
    assert.equal(accepted.headers.location, '/admin');
    assert.match(accepted.headers['set-cookie'], /HttpOnly/);
    assert.match(accepted.headers['set-cookie'], /SameSite=Strict/);
    const cookie = accepted.headers['set-cookie'].split(';')[0];

    const dashboard = await application.server.inject({ method: 'GET', url: '/admin?period=7d', headers: { cookie } });
    assert.equal(dashboard.statusCode, 200);
    assert.match(dashboard.body, /Resumen operativo/);
    assert.match(dashboard.body, /Rendimiento por servicio/);
    assert.match(dashboard.body, /Atenciones por día/);

    const logout = await application.server.inject({ method: 'POST', url: '/admin/logout', headers: { cookie } });
    assert.equal(logout.statusCode, 302);
    assert.match(logout.headers['set-cookie'], /Max-Age=0/);
    const afterLogout = await application.server.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    assert.match(afterLogout.body, /Acceso administrativo/);
  } finally {
    await application.close();
  }
});
