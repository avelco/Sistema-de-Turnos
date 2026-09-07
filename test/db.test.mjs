import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.mjs';
import { renderDisplayContent } from '../src/views.mjs';

test('crea un turno para cada servicio y conserva el nombre del paciente', () => {
  const store = createStore(':memory:');
  try {
    const created = store.createVisit({
      name: 'Laura Gómez',
      services: ['lab', 'xray'],
      priority: true
    });

    assert.deepEqual(created.entries.map((entry) => entry.publicCode), ['LAB-001', 'RX-001']);
    assert.equal(store.recentArrivals(1)[0].patientName, 'Laura Gómez');
    assert.equal(store.queueSummary().lab.waiting, 1);
    assert.equal(store.queueSummary().xray.waiting, 0);
    assert.equal(store.queueSummary().xray.blocked, 1);
  } finally {
    store.close();
  }
});

test('llama primero la prioridad y evita dos turnos activos simultáneos', () => {
  const store = createStore(':memory:');
  try {
    const [station] = store.listStations('lab');
    store.createVisit({ name: 'Persona Regular', services: ['lab'] });
    store.createVisit({ name: 'Persona Prioritaria', services: ['lab'], priority: true });

    const called = store.callNext('lab', station.id);
    assert.equal(called.publicCode, 'LAB-002');
    assert.equal(called.stationName, 'Módulo 1');
    assert.match(renderDisplayContent(store), /Dirigirse a Módulo 1 · Toma de muestras/);
    assert.throws(() => store.callNext('lab', station.id), /Finaliza o marca como ausente/);
    assert.equal(store.getActive('lab', station.id).patientName, 'Persona Prioritaria');
  } finally {
    store.close();
  }
});

test('completa el ciclo llamado, atención y finalización', () => {
  const store = createStore(':memory:');
  try {
    const [station] = store.listStations('xray');
    store.createVisit({ name: 'Paciente Ejemplo', services: ['xray'] });
    const called = store.callNext('xray', station.id);
    const display = renderDisplayContent(store);
    assert.match(display, /Paciente Ejemplo/);
    assert.doesNotMatch(display, /RX-001/);
    store.repeatCall(called.id, station.id);
    store.startAttention(called.id, station.id);
    assert.equal(store.getActive('xray', station.id).status, 'attending');
    store.completeAttention(called.id, station.id);
    assert.equal(store.getActive('xray', station.id), null);
    assert.equal(store.serviceStats('xray').completed, 1);
  } finally {
    store.close();
  }
});

test('bloquea Rayos X hasta finalizar Toma de muestras en un turno doble', () => {
  const store = createStore(':memory:');
  try {
    const [sampleStation] = store.listStations('lab');
    const [xrayStation] = store.listStations('xray');
    store.createVisit({ name: 'Paciente Secuencial', services: ['lab', 'xray'], priority: true });

    assert.deepEqual(store.serviceStats('xray'), { waiting: 0, blocked: 1, completed: 0 });
    assert.throws(() => store.callNext('xray', xrayStation.id), /No hay turnos pendientes/);

    const laboratory = store.callNext('lab', sampleStation.id);
    store.startAttention(laboratory.id, sampleStation.id);
    const completed = store.completeAttention(laboratory.id, sampleStation.id);

    assert.equal(completed.released, 1);
    assert.deepEqual(store.serviceStats('xray'), { waiting: 1, blocked: 0, completed: 0 });
    assert.equal(store.callNext('xray', xrayStation.id).publicCode, 'RX-001');
  } finally {
    store.close();
  }
});

test('cancela Rayos X si el turno doble queda ausente en Toma de muestras', () => {
  const store = createStore(':memory:');
  try {
    const [station] = store.listStations('lab');
    store.createVisit({ name: 'Paciente Ausente', services: ['lab', 'xray'] });
    const laboratory = store.callNext('lab', station.id);
    const absent = store.markAbsent(laboratory.id, station.id);
    const xray = store.db.prepare("SELECT status, available FROM queue_entries WHERE service = 'xray'").get();

    assert.equal(absent.cancelled, 1);
    assert.equal(xray.status, 'cancelled');
    assert.equal(xray.available, 0);
  } finally {
    store.close();
  }
});

