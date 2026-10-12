// Base de datos SQLite embebida (node:sqlite). Un único fichero, con WAL y migraciones versionadas.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  // 1: esquema inicial
  `
  CREATE TABLE licenses (
    id INTEGER PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    key_hint TEXT NOT NULL,
    email TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'pro',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
    source TEXT NOT NULL,
    external_ref TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    notes TEXT
  );
  CREATE UNIQUE INDEX licenses_source_ref ON licenses(source, external_ref) WHERE external_ref IS NOT NULL;

  CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    status TEXT NOT NULL,
    error TEXT
  );

  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    dedupe_key TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE INDEX outbox_due ON outbox(status, next_attempt_at);

  CREATE TABLE usage_daily (
    day TEXT NOT NULL,
    event TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, event, plan)
  );

  CREATE TABLE rate_limits (
    key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (key, window_start)
  );

  CREATE TABLE job_runs (
    job TEXT PRIMARY KEY,
    locked_until TEXT,
    last_started_at TEXT,
    last_finished_at TEXT,
    last_status TEXT,
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE interest (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    feature TEXT NOT NULL,
    org_type TEXT,
    bank TEXT,
    consent_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (email, feature)
  );
  `,
];

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      version++;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
    });
  }
  return db;
}

/** Ejecuta fn dentro de una transacción (BEGIN IMMEDIATE para evitar carreras de escritura). */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function incrementUsage(db, { day, event, plan = '', count = 1, amount = 0 }) {
  db.prepare(`INSERT INTO usage_daily (day, event, plan, count, amount) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (day, event, plan) DO UPDATE SET count = count + excluded.count, amount = amount + excluded.amount`)
    .run(day, event, plan, count, amount);
}
