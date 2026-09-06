import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { schema } from "./schema.js";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export type AppDatabase = ReturnType<typeof openDatabase>;
type DrizzleDatabase = ReturnType<typeof drizzle<typeof schema>>;

export function openDatabase(path: string): {
  sqlite: BetterSqlite3.Database;
  db: DrizzleDatabase;
  close: () => void;
} {
  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { sqlite, db, close: () => sqlite.close() };
}
