/**
 * sql.js bootstrap shared by the .dbm reader and writer.
 *
 * Environment-neutral: no `fs` import, bytes in / bytes out. In the browser
 * the plugin entry configures the WASM location via {@link configureSqlJs}
 * (Vite `?url` asset); under plain Node (scripts/tests) sql.js finds its WASM
 * next to its own package, so no configuration is needed.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

/** Opaque query function. Runs SQL and returns rows as plain objects. */
export type QueryFn = (sql: string) => Record<string, unknown>[];

/** Handle returned by `openDatabase`. Call `close()` when done. */
export interface CmudDbHandle {
  query: QueryFn;
  close: () => void;
}

let locateFile: ((file: string) => string) | undefined;
let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Point sql.js at its `.wasm` asset (must be called before first use in the browser). */
export function configureSqlJs(locate: (file: string) => string): void {
  locateFile = locate;
}

/** Lazy-init sql.js WASM. Shared across all opens in the session. */
export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs(locateFile ? { locateFile } : undefined);
  }
  return sqlPromise;
}

/** Open a cMUD `.dbm` (SQLite) database from raw bytes. */
export async function openDatabase(bytes: Uint8Array): Promise<CmudDbHandle> {
  const SQL = await getSql();
  const db: Database = new SQL.Database(bytes);

  const query: QueryFn = (sql: string) => {
    const result = db.exec(sql);
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) obj[columns[i]] = row[i];
      return obj;
    });
  };

  return {
    query,
    close: () => db.close(),
  };
}

/** Create an empty in-memory database (for the writer). Caller must `close()` it. */
export async function createDatabase(): Promise<Database> {
  const SQL = await getSql();
  return new SQL.Database();
}
