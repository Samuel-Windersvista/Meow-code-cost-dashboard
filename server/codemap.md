# server/

## Responsibility

The server provides the **backend API** for the OpenCode Cost Observatory dashboard. It reads raw token-usage data from an external OpenCode SQLite database, syncs (ingests) it into a local analytics store, resolves model pricing from a separate pricing registry, computes costs, builds time-series aggregations and session leaderboards, and serves all this data over a RESTful Express HTTP API. It also manages pricing records (CRUD), token-based dashboard authentication, and a sync lifecycle with background worker support.

## Architecture & Design Patterns

### Three-Database Architecture

| Database | Mode | Purpose |
|---|---|---|
| Raw OpenCode DB | Read-only (external) | Source of truth; produced by the OpenCode CLI. Contains `message`, `session`, `project`, `part` tables. |
| Analytics DB (`analytics.db`) | Read-write (local) | Local analytics warehouse. Tables: `message_usage_fact`, `session_tree_edge`, `sync_state`. Holds usage facts, session hierarchy, and sync cursor/status metadata. |
| Pricing DB (`pricing.db`) | Read-write (local) | Pricing registry. Tables: `pricing_record`, `pricing_source_event`. Stores per-model pricing with source provenance, temporal validity windows, and enabled/superseded lifecycle. |

### Core Patterns

- **Full-Refresh Sync**: The sync operation performs a **destructive full refresh** each time -- it deletes all rows from `message_usage_fact` and `session_tree_edge`, then re-inserts everything from the raw OpenCode DB in a single transaction. This avoids incremental cursor complexity at the cost of blocking reads during sync (handled via SQLITE_BUSY → 503 retry).
- **Sync Worker Isolation**: Sync can run **in-process** (default for tests) or in a **forked child process** (`node --import tsx server/sync-worker.ts`) to prevent long-running analytics locks from blocking the HTTP server. The child process communicates results via a temp JSON file.
- **Pricing Resolution**: Usage records are matched to pricing records via **canonical model key normalization** (lowercased, provider-prefix-stripped, alias-resolved). If multiple pricing records match, a **source-type precedence** (official > openrouter > websearch > manual) and **temporal validity** (effective_time / superseded_time) determine the canonical price.
- **Session Tree Rollup**: Sessions form a parent-child tree. Leaderboards roll up child session costs into parent totals via a depth-first tree traversal in `session-rollup.ts`.
- **Pricing Recovery Bootstrap**: On first run (or empty pricing DB), the server populates the pricing registry from one of three sources in priority order: (1) existing records, (2) legacy pricing from the analytics DB, (3) a hardcoded seed (`CURRENT_EFFECTIVE_PRICING_SEED`). A Spark-alias repair step ensures `openai:gpt-5.3-codex` is the canonical ID, tombstoning alias rows.
- **Legacy Schema Migration**: `db-internals.ts` handles backward-compatible migration of older DB schemas (e.g., `sync_state` from `updated_at` to `value`, `pricing_record` from missing constraints/columns) without breaking existing data.
- **SQLite Configuration**: All DBs use WAL journal mode, `foreign_keys = ON`, and `busy_timeout = 5000`. Read-only connections open with `readonly: true` and `fileMustExist: true`.

## Data & Control Flow

```
                   +-------------------+
                   | OpenCode CLI      |
                   | (raw .db)         |
                   +--------+----------+
                            |
                    (read-only; external)
                            |
                            v
+----------+     +----------+----------+     +-------------------+
| bootstrap |---->|  SYNC OPERATION    |---->| Analytics DB      |
| cold-start|     | (full refresh)     |     | message_usage_fact|
| sync      |     | reads raw -> writes|     | session_tree_edge |
+----------+     | analytics          |     | sync_state        |
                 +--------------------+     +--------+----------+
                                                     |
                           +-------------------------+----------+
                           |                                    |
                           v                                    v
                  +--------+--------+                +---------+--------+
                  | Pricing DB      |                | ANALYTICS ENGINE |
                  | pricing_record  |<-------------->| cost-engine      |
                  | pricing_source_ |                | series builder   |
                  | event           |                | leaderboards     |
                  +-----------------+                | overview         |
                                                     +---------+--------+
                                                               |
                                                               v
                                                    +----------+----------+
                                                    | Express REST API    |
                                                    | (routes/*.ts)       |
                                                    +----------+----------+
                                                               |
                                                               v
                                                    +----------+----------+
                                                    | Client (React SPA)  |
                                                    +---------------------+
```

### Startup Sequence

1. `main.ts` → `loadConfig()` reads config from `.env`, `dashboard.config.json`, and env vars
2. `bootstrapAnalyticsDb()` creates/verifies the analytics DB schema
3. `ensurePricingRegistryReady()` populates the pricing DB (existing → legacy → seed)
4. Express app is configured with middleware and routes
5. `queueColdStartAnalyticsRefresh()` auto-triggers a sync if both analytics tables are empty and the raw DB exists
6. Server listens on the configured host:port

### Sync Lifecycle

Sync state is tracked in the `sync_state` key-value table. States: `idle` → `requested` → `started` → `running` → `completed` (or `failed`). On unexpected backend exit during sync, the state is marked `interrupted` on next read. Active sync jobs are tracked in an in-memory Map; only one sync can run per database at a time.

## Integration Points

