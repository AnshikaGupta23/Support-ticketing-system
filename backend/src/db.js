// Hybrid database adapter.
//
// Local development:  SQLite (the original single-file setup).
// Render / deployed:  PostgreSQL when process.env.DATABASE_URL is set.
//
// Exposes the same `query`, `getOne`, `execute`, and `initDb` API the routers
// use, so backend/src/routes are identical in both modes.
//
// Dialect translation handled here:
//   - `?` placeholders        -> `$1..$n` for Postgres (skipping string literals)
//   - INSERT OR IGNORE/REPLACE -> ON CONFLICT (DO NOTHING / on unique constraint)
//   - SQLite result.lastID     -> Postgres RETURNING id, exposed as lastID too
//   - LIMIT ? OFFSET ?         -> $n placeholders work via the same rewrite
//   - schema/triggers          -> Postgres-native DDL (immutability preserved)

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USE_POSTGRES = Boolean(process.env.DATABASE_URL);

export { USE_POSTGRES };

// ---------------------------------------------------------------------------
// PostgreSQL pool
// ---------------------------------------------------------------------------
let pool = null;
if (USE_POSTGRES) {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: false },
  });
}

// Rewrite SQLite `?` placeholders to Postgres `$1..$n`, skipping any `?` that
// appears inside a single-quoted SQL string literal.
const positionalToDollar = (sql) => {
  let out = '';
  let i = 0;
  let n = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      const end = sql.indexOf("'", i + 1);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      out += sql.slice(i, end + 1);
      i = end + 1;
    } else if (ch === '?') {
      n += 1;
      out += `$${n}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
};

// Map SQLite upsert syntax onto Postgres. The routers only use OR IGNORE on
// ticket_collaborators (PK conflict => no-op) and OR REPLACE on
// sla_acknowledgments (UNIQUE ticket_id/user_id/breach_count => upsert).
// Postgres requires ON CONFLICT directly after the VALUES list, so we match
// the closing paren of the VALUES clause and append the appropriate clause.
const mapOrReplace = (sql) => {
  if (/INSERT\s+OR\s+IGNORE/i.test(sql)) {
    const stripped = sql.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT');
    return stripped.replace(
      /(VALUES\s*\([^)]*\))\s*$/i,
      '$1 ON CONFLICT DO NOTHING'
    );
  }
  if (/INSERT\s+OR\s+REPLACE/i.test(sql)) {
    const stripped = sql.replace(/INSERT\s+OR\s+REPLACE/i, 'INSERT');
    return stripped.replace(
      /(VALUES\s*\([^)]*\))\s*;?\s*$/i,
      "$1 ON CONFLICT (ticket_id, user_id, breach_count) DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at"
    );
  }
  return sql;
};

const translateSql = (sql) => positionalToDollar(mapOrReplace(sql));

// Exported for unit-testing the dialect translation without a database.
export { translateSql };

const toPgValue = (value) => {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

const runPostgres = async (sql, params = [], mode = 'all') => {
  let text = translateSql(sql);
  const clean = (params || []).map(toPgValue);

  // Postgres has no lastInsertRowid: append RETURNING id so execute() can hand
  // routers the same `lastID` they rely on for creating tickets/replies.
  if (mode === 'run' && /^\s*insert\s/i.test(text)) {
    text = text.replace(/;\s*$/, '') + ' RETURNING id';
  }

  try {
    const result = await pool.query(text, clean);
    if (mode === 'run') {
      return {
        changes: result.rowCount ?? 0,
        lastID: result.rows?.[0]?.id ?? null,
      };
    }
    if (mode === 'get') return result.rows?.[0] ?? null;
    return result.rows ?? [];
  } catch (err) {
    // Treat unique violations that the code expected to be silent no-ops the
    // same way SQLite's INSERT OR IGNORE did.
    if (err.code === '23505' && /ON CONFLICT DO NOTHING/i.test(text)) {
      return { changes: 0, lastID: null };
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// SQLite (original adapter)
// ---------------------------------------------------------------------------
const dbPath =
  process.env.SQLITE_PATH || path.resolve(__dirname, '../database.sqlite');
const db = USE_POSTGRES ? null : new sqlite3.Database(dbPath);

if (!USE_POSTGRES) {
  db.run('PRAGMA foreign_keys = ON');
}

// ---------------------------------------------------------------------------
// Shared promise API (used by every router)
// ---------------------------------------------------------------------------
export const query = async (sql, params = []) => {
  if (USE_POSTGRES) return runPostgres(sql, params, 'all');
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
};

export const getOne = async (sql, params = []) => {
  if (USE_POSTGRES) return runPostgres(sql, params, 'get');
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
};

export const execute = async (sql, params = []) => {
  if (USE_POSTGRES) return runPostgres(sql, params, 'run');
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

// Returns whether the users table is non-empty (used to avoid wiping a shared
// database on every Render boot).
export const isSeeded = async () => {
  const row = USE_POSTGRES
    ? await getOne('SELECT COUNT(*)::int AS count FROM users')
    : await getOne('SELECT COUNT(*) AS count FROM users');
  return Number(row?.count || 0) > 0;
};

// ---------------------------------------------------------------------------
// initDb: creates schema + immutability triggers (idempotent) for either mode.
// ---------------------------------------------------------------------------
export const initDb = async () => {
  if (USE_POSTGRES) {
    await pool.query('SELECT 1'); // connectivity check
    await pool.query(POSTGRES_SCHEMA);
    return;
  }
  await sqliteInit();
};

// Postgres schema. Table/column names mirror the SQLite schema; triggers
// preserve the storage-level immutability guarantees of ticket_history and
// replies. `IF NOT EXISTS` keeps re-runs (deploys) safe.
const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('SUPERVISOR', 'AGENT')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id                      SERIAL PRIMARY KEY,
    ticket_number           TEXT UNIQUE NOT NULL,
    subject                 TEXT NOT NULL,
    description             TEXT NOT NULL,
    requester_name          TEXT NOT NULL,
    requester_email         TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'NEW'
                            CHECK (status IN ('NEW','OPEN','PENDING','RESOLVED','CLOSED')),
    priority                TEXT NOT NULL DEFAULT 'MEDIUM'
                            CHECK (priority IN ('URGENT','HIGH','MEDIUM','LOW')),
    category                TEXT NOT NULL DEFAULT 'QUESTION'
                            CHECK (category IN ('BUG','BILLING','QUESTION','FEATURE','OTHER')),
    primary_assignee_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_archived             INTEGER NOT NULL DEFAULT 0,
    pending_started_at      TIMESTAMPTZ,
    pending_duration_seconds INTEGER NOT NULL DEFAULT 0,
    reopen_count            INTEGER NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at             TIMESTAMPTZ,
    closed_at               TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS ticket_collaborators (
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ticket_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS replies (
    id               SERIAL PRIMARY KEY,
    ticket_id        INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name      TEXT NOT NULL,
    author_email     TEXT NOT NULL,
    body             TEXT NOT NULL,
    is_internal_note INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS ticket_history (
    id          SERIAL PRIMARY KEY,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name  TEXT NOT NULL,
    action_type TEXT NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    details     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS sla_acknowledgments (
    id               SERIAL PRIMARY KEY,
    ticket_id        INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    breach_count     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (ticket_id, user_id, breach_count)
  );

  -- Hot-query indexes (mirrors the docs' suggested composite index).
  CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
  CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets (primary_assignee_id);
  CREATE INDEX IF NOT EXISTS idx_collaborators_ticket ON ticket_collaborators (ticket_id);
  CREATE INDEX IF NOT EXISTS idx_collaborators_user ON ticket_collaborators (user_id);
  CREATE INDEX IF NOT EXISTS idx_replies_ticket ON replies (ticket_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_history_ticket ON ticket_history (ticket_id, created_at);

  CREATE OR REPLACE FUNCTION prevent_ticket_history_update() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'Ticket history timeline records are immutable and cannot be edited.';
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION prevent_ticket_history_delete() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'Ticket history timeline records are immutable and cannot be deleted.';
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION prevent_reply_update() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'Replies are part of the immutable ticket timeline and cannot be edited.';
  END;
  $$ LANGUAGE plpgsql;

  CREATE OR REPLACE FUNCTION prevent_reply_delete() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'Replies are part of the immutable ticket timeline and cannot be deleted.';
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_history_no_update ON ticket_history;
  CREATE TRIGGER trg_history_no_update BEFORE UPDATE ON ticket_history
    FOR EACH ROW EXECUTE FUNCTION prevent_ticket_history_update();

  DROP TRIGGER IF EXISTS trg_history_no_delete ON ticket_history;
  CREATE TRIGGER trg_history_no_delete BEFORE DELETE ON ticket_history
    FOR EACH ROW EXECUTE FUNCTION prevent_ticket_history_delete();

  DROP TRIGGER IF EXISTS trg_reply_no_update ON replies;
  CREATE TRIGGER trg_reply_no_update BEFORE UPDATE ON replies
    FOR EACH ROW EXECUTE FUNCTION prevent_reply_update();

  DROP TRIGGER IF EXISTS trg_reply_no_delete ON replies;
  CREATE TRIGGER trg_reply_no_delete BEFORE DELETE ON replies
    FOR EACH ROW EXECUTE FUNCTION prevent_reply_delete();
`;

// ---------------------------------------------------------------------------
// SQLite init (unchanged from the original implementation)
// ---------------------------------------------------------------------------
const sqliteInit = () =>
  new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT CHECK(role IN ('SUPERVISOR', 'AGENT')) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_number TEXT UNIQUE NOT NULL,
          subject TEXT NOT NULL,
          description TEXT NOT NULL,
          requester_name TEXT NOT NULL,
          requester_email TEXT NOT NULL,
          status TEXT CHECK(status IN ('NEW', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED')) NOT NULL DEFAULT 'NEW',
          priority TEXT CHECK(priority IN ('URGENT', 'HIGH', 'MEDIUM', 'LOW')) NOT NULL DEFAULT 'MEDIUM',
          category TEXT CHECK(category IN ('BUG', 'BILLING', 'QUESTION', 'FEATURE', 'OTHER')) NOT NULL DEFAULT 'QUESTION',
          primary_assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          is_archived INTEGER DEFAULT 0,
          pending_started_at DATETIME,
          pending_duration_seconds INTEGER DEFAULT 0,
          reopen_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME,
          closed_at DATETIME
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS ticket_collaborators (
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (ticket_id, user_id)
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS replies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          author_name TEXT NOT NULL,
          author_email TEXT NOT NULL,
          body TEXT NOT NULL,
          is_internal_note INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS ticket_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          actor_name TEXT NOT NULL,
          action_type TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS prevent_history_update
        BEFORE UPDATE ON ticket_history
        BEGIN
          SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be edited.');
        END;
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS prevent_history_delete
        BEFORE DELETE ON ticket_history
        BEGIN
          SELECT RAISE(FAIL, 'Ticket history timeline records are immutable and cannot be deleted.');
        END;
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS prevent_reply_update
        BEFORE UPDATE ON replies
        BEGIN
          SELECT RAISE(FAIL, 'Replies are part of the immutable ticket timeline and cannot be edited.');
        END;
      `);
      db.run(`
        CREATE TRIGGER IF NOT EXISTS prevent_reply_delete
        BEFORE DELETE ON replies
        BEGIN
          SELECT RAISE(FAIL, 'Replies are part of the immutable ticket timeline and cannot be deleted.');
        END;
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS sla_acknowledgments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          acknowledged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          breach_count INTEGER DEFAULT 1,
          UNIQUE(ticket_id, user_id, breach_count)
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

export default db;
