import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Application SQL uses SQLite placeholders and explicit camelCase aliases.
// Only these known syntactic differences are adapted for PostgreSQL.
function postgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`)
    .replace(/\bAS ([a-z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g, 'AS "$1"')
    .replace(/julianday\(([^)]+)\)/g, '(EXTRACT(EPOCH FROM ($1)::timestamptz) / 86400.0)');
}

export async function openDatabase(dbPath) {
  const connection = process.env.DB_CONNECTION || 'sqlite';
  if (!['sqlite', 'pgsql'].includes(connection)) throw new Error('DB_CONNECTION debe ser sqlite o pgsql.');
  const postgres = connection === 'pgsql';
  const context = new AsyncLocalStorage();
  let sqlite;
  let pool;
  let queue = Promise.resolve();
  const exclusive = async (work) => {
    const previous = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  };
  if (postgres) {
    for (const key of ['DB_HOST', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD']) {
      if (!process.env[key]) throw new Error(`Falta ${key}.`);
    }
    pool = new pg.Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_DATABASE,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 15000,
      application_name: 'turnero'
    });
    pool.on('error', (error) => console.error('PostgreSQL pool error:', error.code));
  } else {
    const { openSqlite } = await import('./sqlite.mjs');
    sqlite = openSqlite(dbPath);
  }
  const query = async (sql, parameters = [], mode = 'all') => {
    const execute = async () => {
      if (!postgres) return mode === 'exec' ? sqlite.exec(sql) : sqlite.prepare(sql)[mode](...parameters);
      let statement = postgresSql(sql);
      if (mode === 'run' && /^\s*INSERT INTO\s+(patients|visits|queue_entries|service_stations|call_events)\b/i.test(statement)) {
        statement += ' RETURNING id';
      }
      const result = await (context.getStore() || pool).query(statement, parameters);
      if (mode === 'run') return { lastInsertRowid: result.rows[0]?.id, changes: result.rowCount };
      if (mode === 'get') return result.rows[0];
      return result.rows;
    };
    return postgres || context.getStore() ? execute() : exclusive(execute);
  };
  const transaction = async (work) => {
    if (context.getStore()) return work();
    const execute = async () => {
      const client = postgres ? await pool.connect() : sqlite;
      try {
        await (postgres ? client.query('BEGIN') : client.exec('BEGIN IMMEDIATE'));
        // Match SQLite's single-writer semantics across concurrent requests/processes.
        // Queue operations are short; serialize writes to preserve double-turn ordering.
        if (postgres) await client.query('SELECT pg_advisory_xact_lock(74829103)');
        const result = await context.run(client, work);
        await (postgres ? client.query('COMMIT') : client.exec('COMMIT'));
        return result;
      } catch (error) {
        try { await (postgres ? client.query('ROLLBACK') : client.exec('ROLLBACK')); } catch {}
        throw error;
      } finally { if (postgres) client.release(); }
    };
    return postgres ? execute() : exclusive(execute);
  };
  if (postgres) {
    try {
      const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
      await transaction(() => query(schema, [], 'exec'));
    } catch (error) { await pool.end(); throw error; }
  }
  return {
    prepare: (sql) => ({
      all: (...parameters) => query(sql, parameters, 'all'),
      get: (...parameters) => query(sql, parameters, 'get'),
      run: (...parameters) => query(sql, parameters, 'run')
    }),
    exec: (sql) => query(sql, [], 'exec'),
    transaction,
    close: () => postgres ? pool.end() : exclusive(() => sqlite.close())
  };
}
