import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openSqlite(dbPath) {
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

  return db;
}