test('dos módulos de Toma de muestras atienden la misma cola en paralelo', () => {
  const store = createStore(':memory:');
  try {
    const [moduleOne, moduleTwo] = store.listStations('lab');
    store.createVisit({ name: 'Paciente Uno', services: ['lab'] });
    store.createVisit({ name: 'Paciente Dos', services: ['lab'] });
    store.createVisit({ name: 'Paciente Tres', services: ['lab'] });

    const first = store.callNext('lab', moduleOne.id);
    const second = store.callNext('lab', moduleTwo.id);

    assert.notEqual(first.id, second.id);
    assert.equal(store.getActive('lab', moduleOne.id).stationName, 'Módulo 1');
    assert.equal(store.getActive('lab', moduleTwo.id).stationName, 'Módulo 2');
    assert.equal(store.serviceStats('lab').waiting, 1);
    assert.throws(() => store.callNext('lab', moduleOne.id), /Módulo 1/);
    assert.throws(() => store.startAttention(first.id, moduleTwo.id), /otro puesto/);
  } finally {
    store.close();
  }
});

test('mantiene al menos un puesto activo por servicio', () => {
  const store = createStore(':memory:');
  try {
    const [moduleOne, moduleTwo] = store.listStations('lab');
    store.setStationActive(moduleTwo.id, false);
    assert.throws(() => store.setStationActive(moduleOne.id, false), /al menos un puesto activo/);
  } finally {
    store.close();
  }
});

test('permite agregar módulos y protege los puestos activos', () => {
  const store = createStore(':memory:');
  try {
    const third = store.createStation('lab', 'Módulo 3');
    assert.equal(third.name, 'Módulo 3');
    assert.equal(store.listStations('lab').length, 3);

    store.createVisit({ name: 'Paciente Nuevo', services: ['lab'] });
    const called = store.callNext('lab', third.id);
    assert.equal(called.stationId, third.id);
    assert.throws(() => store.setStationActive(third.id, false), /Finaliza el turno activo/);

    store.markAbsent(called.id, third.id);
    assert.equal(store.setStationActive(third.id, false).active, false);
    assert.equal(store.setStationActive(third.id, true).active, true);
    assert.equal(store.renameStation(third.id, 'Módulo pediátrico').name, 'Módulo pediátrico');
  } finally {
    store.close();
  }
});

test('rechaza datos incompletos', () => {
  const store = createStore(':memory:');
  try {
    assert.throws(() => store.createVisit({ name: 'A', services: [] }), /nombre completo/);
  } finally {
    store.close();
  }
});

