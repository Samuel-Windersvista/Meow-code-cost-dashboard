import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import { configure, ensureParentDir, migrateAnalyticsSchema, normalizeLegacySyncState } from "./db-internals"
import { analyticsBootstrapSql, message_usage_fact, session_tree_edge, sync_state } from "./schema.sql"

const analyticsSchema = { message_usage_fact, session_tree_edge, sync_state }

export function bootstrapAnalyticsDb(file: string) {
  ensureParentDir(file)
  const sqlite = new Database(file)
  try {
    configure(sqlite, "readwrite")
    normalizeLegacySyncState(sqlite)
    sqlite.exec(analyticsBootstrapSql)
    migrateAnalyticsSchema(sqlite)
  } finally {
    sqlite.close()
  }
}

export function openAnalyticsReadonlyDb(file: string) {
  const sqlite = new Database(file, {
    readonly: true,
    fileMustExist: true,
  })
  configure(sqlite, "readonly")
  const db = drizzle(sqlite, { schema: analyticsSchema })
  return Object.assign(db, { sqlite })
}

export function openAnalyticsDb(file: string) {
  bootstrapAnalyticsDb(file)
  const sqlite = new Database(file)
  configure(sqlite, "readwrite")
  const db = drizzle(sqlite, { schema: analyticsSchema })
  return Object.assign(db, { sqlite })
}

export function openAnalyticsDatabase(databasePath: string) {
  return openAnalyticsDb(databasePath)
}

export function openRawOpencodeDb(file: string) {
  const sqlite = new Database(file, {
    readonly: true,
    fileMustExist: true,
  })
  configure(sqlite, "readonly")
  return sqlite
}
