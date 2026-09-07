import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SERVICES = new Set(['lab', 'xray']);
const PREFIXES = { lab: 'LAB', xray: 'RX' };
const SERVICE_NAMES = { lab: 'Toma de muestras', xray: 'Rayos X' };

function isoNow() {
  return new Date().toISOString();
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeStationName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function createStore(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id),
      priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_counters (
      service TEXT PRIMARY KEY CHECK (service IN ('lab', 'xray')),
      last_number INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS service_stations (
      id INTEGER PRIMARY KEY,
      service TEXT NOT NULL CHECK (service IN ('lab', 'xray')),
      name TEXT NOT NULL COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(service, name)
    );

    CREATE TABLE IF NOT EXISTS queue_entries (
      id INTEGER PRIMARY KEY,
      visit_id INTEGER NOT NULL REFERENCES visits(id),
      service TEXT NOT NULL CHECK (service IN ('lab', 'xray')),
      sequence INTEGER NOT NULL,
      public_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting', 'called', 'attending', 'completed', 'absent', 'cancelled')),
      available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
      station_id INTEGER REFERENCES service_stations(id),
      created_at TEXT NOT NULL,
      called_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE(service, sequence)
    );

    CREATE TABLE IF NOT EXISTS call_events (
      id INTEGER PRIMARY KEY,
      queue_entry_id INTEGER NOT NULL REFERENCES queue_entries(id),
      action TEXT NOT NULL CHECK (action IN ('called', 'repeated', 'started', 'completed', 'absent')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_queue_next
      ON queue_entries(service, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_queue_visit
      ON queue_entries(visit_id);

    INSERT OR IGNORE INTO service_counters(service, last_number) VALUES ('lab', 0), ('xray', 0);
    INSERT OR IGNORE INTO service_stations(service, name, active, sort_order, created_at) VALUES
      ('lab', 'Módulo 1', 1, 1, datetime('now')),
      ('lab', 'Módulo 2', 1, 2, datetime('now')),
      ('xray', 'Rayos X', 1, 1, datetime('now'));
  `);

  const patientColumns = db.prepare('PRAGMA table_info(patients)').all();
  if (patientColumns.some((column) => column.name === 'document')) {
    try {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;
        CREATE TABLE patients_without_document (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO patients_without_document(id, name, created_at)
          SELECT id, name, created_at FROM patients;
        DROP TABLE patients;
        ALTER TABLE patients_without_document RENAME TO patients;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch {}
      db.exec('PRAGMA foreign_keys = ON;');
      throw error;
    }
  }

  const queueColumns = db.prepare('PRAGMA table_info(queue_entries)').all();
  const hasAvailable = queueColumns.some((column) => column.name === 'available');
  const hasLegacyStation = queueColumns.some((column) => column.name === 'station');
  const hasStationId = queueColumns.some((column) => column.name === 'station_id');
  if (hasLegacyStation) {
    const availableExpression = hasAvailable ? 'available' : '1';
    try {
      db.exec(`
        INSERT OR IGNORE INTO service_stations(service, name, active, sort_order, created_at)
        SELECT service, station, 1, 100 + id, COALESCE(created_at, datetime('now'))
        FROM queue_entries
        WHERE station IS NOT NULL AND trim(station) <> '';
      `);
      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;
        CREATE TABLE queue_entries_without_station (
          id INTEGER PRIMARY KEY,
          visit_id INTEGER NOT NULL REFERENCES visits(id),
          service TEXT NOT NULL CHECK (service IN ('lab', 'xray')),
          sequence INTEGER NOT NULL,
          public_code TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'waiting'
            CHECK (status IN ('waiting', 'called', 'attending', 'completed', 'absent', 'cancelled')),
          available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
          station_id INTEGER REFERENCES service_stations(id),
          created_at TEXT NOT NULL,
          called_at TEXT,
          started_at TEXT,
          completed_at TEXT,
          UNIQUE(service, sequence)
        );
        INSERT INTO queue_entries_without_station(
          id, visit_id, service, sequence, public_code, status, available, station_id,
          created_at, called_at, started_at, completed_at
        )
        SELECT q.id, q.visit_id, q.service, q.sequence, q.public_code, q.status, ${availableExpression},
          CASE WHEN q.called_at IS NOT NULL
            THEN (SELECT s.id FROM service_stations s
                  WHERE s.service = q.service
                    AND s.name = COALESCE(NULLIF(trim(q.station), ''), CASE q.service WHEN 'lab' THEN 'Módulo 1' ELSE 'Rayos X' END)
                  ORDER BY s.sort_order, s.id LIMIT 1)
            ELSE NULL END,
          q.created_at, q.called_at, q.started_at, q.completed_at
        FROM queue_entries q;
        CREATE TABLE call_events_without_station (
          id INTEGER PRIMARY KEY,
          queue_entry_id INTEGER NOT NULL REFERENCES queue_entries_without_station(id),
          action TEXT NOT NULL CHECK (action IN ('called', 'repeated', 'started', 'completed', 'absent')),
          created_at TEXT NOT NULL
        );
        INSERT INTO call_events_without_station(id, queue_entry_id, action, created_at)
          SELECT id, queue_entry_id, action, created_at FROM call_events;
        DROP TABLE call_events;
        DROP TABLE queue_entries;
        ALTER TABLE queue_entries_without_station RENAME TO queue_entries;
        ALTER TABLE call_events_without_station RENAME TO call_events;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch {}
      db.exec('PRAGMA foreign_keys = ON;');
      throw error;
    }
  } else {
    if (!hasAvailable) {
      db.exec('ALTER TABLE queue_entries ADD COLUMN available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1));');
    }
    if (!hasStationId) {
      db.exec('ALTER TABLE queue_entries ADD COLUMN station_id INTEGER REFERENCES service_stations(id);');
    }
  }
  db.exec(`
    UPDATE queue_entries
    SET station_id = (
      SELECT s.id FROM service_stations s
      WHERE s.service = queue_entries.service
      ORDER BY s.sort_order, s.id LIMIT 1
    )
    WHERE station_id IS NULL AND called_at IS NOT NULL;
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_queue_next ON queue_entries(service, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_queue_visit ON queue_entries(visit_id);
    CREATE INDEX IF NOT EXISTS idx_queue_available ON queue_entries(service, status, available, created_at);
    CREATE INDEX IF NOT EXISTS idx_queue_station_active ON queue_entries(station_id, status, called_at);
    CREATE INDEX IF NOT EXISTS idx_stations_service ON service_stations(service, active, sort_order);
  `);

  const insertPatient = db.prepare('INSERT INTO patients(name, created_at) VALUES (?, ?)');
  const insertVisit = db.prepare('INSERT INTO visits(patient_id, priority, created_at) VALUES (?, ?, ?)');
  const bumpCounter = db.prepare('UPDATE service_counters SET last_number = last_number + 1 WHERE service = ? RETURNING last_number');
  const insertEntry = db.prepare(`
    INSERT INTO queue_entries(visit_id, service, sequence, public_code, available, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function mapStation(row) {
    return row ? { ...row, id: Number(row.id), active: Boolean(row.active) } : null;
  }

  function listStations(service, { includeInactive = false } = {}) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    const rows = db.prepare(`
      SELECT id, service, name, active, sort_order AS sortOrder, created_at AS createdAt
      FROM service_stations
      WHERE service = ? ${includeInactive ? '' : 'AND active = 1'}
      ORDER BY sort_order, id
    `).all(service);
    return rows.map(mapStation);
  }

  function getStation(stationId) {
    return mapStation(db.prepare(`
      SELECT id, service, name, active, sort_order AS sortOrder, created_at AS createdAt
      FROM service_stations WHERE id = ?
    `).get(Number(stationId)) || null);
  }

  function requireStation(service, stationId, { active = true } = {}) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    const station = getStation(stationId);
    if (!station || station.service !== service) throw new Error('Selecciona un puesto válido para este servicio.');
    if (active && !station.active) throw new Error('Este puesto está desactivado. Selecciona otro.');
    return station;
  }

  function createStation(service, name) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    const cleanName = normalizeStationName(name);
    if (cleanName.length < 2 || cleanName.length > 40) {
      throw new Error('El nombre del puesto debe tener entre 2 y 40 caracteres.');
    }
    return transaction(() => {
      const nextOrder = Number(db.prepare(`
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder
        FROM service_stations WHERE service = ?
      `).get(service).nextOrder);
      try {
        const id = Number(db.prepare(`
          INSERT INTO service_stations(service, name, active, sort_order, created_at)
          VALUES (?, ?, 1, ?, ?)
        `).run(service, cleanName, nextOrder, isoNow()).lastInsertRowid);
        return getStation(id);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw new Error('Ya existe un puesto con ese nombre.');
        throw error;
      }
    });
  }

  function renameStation(stationId, name) {
    const station = getStation(stationId);
    if (!station) throw new Error('El puesto ya no existe.');
    const cleanName = normalizeStationName(name);
    if (cleanName.length < 2 || cleanName.length > 40) {
      throw new Error('El nombre del puesto debe tener entre 2 y 40 caracteres.');
    }
    try {
      db.prepare('UPDATE service_stations SET name = ? WHERE id = ?').run(cleanName, station.id);
      return getStation(station.id);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new Error('Ya existe un puesto con ese nombre.');
      throw error;
    }
  }

  function setStationActive(stationId, active) {
    return transaction(() => {
      const station = getStation(stationId);
      if (!station) throw new Error('El puesto ya no existe.');
      const nextActive = Boolean(active);
      if (!nextActive && station.active) {
        const activeEntry = db.prepare(`
          SELECT id FROM queue_entries
          WHERE station_id = ? AND status IN ('called', 'attending') LIMIT 1
        `).get(station.id);
        if (activeEntry) throw new Error('Finaliza el turno activo antes de desactivar este puesto.');
        const activeCount = Number(db.prepare(`
          SELECT COUNT(*) AS count FROM service_stations WHERE service = ? AND active = 1
        `).get(station.service).count);
        if (activeCount <= 1) throw new Error('Debe quedar al menos un puesto activo para el servicio.');
      }
      db.prepare('UPDATE service_stations SET active = ? WHERE id = ?').run(nextActive ? 1 : 0, station.id);
      return getStation(station.id);
    });
  }

  function createVisit({ name, services, priority = false }) {
    const cleanName = normalizeName(String(name || ''));
    const cleanServices = [...new Set(services)].filter((service) => SERVICES.has(service));

    if (cleanName.length < 3 || cleanName.length > 100) {
      throw new Error('Escribe el nombre completo del paciente.');
    }
    if (!cleanServices.length) throw new Error('Selecciona al menos un servicio.');

    return transaction(() => {
      const now = isoNow();
      const patientId = Number(insertPatient.run(cleanName, now).lastInsertRowid);

      const visitId = Number(insertVisit.run(patientId, priority ? 1 : 0, now).lastInsertRowid);
      const sequential = cleanServices.includes('lab') && cleanServices.includes('xray');
      const entries = cleanServices.map((service) => {
        const sequence = Number(bumpCounter.get(service).last_number);
        const publicCode = `${PREFIXES[service]}-${String(sequence).padStart(3, '0')}`;
        const available = sequential && service === 'xray' ? 0 : 1;
        const entryId = Number(insertEntry.run(visitId, service, sequence, publicCode, available, now).lastInsertRowid);
        return { id: entryId, service, serviceName: SERVICE_NAMES[service], publicCode, available: Boolean(available) };
      });

      return { visitId, patientId, name: cleanName, priority: Boolean(priority), sequential, entries };
    });
  }

  function queueSummary() {
    const rows = db.prepare(`
      SELECT
        service,
        SUM(CASE WHEN status = 'waiting' AND available = 1 THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN status = 'waiting' AND available = 0 THEN 1 ELSE 0 END) AS blocked,
        MAX(CASE WHEN status IN ('called', 'attending') THEN public_code END) AS active_code,
        SUM(CASE WHEN status IN ('called', 'attending') THEN 1 ELSE 0 END) AS active_count
      FROM queue_entries
      GROUP BY service
    `).all();
    const result = {
      lab: { service: 'lab', name: SERVICE_NAMES.lab, waiting: 0, blocked: 0, estimated: 0, activeCode: '—', activeCount: 0 },
      xray: { service: 'xray', name: SERVICE_NAMES.xray, waiting: 0, blocked: 0, estimated: 0, activeCode: '—', activeCount: 0 }
    };
    for (const row of rows) {
      result[row.service].waiting = Number(row.waiting || 0);
      result[row.service].blocked = Number(row.blocked || 0);
      result[row.service].estimated = Number(row.waiting || 0) * (row.service === 'lab' ? 8 : 10);
      result[row.service].activeCode = row.active_code || '—';
      result[row.service].activeCount = Number(row.active_count || 0);
    }
    return result;
  }

  function recentArrivals(limit = 6) {
    return db.prepare(`
      SELECT q.public_code AS publicCode, q.service, q.status, q.available, q.created_at AS createdAt,
             p.name AS patientName, v.priority
      FROM queue_entries q
      JOIN visits v ON v.id = q.visit_id
      JOIN patients p ON p.id = v.patient_id
      ORDER BY q.id DESC
      LIMIT ?
    `).all(limit).map((row) => ({ ...row, priority: Boolean(row.priority), available: Boolean(row.available) }));
  }

  function getActive(service, stationId = null) {
    const stationFilter = stationId == null ? '' : 'AND q.station_id = ?';
    const parameters = stationId == null ? [service] : [service, Number(stationId)];
    return db.prepare(`
      SELECT q.id, q.public_code AS publicCode, q.service, q.status,
             q.called_at AS calledAt, q.started_at AS startedAt,
             q.station_id AS stationId, s.name AS stationName,
             p.name AS patientName, v.priority
      FROM queue_entries q
      JOIN visits v ON v.id = q.visit_id
      JOIN patients p ON p.id = v.patient_id
      LEFT JOIN service_stations s ON s.id = q.station_id
      WHERE q.service = ? AND q.status IN ('called', 'attending')
        ${stationFilter}
      ORDER BY CASE q.status WHEN 'attending' THEN 0 ELSE 1 END, q.called_at DESC
      LIMIT 1
    `).get(...parameters) || null;
  }

  function waitingQueue(service, limit = 8) {
    return db.prepare(`
      SELECT q.id, q.public_code AS publicCode, q.created_at AS createdAt,
             p.name AS patientName, v.priority
      FROM queue_entries q
      JOIN visits v ON v.id = q.visit_id
      JOIN patients p ON p.id = v.patient_id
      WHERE q.service = ? AND q.status = 'waiting' AND q.available = 1
      ORDER BY v.priority DESC, q.created_at ASC, q.id ASC
      LIMIT ?
    `).all(service, limit).map((row) => ({ ...row, priority: Boolean(row.priority) }));
  }

  function serviceStats(service) {
    const row = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'waiting' AND available = 1 THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN status = 'waiting' AND available = 0 THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 'completed' AND date(completed_at, 'localtime') = date('now', 'localtime') THEN 1 ELSE 0 END) AS completed
      FROM queue_entries WHERE service = ?
    `).get(service);
    return { waiting: Number(row.waiting || 0), blocked: Number(row.blocked || 0), completed: Number(row.completed || 0) };
  }

  function recordAction(entryId, action, status, timestampColumn, stationId = null) {
    return transaction(() => {
      const entry = db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(entryId);
      if (!entry) throw new Error('El turno ya no está disponible.');
      if (stationId != null && Number(entry.station_id) !== Number(stationId)) {
        throw new Error('Este turno pertenece a otro puesto de atención.');
      }
      const now = isoNow();
      const allowed = {
        repeated: ['called'],
        started: ['called'],
        completed: ['attending'],
        absent: ['called']
      };
      if (!allowed[action]?.includes(entry.status)) {
        throw new Error('El estado del turno cambió. Actualiza la pantalla e inténtalo de nuevo.');
      }
      if (action !== 'repeated') {
        db.prepare(`UPDATE queue_entries SET status = ?, ${timestampColumn} = ? WHERE id = ?`).run(status, now, entryId);
      }
      db.prepare('INSERT INTO call_events(queue_entry_id, action, created_at) VALUES (?, ?, ?)')
        .run(entryId, action, now);
      let released = 0;
      let cancelled = 0;
      if (entry.service === 'lab' && action === 'completed') {
        released = Number(db.prepare(`
          UPDATE queue_entries SET available = 1
          WHERE visit_id = ? AND service = 'xray' AND status = 'waiting' AND available = 0
        `).run(entry.visit_id).changes);
      }
      if (entry.service === 'lab' && action === 'absent') {
        cancelled = Number(db.prepare(`
          UPDATE queue_entries SET status = 'cancelled', completed_at = ?
          WHERE visit_id = ? AND service = 'xray' AND status = 'waiting' AND available = 0
        `).run(now, entry.visit_id).changes);
      }
      return { ...entry, released, cancelled };
    });
  }

  function callNext(service, stationId) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    return transaction(() => {
      const station = requireStation(service, stationId);
      if (getActive(service, station.id)) {
        throw new Error(`Finaliza o marca como ausente el turno actual de ${station.name} antes de llamar otro.`);
      }
      const next = db.prepare(`
        SELECT q.id, q.public_code AS publicCode, p.name AS patientName
        FROM queue_entries q
        JOIN visits v ON v.id = q.visit_id
        JOIN patients p ON p.id = v.patient_id
        WHERE q.service = ? AND q.status = 'waiting' AND q.available = 1
        ORDER BY v.priority DESC, q.created_at ASC, q.id ASC
        LIMIT 1
      `).get(service);
      if (!next) throw new Error('No hay turnos pendientes en esta cola.');
      const now = isoNow();
      db.prepare(`UPDATE queue_entries SET status = 'called', station_id = ?, called_at = ? WHERE id = ?`)
        .run(station.id, now, next.id);
      db.prepare(`INSERT INTO call_events(queue_entry_id, action, created_at) VALUES (?, 'called', ?)`)
        .run(next.id, now);
      return { ...next, service, stationId: station.id, stationName: station.name };
    });
  }

  function repeatCall(entryId, stationId = null) {
    return recordAction(entryId, 'repeated', 'called', 'called_at', stationId);
  }

  function startAttention(entryId, stationId = null) {
    return recordAction(entryId, 'started', 'attending', 'started_at', stationId);
  }

  function completeAttention(entryId, stationId = null) {
    return recordAction(entryId, 'completed', 'completed', 'completed_at', stationId);
  }

  function markAbsent(entryId, stationId = null) {
    return recordAction(entryId, 'absent', 'absent', 'completed_at', stationId);
  }

  function displayCalls(limit = 6) {
    return db.prepare(`
      SELECT q.public_code AS publicCode, q.service, p.name AS patientName,
             q.station_id AS stationId, s.name AS stationName,
             c.created_at AS calledAt, c.id AS eventId
      FROM call_events c
      JOIN queue_entries q ON q.id = c.queue_entry_id
      JOIN visits v ON v.id = q.visit_id
      JOIN patients p ON p.id = v.patient_id
      LEFT JOIN service_stations s ON s.id = q.station_id
      WHERE c.action IN ('called', 'repeated')
      ORDER BY c.id DESC
      LIMIT ?
    `).all(limit);
  }

  function adminDashboard(period = 'today', now = new Date()) {
    const periods = { today: 1, '7d': 7, '30d': 30 };
    const periodKey = Object.hasOwn(periods, period) ? period : 'today';
    const end = new Date(now);
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (periods[periodKey] - 1));
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const rows = db.prepare(`
      SELECT q.id, q.service, q.status, q.available,
             q.created_at AS createdAt, q.called_at AS calledAt,
             q.started_at AS startedAt, q.completed_at AS completedAt,
             p.name AS patientName, v.priority,
             q.station_id AS stationId, s.name AS stationName
      FROM queue_entries q
      JOIN visits v ON v.id = q.visit_id
      JOIN patients p ON p.id = v.patient_id
      LEFT JOIN service_stations s ON s.id = q.station_id
      WHERE q.created_at <= ? AND (
        q.created_at >= ? OR q.completed_at >= ? OR q.status IN ('waiting', 'called', 'attending')
      )
      ORDER BY COALESCE(q.completed_at, q.started_at, q.called_at, q.created_at) DESC, q.id DESC
    `).all(endIso, startIso, startIso).map((row) => ({
      ...row,
      available: Boolean(row.available),
      priority: Boolean(row.priority)
    }));

    const inRange = (value) => value && value >= startIso && value <= endIso;
    const durationMinutes = (from, to) => {
      if (!from || !to) return null;
      return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
    };
    const average = (values) => {
      const numbers = values.filter(Number.isFinite);
      return numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
    };
    const completed = rows.filter((row) => row.status === 'completed' && inRange(row.completedAt));
    const absent = rows.filter((row) => row.status === 'absent' && inRange(row.completedAt));
    const currentWaiting = rows.filter((row) => row.status === 'waiting');
    const currentActive = rows.filter((row) => ['called', 'attending'].includes(row.status));
    const completedWaits = completed.map((row) => durationMinutes(row.createdAt, row.startedAt));
    const completedAttention = completed.map((row) => durationMinutes(row.startedAt, row.completedAt));
    const maxWait = completedWaits.filter(Number.isFinite).length ? Math.max(...completedWaits.filter(Number.isFinite)) : null;

    const serviceRows = ['lab', 'xray'].map((service) => {
      const serviceCompleted = completed.filter((row) => row.service === service);
      return {
        service,
        name: SERVICE_NAMES[service],
        completed: serviceCompleted.length,
        averageWait: average(serviceCompleted.map((row) => durationMinutes(row.createdAt, row.startedAt))),
        averageAttention: average(serviceCompleted.map((row) => durationMinutes(row.startedAt, row.completedAt))),
        waiting: currentWaiting.filter((row) => row.service === service && row.available).length,
        blocked: currentWaiting.filter((row) => row.service === service && !row.available).length
      };
    });

    const stationRows = db.prepare(`
      SELECT s.id, s.service, s.name, s.active,
             SUM(CASE WHEN q.status = 'completed' AND q.completed_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS completed,
             AVG(CASE WHEN q.status = 'completed' AND q.completed_at BETWEEN ? AND ?
               THEN (julianday(q.completed_at) - julianday(q.started_at)) * 1440 END) AS averageAttention
      FROM service_stations s
      LEFT JOIN queue_entries q ON q.station_id = s.id
      GROUP BY s.id
      ORDER BY s.service, s.sort_order, s.id
    `).all(startIso, endIso, startIso, endIso).map((row) => ({
      id: Number(row.id),
      service: row.service,
      serviceName: SERVICE_NAMES[row.service],
      name: row.name,
      active: Boolean(row.active),
      completed: Number(row.completed || 0),
      averageAttention: row.averageAttention == null ? null : Math.max(0, Math.round(Number(row.averageAttention)))
    }));

    const timeline = [];
    if (periodKey === 'today') {
      for (let hour = 0; hour < 24; hour += 1) {
        timeline.push({
          key: String(hour),
          label: `${String(hour).padStart(2, '0')}:00`,
          shortLabel: hour % 3 === 0 ? String(hour).padStart(2, '0') : '',
          value: completed.filter((row) => new Date(row.completedAt).getHours() === hour).length
        });
      }
    } else {
      const formatter = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' });
      for (let index = 0; index < periods[periodKey]; index += 1) {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        const value = completed.filter((row) => {
          const completedAt = new Date(row.completedAt);
          return completedAt >= day && completedAt < nextDay;
        }).length;
        timeline.push({
          key: day.toISOString().slice(0, 10),
          label: formatter.format(day).replace('.', ''),
          shortLabel: periodKey === '7d' || index % 3 === 0 ? formatter.format(day).replace('.', '') : '',
          value
        });
      }
    }

    const recent = rows
      .filter((row) => inRange(row.createdAt) || inRange(row.completedAt))
      .slice(0, 10)
      .map((row) => {
        const waitEnd = row.startedAt || (['waiting', 'called'].includes(row.status) ? endIso : row.calledAt);
        const attentionEnd = row.completedAt || (row.status === 'attending' ? endIso : null);
        return {
          ...row,
          waitMinutes: durationMinutes(row.createdAt, waitEnd),
          attentionMinutes: durationMinutes(row.startedAt, attentionEnd)
        };
      });

    const dateFormatter = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    return {
      periodKey,
      periodLabel: periodKey === 'today'
        ? `Hoy, ${dateFormatter.format(end)}`
        : `Del ${dateFormatter.format(start)} al ${dateFormatter.format(end)}`,
      chartTitle: periodKey === 'today' ? 'Atenciones por hora' : 'Atenciones por día',
      updatedAt: endIso,
      metrics: {
        completed: completed.length,
        averageWait: average(completedWaits),
        averageAttention: average(completedAttention),
        absent: absent.length,
        priorityCompleted: completed.filter((row) => row.priority).length,
        maxWait
      },
      states: {
        waiting: currentWaiting.length,
        active: currentActive.length,
        completed: completed.length,
        absent: absent.length
      },
      serviceRows,
      stationRows,
      timeline,
      recent
    };
  }

  function seed() {
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM visits').get().count);
    if (count) return;
    const samples = [
      ['María López', ['lab'], true],
      ['Jorge Gómez', ['lab'], false],
      ['Ana Rodríguez', ['xray'], false],
      ['Diego Pérez', ['lab', 'xray'], false],
      ['Sofía Martínez', ['xray'], true],
      ['Luis Moreno', ['lab'], false]
    ];
    for (const [name, services, priority] of samples) {
      createVisit({ name, services, priority });
    }
  }

  function close() {
    db.close();
  }

  return {
    db,
    listStations,
    getStation,
    createStation,
    renameStation,
    setStationActive,
    createVisit,
    queueSummary,
    recentArrivals,
    getActive,
    waitingQueue,
    serviceStats,
    callNext,
    repeatCall,
    startAttention,
    completeAttention,
    markAbsent,
    displayCalls,
    adminDashboard,
    seed,
    close
  };
}

export { SERVICE_NAMES };
