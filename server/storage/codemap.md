# server/storage/

## Responsibility

The storage layer owns all SQLite database lifecycle — creation, opening, configuration, schema bootstrapping, and legacy data normalization. It provides the rest of the server with Drizzle-ORM-wrapped typed database handles for the analytics and pricing databases, and a bare `better-sqlite3` handle for raw read-only access to OpenCode's own SQLite file.

Three logical databases are managed:

| Database | Schema | Access |
|---|---|---|
| **Analytics DB** | `sync_state`, `session_tree_edge`, `message_usage_fact` | Read-write + read-only |
| **Pricing DB** | `pricing_record`, `pricing_source_event` | Read-write + read-only |
| **Raw OpenCode DB** | (OpenCode's native schema; not owned here) | Read-only, bare sqlite (no Drizzle) |

## Design

### Layered architecture

```
schema.sql.ts          — Drizzle table defs + raw SQL DDL strings
       |
       v
db-internals.ts        — shared: configure(), ensureParentDir(), legacy normalizers
       |
       v
db.ts                  — analytics DB open/bootstrap + raw OpenCode DB open
pricing-db.ts          — pricing DB open/bootstrap
       |
       v
server consumers (routes, services)
```

### Key abstractions

- **Drizzle ORM overlay.** A `drizzle()` instance is created for analytics and pricing DBs using the corresponding Drizzle schema objects. The returned handle is a Drizzle instance extended with `{ sqlite }` — the underlying `better-sqlite3` `Database` — via `Object.assign`. This lets callers use both the typed Drizzle query builder and raw SQL when needed.

- **Bootstrap-on-open pattern.** Every `open*Db()` read-write call runs `bootstrap*Db()` first. The bootstrap ensures the parent directory exists, opens a temporary sqlite connection, runs legacy normalization, executes `CREATE TABLE IF NOT EXISTS` DDL, and closes. Then the real connection is opened. This guarantees the DB is ready regardless of whether it existed before.

- **Read-only open functions** (`openAnalyticsReadonlyDb`, `openPricingReadonlyDb`, `openRawOpencodeDb`) require `fileMustExist: true`. They do not bootstrap — the file must already be present.

- **Normalize-on-open.** Before DDL runs, legacy normalization functions inspect existing tables and repair them in-place. This handles migrations from earlier versions of the observatory without a formal migration framework.

### Configuration

`configure(db, mode)` sets SQLite pragmas:

| Pragma | Value | Notes |
|---|---|---|
| `journal_mode` | `WAL` | Write-ahead log for concurrent reads; only set in read-write mode |
| `foreign_keys` | `ON` | Enforced in all modes |
| `busy_timeout` | `5000` | 5-second wait before throwing SQLITE_BUSY |

## Flow

### Analytics DB open (read-write)

```
openAnalyticsDb(file) / openAnalyticsDatabase(file)
  |
  +-> bootstrapAnalyticsDb(file)
  |     |
  |     +-> ensureParentDir(file)           // mkdir -p
  |     +-> new Database(file)              // open temp connection
  |     +-> configure(sqlite, "readwrite")  // WAL + FK + busy_timeout
  |     +-> normalizeLegacySyncState()      // repair old sync_state schema
  |     +-> sqlite.exec(analyticsBootstrapSql)  // CREATE TABLE IF NOT EXISTS x3
  |     +-> sqlite.close()
  |
  +-> new Database(file)                    // open real connection
  +-> configure(sqlite, "readwrite")
  +-> drizzle(sqlite, { schema: analyticsSchema })
  +-> return Object.assign(db, { sqlite })
```

### Analytics DB open (read-only)

```
openAnalyticsReadonlyDb(file)
  |
  +-> new Database(file, { readonly: true, fileMustExist: true })
  +-> configure(sqlite, "readonly")
  +-> drizzle(sqlite, { schema: analyticsSchema })
  +-> return Object.assign(db, { sqlite })
```

### Pricing DB open (read-write)

```
openPricingDb(file)
  |
  +-> bootstrapPricingDb(file)
  |     |
  |     +-> ensureParentDir(file)
  |     +-> new Database(file)
  |     +-> configure(sqlite, "readwrite")
  |     +-> normalizeLegacyPricingRecord()   // repair old pricing_record schema
  |     +-> sqlite.exec(pricingBootstrapSql)  // CREATE TABLE IF NOT EXISTS x2
  |     +-> sqlite.close()
  |
  +-> new Database(file)
  +-> configure(sqlite, "readwrite")
  +-> drizzle(sqlite, { schema: pricingSchema })
  +-> return Object.assign(db, { sqlite })
```

### Raw OpenCode DB open

```
openRawOpencodeDb(file)
  |
  +-> new Database(file, { readonly: true, fileMustExist: true })
  +-> configure(sqlite, "readonly")
  +-> return sqlite                          // bare better-sqlite3, no Drizzle
```

### Legacy normalization details

**`normalizeLegacySyncState(sqlite)`** — Detects old `sync_state` tables that used `(key, updated_at)` columns instead of `(key, value)`. If detected, runs a transaction that:

1. Creates `__opencode_cost_observatory_sync_state_migrated(key, value)`
2. Copies `key, cast(updated_at as text)` from the old table
3. Drops old `sync_state`
4. Renames the migrated table to `sync_state`

This is a best-effort repair; it converts the old `updated_at` timestamp into the `value` text column, preserving the last-known sync timestamp as the value.

**`normalizeLegacyPricingRecord(sqlite)`** — Detects and repairs legacy `pricing_record` tables against the current canonical schema. Checks for:

- Missing `reasoning_billing_rule_json` column
- Missing `CHECK` constraints (USD-only currency, valid source types, non-blank source URL, manual override coherence)
- Non-`'USD'` currency
- Non-standard `source_type` values
- Empty or null `source_url` values
- `is_manual_override` not coherent with `source_type`

If any structural issue is found (missing column or missing constraint), the entire table is rebuilt via a `create-insert-drop-rename` transaction. Otherwise, in-place `UPDATE` statements normalize rows. Non-USD currency rows are deleted. The reasoning billing rule JSON is synthesized as:

```json
{ "kind": "per_token", "provenance": { "sourceType": "<normalized>", "sourceUrl": "<normalized>" } }
```

## Integration

### Exports consumed by the server

| Module | Export | Used by |
|---|---|---|
| `db.ts` | `openAnalyticsDb()` | Routes/services that write analytics data |
| `db.ts` | `openAnalyticsReadonlyDb()` | Read-only queries/reporting |
| `db.ts` | `openAnalyticsDatabase()` | Alias of `openAnalyticsDb` (backward compatibility) |
| `db.ts` | `openRawOpencodeDb()` | Sync ingestion: reads OpenCode's native DB |
| `pricing-db.ts` | `openPricingDb()` | Routes/services that manage pricing |
| `pricing-db.ts` | `openPricingReadonlyDb()` | Read-only pricing lookups |

### Internal dependencies

```
pricing-db.ts ──imports──> db-internals.ts (configure, ensureParentDir, normalizeLegacyPricingRecord)
pricing-db.ts ──imports──> schema.sql.ts   (pricingBootstrapSql, pricing_record, pricing_source_event)

db.ts         ──imports──> db-internals.ts (configure, ensureParentDir, normalizeLegacySyncState)
db.ts         ──imports──> schema.sql.ts   (analyticsBootstrapSql, message_usage_fact, session_tree_edge, sync_state)

db-internals.ts ──imports──> better-sqlite3, node:fs, node:path  (no internal deps)
schema.sql.ts   ──imports──> drizzle-orm  (no internal deps)
```

### External dependencies

- **`better-sqlite3`** — Native SQLite driver; synchronous API.
- **`drizzle-orm`** — TypeScript ORM; used for typed queries against the analytics and pricing schemas. The raw OpenCode DB handle bypasses Drizzle because OpenCode's schema is not owned or modeled here.
