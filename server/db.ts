import { DatabaseSync } from 'node:sqlite'

// Cada entrada é aplicada uma única vez; a posição no array é a versão (PRAGMA user_version).
const MIGRATIONS: string[] = [
  `CREATE TABLE campaigns (
    id           TEXT PRIMARY KEY,
    source       TEXT NOT NULL CHECK (source IN ('codex', 'manual')),
    codex_slug   TEXT UNIQUE,
    title        TEXT NOT NULL,
    tagline      TEXT NOT NULL DEFAULT '',
    system       TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT '',
    ongoing      INTEGER NOT NULL DEFAULT 0,
    image_url    TEXT,
    image_source TEXT CHECK (image_source IN ('codex', 'upload', 'url')),
    foundry_url  TEXT,
    codex_url    TEXT,
    sort_order   INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    CHECK (foundry_url IS NOT NULL OR codex_url IS NOT NULL),
    CHECK ((source = 'codex') = (codex_slug IS NOT NULL))
  )`,
]

export function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as {
    user_version: number
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}
