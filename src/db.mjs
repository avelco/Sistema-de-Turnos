import { openDatabase } from './database.mjs';

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

export async function createStore(dbPath) {
  const db = await openDatabase(dbPath);
  const insertPatient = db.prepare('INSERT INTO patients(name, created_at) VALUES (?, ?)');
  const insertVisit = db.prepare('INSERT INTO visits(patient_id, priority, created_at) VALUES (?, ?, ?)');
  const bumpCounter = db.prepare('UPDATE service_counters SET last_number = last_number + 1 WHERE service = ? RETURNING last_number');
  const insertEntry = db.prepare(`
    INSERT INTO queue_entries(visit_id, service, sequence, public_code, available, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function transaction(work) {
    return db.transaction(work);
  }

  function mapStation(row) {
    return row ? { ...row, id: Number(row.id), active: Boolean(row.active) } : null;
  }

  async function listStations(service, { includeInactive = false } = {}) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    const rows = await db.prepare(`
      SELECT id, service, name, active, sort_order AS sortOrder, created_at AS createdAt
      FROM service_stations
      WHERE service = ? ${includeInactive ? '' : 'AND active = 1'}
      ORDER BY sort_order, id
    `).all(service);
    return rows.map(mapStation);
  }

  async function getStation(stationId) {
    return mapStation((await db.prepare(`
      SELECT id, service, name, active, sort_order AS sortOrder, created_at AS createdAt
      FROM service_stations WHERE id = ?
    `).get(Number(stationId))) || null);
  }

  async function requireStation(service, stationId, { active = true } = {}) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    const station = await getStation(stationId);
    if (!station || station.service !== service) throw new Error('Selecciona un puesto válido para este servicio.');
    if (active && !station.active) throw new Error('Este puesto está desactivado. Selecciona otro.');
    return station;
  }

  async function createStation(service, name) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    const cleanName = normalizeStationName(name);
    if (cleanName.length < 2 || cleanName.length > 40) {
      throw new Error('El nombre del puesto debe tener entre 2 y 40 caracteres.');
    }
    return await transaction(async () => {
      const nextOrder = Number((await db.prepare(`
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder
        FROM service_stations WHERE service = ?
      `).get(service)).nextOrder);
      try {
        const id = Number((await db.prepare(`
          INSERT INTO service_stations(service, name, active, sort_order, created_at)
          VALUES (?, ?, 1, ?, ?)
        `).run(service, cleanName, nextOrder, isoNow())).lastInsertRowid);
        return await getStation(id);
      } catch (error) {
        if (error.code === '23505' || String(error.message).includes('UNIQUE')) throw new Error('Ya existe un puesto con ese nombre.');
        throw error;
      }
    });
  }

  async function renameStation(stationId, name) {
    const station = await getStation(stationId);
    if (!station) throw new Error('El puesto ya no existe.');
    const cleanName = normalizeStationName(name);
    if (cleanName.length < 2 || cleanName.length > 40) {
      throw new Error('El nombre del puesto debe tener entre 2 y 40 caracteres.');
    }
    try {
      await db.prepare('UPDATE service_stations SET name = ? WHERE id = ?').run(cleanName, station.id);
      return await getStation(station.id);
    } catch (error) {
      if (error.code === '23505' || String(error.message).includes('UNIQUE')) throw new Error('Ya existe un puesto con ese nombre.');
      throw error;
    }
  }

  async function setStationActive(stationId, active) {
    return await transaction(async () => {
      const station = await getStation(stationId);
      if (!station) throw new Error('El puesto ya no existe.');
      const nextActive = Boolean(active);
      if (!nextActive && station.active) {
        const activeEntry = await db.prepare(`
          SELECT id FROM queue_entries
          WHERE station_id = ? AND status IN ('called', 'attending') LIMIT 1
        `).get(station.id);
        if (activeEntry) throw new Error('Finaliza el turno activo antes de desactivar este puesto.');
        const activeCount = Number((await db.prepare(`
          SELECT COUNT(*) AS count FROM service_stations WHERE service = ? AND active = 1
        `).get(station.service)).count);
        if (activeCount <= 1) throw new Error('Debe quedar al menos un puesto activo para el servicio.');
      }
      await db.prepare('UPDATE service_stations SET active = ? WHERE id = ?').run(nextActive ? 1 : 0, station.id);
      return await getStation(station.id);
    });
  }

  async function createVisit({ name, services, priority = false }) {
    const cleanName = normalizeName(String(name || ''));
    const cleanServices = [...new Set(services)].filter((service) => SERVICES.has(service));

    if (cleanName.length < 3 || cleanName.length > 100) {
      throw new Error('Escribe el nombre completo del paciente.');
    }
    if (!cleanServices.length) throw new Error('Selecciona al menos un servicio.');

    return await transaction(async () => {
      const now = isoNow();
      const patientId = Number((await insertPatient.run(cleanName, now)).lastInsertRowid);

      const visitId = Number((await insertVisit.run(patientId, priority ? 1 : 0, now)).lastInsertRowid);
      const sequential = cleanServices.includes('lab') && cleanServices.includes('xray');
      const entries = [];
      for (const service of cleanServices) {
        const sequence = Number((await bumpCounter.get(service)).last_number);
        const publicCode = `${PREFIXES[service]}-${String(sequence).padStart(3, '0')}`;
        const available = sequential && service === 'xray' ? 0 : 1;
        const entryId = Number((await insertEntry.run(visitId, service, sequence, publicCode, available, now)).lastInsertRowid);
        entries.push({ id: entryId, service, serviceName: SERVICE_NAMES[service], publicCode, available: Boolean(available) });
      }

      return { visitId, patientId, name: cleanName, priority: Boolean(priority), sequential, entries };
    });
  }

  async function queueSummary() {
    const rows = await db.prepare(`
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

  async function recentArrivals(limit = 6) {
    return (await db.prepare(`
      SELECT q.public_code AS publicCode, q.service, q.status, q.available, q.created_at AS createdAt,
             p.name AS patientName, v.priority
      FROM queue_entries q
      JOIN visits v ON v.id = q.visit_id
      JOIN patients p ON p.id = v.patient_id
      ORDER BY q.id DESC
      LIMIT ?
    `).all(limit)).map((row) => ({ ...row, priority: Boolean(row.priority), available: Boolean(row.available) }));
  }

  async function getActive(service, stationId = null) {
    const stationFilter = stationId == null ? '' : 'AND q.station_id = ?';
    const parameters = stationId == null ? [service] : [service, Number(stationId)];
    return (await db.prepare(`
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
    `).get(...parameters)) || null;
  }

  async function waitingQueue(service, limit = 8) {
    return (await db.prepare(`
      SELECT q.id, q.public_code AS publicCode, q.created_at AS createdAt,
             p.name AS patientName, v.priority
      FROM queue_entries q
      JOIN visits v ON v.id = q.visit_id
      JOIN patients p ON p.id = v.patient_id
      WHERE q.service = ? AND q.status = 'waiting' AND q.available = 1
      ORDER BY v.priority DESC, q.created_at ASC, q.id ASC
      LIMIT ?
    `).all(service, limit)).map((row) => ({ ...row, priority: Boolean(row.priority) }));
  }

  async function serviceStats(service) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const row = await db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'waiting' AND available = 1 THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN status = 'waiting' AND available = 0 THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN status = 'completed' AND completed_at >= ? AND completed_at < ? THEN 1 ELSE 0 END) AS completed
      FROM queue_entries WHERE service = ?
    `).get(start.toISOString(), end.toISOString(), service);
    return { waiting: Number(row.waiting || 0), blocked: Number(row.blocked || 0), completed: Number(row.completed || 0) };
  }

  async function recordAction(entryId, action, status, timestampColumn, stationId = null) {
    return await transaction(async () => {
      const entry = await db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(entryId);
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
        await db.prepare(`UPDATE queue_entries SET status = ?, ${timestampColumn} = ? WHERE id = ?`).run(status, now, entryId);
      }
      await db.prepare('INSERT INTO call_events(queue_entry_id, action, created_at) VALUES (?, ?, ?)').
      run(entryId, action, now);
      let released = 0;
      let cancelled = 0;
      if (entry.service === 'lab' && action === 'completed') {
        released = Number((await db.prepare(`
          UPDATE queue_entries SET available = 1
          WHERE visit_id = ? AND service = 'xray' AND status = 'waiting' AND available = 0
        `).run(entry.visit_id)).changes);
      }
      if (entry.service === 'lab' && action === 'absent') {
        cancelled = Number((await db.prepare(`
          UPDATE queue_entries SET status = 'cancelled', completed_at = ?
          WHERE visit_id = ? AND service = 'xray' AND status = 'waiting' AND available = 0
        `).run(now, entry.visit_id)).changes);
      }
      return { ...entry, released, cancelled };
    });
  }

  async function callNext(service, stationId) {
    if (!SERVICES.has(service)) throw new Error('Servicio no válido.');
    return await transaction(async () => {
      const station = await requireStation(service, stationId);
      if (await getActive(service, station.id)) {
        throw new Error(`Finaliza o marca como ausente el turno actual de ${station.name} antes de llamar otro.`);
      }
      const next = await db.prepare(`
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
      await db.prepare(`UPDATE queue_entries SET status = 'called', station_id = ?, called_at = ? WHERE id = ?`).
      run(station.id, now, next.id);
      await db.prepare(`INSERT INTO call_events(queue_entry_id, action, created_at) VALUES (?, 'called', ?)`).
      run(next.id, now);
      return { ...next, service, stationId: station.id, stationName: station.name };
    });
  }

  async function repeatCall(entryId, stationId = null) {
    return await recordAction(entryId, 'repeated', 'called', 'called_at', stationId);
  }

  async function startAttention(entryId, stationId = null) {
    return await recordAction(entryId, 'started', 'attending', 'started_at', stationId);
  }

  async function completeAttention(entryId, stationId = null) {
    return await recordAction(entryId, 'completed', 'completed', 'completed_at', stationId);
  }

  async function markAbsent(entryId, stationId = null) {
    return await recordAction(entryId, 'absent', 'absent', 'completed_at', stationId);
  }

  async function displayCalls(limit = 6) {
    return await db.prepare(`
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

  async function adminDashboard(period = 'today', now = new Date()) {
    const periods = { today: 1, '7d': 7, '30d': 30 };
    const periodKey = Object.hasOwn(periods, period) ? period : 'today';
    const end = new Date(now);
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (periods[periodKey] - 1));
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const rows = (await db.prepare(`
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
    `).all(endIso, startIso, startIso)).map((row) => ({
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

    const stationRows = (await db.prepare(`
      SELECT s.id, s.service, s.name, s.active,
             SUM(CASE WHEN q.status = 'completed' AND q.completed_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS completed,
             AVG(CASE WHEN q.status = 'completed' AND q.completed_at BETWEEN ? AND ?
               THEN (julianday(q.completed_at) - julianday(q.started_at)) * 1440 END) AS averageAttention
      FROM service_stations s
      LEFT JOIN queue_entries q ON q.station_id = s.id
      GROUP BY s.id
      ORDER BY s.service, s.sort_order, s.id
    `).all(startIso, endIso, startIso, endIso)).map((row) => ({
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

    const recent = rows.
    filter((row) => inRange(row.createdAt) || inRange(row.completedAt)).
    slice(0, 10).
    map((row) => {
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
      periodLabel: periodKey === 'today' ?
      `Hoy, ${dateFormatter.format(end)}` :
      `Del ${dateFormatter.format(start)} al ${dateFormatter.format(end)}`,
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

  async function seed() {
    const count = Number((await db.prepare('SELECT COUNT(*) AS count FROM visits').get()).count);
    if (count) return;
    const samples = [
    ['María López', ['lab'], true],
    ['Jorge Gómez', ['lab'], false],
    ['Ana Rodríguez', ['xray'], false],
    ['Diego Pérez', ['lab', 'xray'], false],
    ['Sofía Martínez', ['xray'], true],
    ['Luis Moreno', ['lab'], false]];

    for (const [name, services, priority] of samples) {
      await createVisit({ name, services, priority });
    }
  }

  async function close() {
    await db.close();
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
