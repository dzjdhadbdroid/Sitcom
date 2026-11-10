// Adaptateur D1 -> SQLite local (node:sqlite) pour tester la vraie logique contre le vrai schéma.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DB, Stmt } from '../../src/lib/db.ts';

class LocalStmt {
  db: DatabaseSync;
  sql: string;
  params: unknown[];
  constructor(db: DatabaseSync, sql: string, params: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...values: unknown[]): Stmt {
    return new LocalStmt(this.db, this.sql, values) as unknown as Stmt;
  }
  runSync() {
    const r = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { meta: { changes: Number(r.changes) } };
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as never[] };
  }
  async first() {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) as never) ?? null;
  }
  async run() {
    return this.runSync();
  }
}

export function makeDb(): DB & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const dir = join(import.meta.dirname, '..', '..', 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return {
    raw,
    prepare: (sql: string) => new LocalStmt(raw, sql) as unknown as Stmt,
    async batch(statements: Stmt[]) {
      raw.exec('BEGIN');
      try {
        const out = (statements as unknown as LocalStmt[]).map((s) => s.runSync());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** Données de test fictives : aucune donnée réelle de la série. */
export function seed(db: ReturnType<typeof makeDb>) {
  const t = '2026-01-01T00:00:00.000Z';
  const user = (id: string, role: string, owner = 0) => {
    db.raw.prepare('INSERT INTO users (id, google_sub, email, created_at) VALUES (?, ?, ?, ?)').run(id, `sub-${id}`, `${id}@test.example`, t);
    db.raw.prepare('INSERT INTO memberships (user_id, role, is_owner, joined_at) VALUES (?, ?, ?, ?)').run(id, role, owner, t);
  };
  user('owner', 'admin', 1);
  user('admin2', 'admin');
  user('editor', 'editor');
  user('reader', 'reader');
  const res = (id: string, type: string, parent: string) =>
    db.raw.prepare('INSERT INTO resources (id, type, parent_id) VALUES (?, ?, ?)').run(id, type, parent);
  res('season1', 'season', 'section:seasons');
  res('season2', 'season', 'section:seasons');
  res('s1e1', 'episode', 'season1');
  res('s2e1', 'episode', 'season2');
  res('s2e2', 'episode', 'season2');
  res('char1', 'item', 'section:characters');
}

export const grant = (db: ReturnType<typeof makeDb>, userId: string, resourceId: string, level: string) =>
  db.raw
    .prepare('INSERT INTO grants (id, user_id, resource_id, level, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(`g-${userId}-${resourceId}`, userId, resourceId, level, 'owner', '2026-01-01T00:00:00.000Z');
