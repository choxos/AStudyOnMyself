import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { DB_PATH, ROOT } from "./config.ts";

// Columns added after the first release: CREATE TABLE IF NOT EXISTS leaves an
// existing table as it was, so they are added here.
const LATER_COLUMNS: [table: string, column: string, definition: string][] = [
  ["users", "study_start", "TEXT"],
  ["users", "reminder_times", `TEXT NOT NULL DEFAULT '["10:30","15:30","21:00"]'`],
  ["users", "reminders_on", "INTEGER NOT NULL DEFAULT 1 CHECK (reminders_on IN (0, 1))"],
  ["daily_logs", "indoor_pm25", "REAL CHECK (indoor_pm25 BETWEEN 0 AND 1000)"],
  ["daily_logs", "indoor_voc", "REAL CHECK (indoor_voc BETWEEN 0 AND 1000)"],
];

/** Create missing tables, then add the columns later versions introduced. Safe to run again. */
export function migrate(database: DatabaseSync): void {
  database.exec(readFileSync(path.join(ROOT, "server", "schema.sql"), "utf8"));
  for (const [table, column, definition] of LATER_COLUMNS) {
    const columns = (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const db = new DatabaseSync(DB_PATH);
// WAL lets the R analysis read while the server writes.
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
migrate(db);

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

/** Run fn inside BEGIN IMMEDIATE, so check-then-insert sequences are atomic. */
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export const nowIso = (): string => new Date().toISOString();