test('migra bases anteriores y conserva los pacientes sin el documento', () => {
  const directory = mkdtempSync(join(tmpdir(), 'turnos-migration-'));
  const dbPath = join(directory, 'legacy.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      document TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE queue_entries (
      id INTEGER PRIMARY KEY,
      visit_id INTEGER NOT NULL REFERENCES visits(id),
      service TEXT NOT NULL CHECK (service IN ('lab', 'xray')),
      sequence INTEGER NOT NULL,
      public_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'called', 'attending', 'completed', 'absent', 'cancelled')),
      station TEXT,
      created_at TEXT NOT NULL,
      called_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(service, sequence)
    );
    CREATE TABLE call_events (
      id INTEGER PRIMARY KEY,
      queue_entry_id INTEGER NOT NULL REFERENCES queue_entries(id),
      action TEXT NOT NULL CHECK (action IN ('called', 'repeated', 'started', 'completed', 'absent')),
      station TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO patients(document, name, created_at)
      VALUES ('12345678', 'Paciente Existente', '2026-01-01T00:00:00.000Z');
    INSERT INTO visits(id, patient_id, priority, created_at)
      VALUES (1, 1, 0, '2026-01-01T00:00:00.000Z');
    INSERT INTO queue_entries(
      id, visit_id, service, sequence, public_code, status, station, created_at, called_at
    ) VALUES (
      1, 1, 'lab', 1, 'LAB-001', 'called', 'Módulo 2',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'
    );
    INSERT INTO call_events(id, queue_entry_id, action, station, created_at)
      VALUES (1, 1, 'called', 'Módulo 2', '2026-01-01T00:01:00.000Z');
  `);
  legacy.close();

  let store;
  try {
    store = createStore(dbPath);
    const columns = store.db.prepare('PRAGMA table_info(patients)').all().map((column) => column.name);
    const queueColumns = store.db.prepare('PRAGMA table_info(queue_entries)').all().map((column) => column.name);
    const eventColumns = store.db.prepare('PRAGMA table_info(call_events)').all().map((column) => column.name);
    assert.equal(columns.includes('document'), false);
    assert.equal(queueColumns.includes('available'), true);
    assert.equal(queueColumns.includes('station'), false);
    assert.equal(queueColumns.includes('station_id'), true);
    assert.equal(eventColumns.includes('station'), false);
    assert.equal(store.db.prepare('SELECT name FROM patients WHERE id = 1').get().name, 'Paciente Existente');
    assert.equal(store.displayCalls(1)[0].publicCode, 'LAB-001');
    assert.equal(store.displayCalls(1)[0].patientName, 'Paciente Existente');
    assert.equal(store.displayCalls(1)[0].stationName, 'Módulo 2');
    assert.equal(store.createVisit({ name: 'Paciente Nuevo', services: ['xray'] }).entries[0].publicCode, 'RX-001');
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('calcula métricas administrativas reales por periodo, servicio y puesto', () => {
  const store = createStore(':memory:');
  try {
    const [labStation] = store.listStations('lab');
    const [xrayStation] = store.listStations('xray');
    const laboratory = store.createVisit({ name: 'Paciente Laboratorio', services: ['lab'], priority: true }).entries[0];
    const xray = store.createVisit({ name: 'Paciente Rayos X', services: ['xray'] }).entries[0];
    const absent = store.createVisit({ name: 'Paciente Ausente', services: ['lab'] }).entries[0];
    const waiting = store.createVisit({ name: 'Paciente Esperando', services: ['lab'] }).entries[0];

    store.db.prepare(`UPDATE queue_entries SET status = 'completed', station_id = ?, created_at = ?, called_at = ?, started_at = ?, completed_at = ? WHERE id = ?`)
      .run(labStation.id, '2026-08-27T12:00:00.000Z', '2026-08-27T12:05:00.000Z', '2026-08-27T12:10:00.000Z', '2026-08-27T12:18:00.000Z', laboratory.id);
    store.db.prepare(`UPDATE queue_entries SET status = 'completed', station_id = ?, created_at = ?, called_at = ?, started_at = ?, completed_at = ? WHERE id = ?`)
      .run(xrayStation.id, '2026-08-27T12:15:00.000Z', '2026-08-27T12:25:00.000Z', '2026-08-27T12:35:00.000Z', '2026-08-27T12:47:00.000Z', xray.id);
    store.db.prepare(`UPDATE queue_entries SET status = 'absent', station_id = ?, created_at = ?, called_at = ?, completed_at = ? WHERE id = ?`)
      .run(labStation.id, '2026-08-27T13:00:00.000Z', '2026-08-27T13:05:00.000Z', '2026-08-27T13:10:00.000Z', absent.id);
    store.db.prepare(`UPDATE queue_entries SET created_at = ? WHERE id = ?`)
      .run('2026-08-27T14:00:00.000Z', waiting.id);

    const dashboard = store.adminDashboard('today', new Date('2026-08-27T20:00:00.000Z'));

    assert.equal(dashboard.metrics.completed, 2);
    assert.equal(dashboard.metrics.averageWait, 15);
    assert.equal(dashboard.metrics.averageAttention, 10);
    assert.equal(dashboard.metrics.absent, 1);
    assert.equal(dashboard.metrics.priorityCompleted, 1);
    assert.deepEqual(dashboard.states, { waiting: 1, active: 0, completed: 2, absent: 1 });
    assert.equal(dashboard.serviceRows.find((row) => row.service === 'lab').completed, 1);
    assert.equal(dashboard.serviceRows.find((row) => row.service === 'xray').averageAttention, 12);
    assert.equal(dashboard.stationRows.find((row) => row.id === labStation.id).averageAttention, 8);
    assert.equal(dashboard.timeline.reduce((sum, item) => sum + item.value, 0), 2);
    assert.equal(dashboard.recent[0].patientName, 'Paciente Esperando');
  } finally {
    store.close();
  }
});