| Integration | Mechanism | Details |
|---|---|---|
| Raw OpenCode DB | Direct SQLite read (better-sqlite3) | Reads `message`, `session`, `project` tables. JSON parsing of `data` columns to extract provider/model/tokens. |
| Client SPA | REST API over HTTP | Express server on configurable port (default 41777). Same-origin when served via Vite dev proxy. |
| Dashboard Auth | Token header/cookie | `x-dashboard-token` header or `dashboard_auth` cookie. Loopback-only endpoint for initial token exchange. |
| Backend Process Control | Vite plugin (`vite-backend-control.ts`) | HTTP endpoints at `/__observatory/backend/{status,start,restart}` guarded by loopback + origin checks. Delegates to `bootstrap.ps1` via PowerShell. |
| Pricing Seed Data | Hardcoded array (`current-effective-pricing.ts`) | ~25 models (OpenAI, Google, Anthropic, DeepSeek, Meta, xAI) with official/openrouter-sourced prices. |

## Key Files

| File | Role |
|---|---|
| `server/main.ts` | **Entry point.** Creates Express app, loads config, bootstraps DBs, mounts all routes, starts HTTP listener, queues cold-start sync. |
| `server/config.ts` | **Configuration.** Loads from `.env`, `dashboard.config.json`, and env vars. Resolves file paths. Validates with Zod. |
| `server/auth.ts` | **Authentication.** Token validation via `x-dashboard-token` header or `dashboard_auth` cookie. Loopback-only `/auth/localhost-token` for first-time token handoff. |
| `server/sync-worker.ts` | **Sync child process.** Receives a JSON payload with DB paths, runs `syncRawOpencodeToAnalytics()`, writes result/error to files, exits. |
| `server/spawn-backend.cjs` | **Process spawner.** Used by `bootstrap.ps1` to detach the backend as a background child process. CJS (not ESM) for child_process compatibility. |
| `server/vite-backend-control.ts` | **Vite plugin.** Exposes `/__observatory/backend/{status,start,restart}` endpoints through Vite dev server for UI-based backend lifecycle control. |
| `server/services/dashboard-analytics.ts` | **Core analytics engine.** Sync logic (`syncRawOpencodeToAnalytics`), overview builder, time-series builder, session leaderboards, sync lifecycle management, background sync with worker-process isolation. |
| `server/services/raw-opencode.ts` | **Raw DB reader.** Iterates/reads OpenCode's `message`, `session`, `project`, `part` tables. Parses JSON payloads. Normalizes assistant messages with token dimensions. |
| `server/services/cost-engine.ts` | **Cost calculator.** Pure function: token counts x per-million-token prices → line-item and total USD cost. Handles reasoning billing rules. |
| `server/services/pricing-registry.ts` | **Pricing domain model.** Types, validation, canonical price resolution (source precedence + temporal validity). Creates/validates pricing record drafts. |
| `server/services/pricing-identity.ts` | **Model identity matching.** Normalizes model keys (lowercase, strip provider prefix, resolve aliases like `k2p6 → kimi-2.6`). |
| `server/services/pricing-recovery.ts` | **Pricing bootstrap.** Ensures the pricing DB has active records. Recovery order: existing records → legacy analytics → hardcoded seed. Also repairs Spark-alias mismatches. |
| `server/services/current-effective-pricing.ts` | **Pricing seed data.** Hardcoded array of ~25 canonical model pricing entries used as the fallback seed when no other pricing source exists. |
| `server/services/observed-pricing-coverage.ts` | **Coverage analysis.** For each observed model in usage data, checks whether a canonical pricing record exists. Produces priced/missing status rows. |
| `server/services/session-rollup.ts` | **Session tree aggregator.** Rolls up child session token/cost into parent totals via recursive DFS. |
| `server/services/cold-start-sync.ts` | **Auto-sync trigger.** Decides whether to auto-queue a sync on startup by checking table emptiness and prior sync evidence. |
| `server/services/sqlite-busy.ts` | **SQLite busy handler.** Detects `SQLITE_BUSY`/`SQLITE_LOCKED` errors and returns 503 with retryable flag. |
| `server/services/window-range.ts` | **Time window parser.** Parses query parameters into preset (`1h`, `24h`, `7d`, `30d`, `90d`, `all`) or custom date-range windows. |
| `server/storage/db.ts` | **Analytics DB connections.** Bootstrap, open read-only, open read-write (with Drizzle ORM). Also opens raw OpenCode DB as bare better-sqlite3. |
| `server/storage/pricing-db.ts` | **Pricing DB connections.** Bootstrap, open read-only, open read-write (with Drizzle ORM). |
| `server/storage/schema.sql.ts` | **Database schema.** Drizzle ORM table definitions + raw SQL bootstrap strings for all tables (`message_usage_fact`, `session_tree_edge`, `sync_state`, `pricing_record`, `pricing_source_event`). |
| `server/storage/db-internals.ts` | **DB utilities.** WAL/journal config, legacy schema migration (`normalizeLegacySyncState`, `normalizeLegacyPricingRecord`), parent dir creation. |
| `server/routes/overview.ts` | `GET /overview/lifetime` -- lifetime + windowed token/spend with pricing coverage gaps |
| `server/routes/series.ts` | `GET /series/:granularity` -- time-series buckets (hourly/daily/weekly/monthly) with token and cost metrics |
| `server/routes/leaderboards.ts` | `GET /leaderboards/{token-sessions,cost-sessions,expensive-sessions}` -- session rankings by tokens or cost |
| `server/routes/pricing.ts` | `GET/POST/PUT/DELETE /pricing/records[/:id]` -- CRUD for pricing records; `GET /pricing/observed-coverage`; `POST /pricing/refresh` |
| `server/routes/sync.ts` | `GET /sync/status` -- sync lifecycle state; `POST /sync/refresh` -- manual sync trigger |
| `server/routes/health.ts` | `GET /health` -- liveness check (unauthenticated) |
| `server/routes/diagnostics.ts` | `GET /backend/diagnostics` -- comprehensive server state: sync lifecycle, cursors, lag, last refresh |
