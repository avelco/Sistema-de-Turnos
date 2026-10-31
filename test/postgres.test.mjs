import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApplication } from '../src/server.mjs';

// Run only against an explicitly configured PostgreSQL server. All fixtures live
// in a unique temporary schema; public/production tables are never modified.
test('PostgreSQL: persistencia, concurrencia, rollback y rutas HTTP', { skip: process.env.TEST_POSTGRES !== '1' }, async () => {
  const schema = `turnero_test_${Date.now()}_${process.pid}`;
  const connection = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_DATABASE, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
  await connection.connect();
  const originalOptions = process.env.PGOPTIONS;
  let application;
  try {
    await connection.query(`CREATE SCHEMA "${schema}"`);
    process.env.PGOPTIONS = `-c search_path=${schema}`;
    application = await createApplication({ seed: false, logger: true, adminPassword: process.env.ADMIN_PASSWORD || 'test-password' });
    const store = application.store;
    const [one, two] = await store.listStations('lab');
    const [xray] = await store.listStations('xray');
    await Promise.all([
      store.createVisit({ name: 'Prueba Regular', services: ['lab'] }),
      store.createVisit({ name: 'Prueba Prioritaria', services: ['lab', 'xray'], priority: true })
    ]);
    const calls = await Promise.all([store.callNext('lab', one.id), store.callNext('lab', two.id)]);
    assert.notEqual(calls[0].id, calls[1].id);
    assert.equal(calls[0].patientName, 'Prueba Prioritaria');
    await assert.rejects(() => store.callNext('lab', one.id), /Finaliza/);
    await assert.rejects(() => store.callNext('xray', xray.id), /No hay turnos/);
    await store.startAttention(calls[0].id, one.id);
    assert.equal((await store.completeAttention(calls[0].id, one.id)).released, 1);
    const xr = await store.callNext('xray', xray.id);
    await store.repeatCall(xr.id, xray.id);
    await store.startAttention(xr.id, xray.id);
    await store.completeAttention(xr.id, xray.id);
    await store.markAbsent(calls[1].id, two.id);
    const dashboard = await store.adminDashboard();
    assert.equal(dashboard.metrics.completed, 2);
    assert.equal(dashboard.metrics.absent, 1);
    await assert.rejects(() => store.createStation('lab', 'módulo 1'), /Ya existe/);
    assert.equal((await store.listStations('lab')).length, 2);
    const module = await store.createStation('lab', 'Prueba módulo');
    await store.renameStation(module.id, 'Prueba renombrado');
    await store.setStationActive(module.id, false);
    for (const url of ['/salud', '/recepcion', '/atencion', '/pantalla', '/configuracion', '/admin']) {
      const response = await application.server.inject({ url });
      assert.equal(response.statusCode, 200, url);
      assert.doesNotMatch(response.body, /\[object Promise\]/);
    }
    const login = await application.server.inject({ method: 'POST', url: '/admin/login', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https' }, payload: new URLSearchParams({ password: process.env.ADMIN_PASSWORD || 'test-password' }).toString() });
    assert.equal(login.statusCode, 302);
    assert.match(login.headers['set-cookie'], /; Secure/);
    const admin = await application.server.inject({ url: '/admin', headers: { cookie: login.headers['set-cookie'].split(';')[0] } });
    assert.equal(admin.statusCode, 200);
    assert.match(admin.body, /Atenciones/);
    await application.close();
    application = await createApplication({ seed: false });
    assert.equal((await application.store.adminDashboard()).metrics.completed, 2);
  } finally {
    if (application) await application.close();
    if (originalOptions === undefined) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = originalOptions;
    await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await connection.end();
  }
});
