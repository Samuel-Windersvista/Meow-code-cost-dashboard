# server/services/

## Responsibility

The service layer transforms raw OpenCode telemetry into a queryable analytics store and a separate pricing registry. It reads OpenCode's internal SQLite databases (messages with JSON payloads, sessions, projects), normalizes and aggregates usage into fact/dimension tables, resolves per-model pricing via a multi-source registry, and exposes dashboard-ready overviews, time series, and session leaderboards. All writes go through `better-sqlite3` with explicit transaction management; all reads use readonly connections.

## Design

**Two-domain storage model.** Services operate over three SQLite databases:

| Database | Opened by | Role |
|---|---|---|
| Raw OpenCode DB | `raw-opencode.ts` (readonly) | Source of truth: opencode's own `message`, `session`, `part`, `project` tables |
| Analytics DB | `dashboard-analytics.ts` (readwrite + readonly) | Derived: `message_usage_fact`, `session_tree_edge`, `sync_state` |
| Pricing DB | `pricing-recovery.ts` (readwrite), `pricing-registry.ts` (readonly) | Price lookup: `pricing_record` (time-ranged, source-typed) |

**Extract-then-normalize pipeline.** Raw JSON messages are parsed (`parseAssistantPayload`) and filtered to `role === "assistant"` only, then normalized into flat rows with token dimensions extracted from `data.tokens.{input,output,reasoning,cache.{read,write},total}`. Provider and model IDs are carried through verbatim; pricing identity is resolved later.

**Pricing resolution with precedence.** `resolveCanonicalPrice()` in `pricing-registry.ts` selects the best pricing row for a given model at a point in time. It sorts candidates by source-type precedence (`official` > `openrouter` > `websearch` > `manual`), then effective time (descending), then observed time. If no row is effective at the query time, it falls back to the earliest-known future row. Model matching uses normalized keys: provider-qualified prefixes (e.g., `openai/gpt-5.2`) are stripped, and aliases (`k2p6` → `kimi-2.6`) are resolved.

**Pricing recovery as multi-tier bootstrap.** On first access, `ensurePricingRegistryReady()` tries three sources in order: (1) existing active durable records in the pricing DB (fast path), (2) legacy `pricing_record` table in the analytics DB (migration, with column-name tolerant queries), (3) hardcoded seed data in `current-effective-pricing.ts`. It also patches "spark alias" rows -- model IDs like `gpt-5.3-codex-spark` that are aliases to the canonical `gpt-5.3-codex` -- by tombstoning the alias and writing the canonical row.

**Sync lifecycle as a state machine.** The sync process has six states defined in `SyncLifecycleStatus`: `idle` → `requested` → `started` → `running` → `completed` | `failed` | `interrupted`. State is persisted in the `sync_state` table. An in-memory `activeSyncJobs` Map tracks currently-running jobs. On process restart, any `requested`/`started`/`running` job without a completion or failure timestamp is marked `interrupted`.

**Background worker isolation.** By default, sync runs in a child process spawned via `sync-worker.ts`. Payload (paths, timestamp) is written to a JSON file; the worker reads it, runs the sync, writes a result JSON, and exits. The parent reads the result. This isolates the raw DB reading and analytics DB writing from the server process, preventing heavy sync work from blocking API responses. For testing, the runner can be replaced with an in-process synchronous alternative.

**Readonly reads, transactional writes.** All query functions (`buildOverview`, `buildSeries`, `buildCostSessionLeaderboard`, etc.) open readonly connections and close them in `finally` blocks. All writes in `syncRawOpencodeToAnalytics` and `ensurePricingRegistryReady` use `begin [immediate]` / `commit` / `rollback` with explicit error propagation. The analytics sync deletes and re-inserts all rows in a single transaction.

## Flow

```
Raw OpenCode DB (readonly)
        |
        v
  raw-opencode.ts
  - iterateAssistantMessagesFromRawDb() → yields normalized messages
  - readSessionsFromRawDb()              → normalized sessions
  - readProjectsFromRawDb()              → normalized projects
        |
        v
  dashboard-analytics.ts
  syncRawOpencodeToAnalytics()
  - deriveAnalyticsSessionRow()          → session_tree_edge rows
  - project lookup                       → resolves project_id per message
  - batch insert with delete-before-write in transaction
  - write cursor & timestamp to sync_state
        |
        v
  Analytics DB (message_usage_fact, session_tree_edge, sync_state)
        |
        +-- buildOverview()              → lifetime tokens/spend, window spend, coverage gaps
        +-- buildSeries()               → time-bucketed token/cost series (hourly/daily/weekly/monthly)
        +-- buildCostSessionLeaderboard() → sessions ranked by cost (with tree rollup)
        +-- buildTokenSessionLeaderboard()→ sessions ranked by tokens
        |
        v
  Pricing DB (pricing_record)
        |
        +-- pricing-recovery.ts / ensurePricingRegistryReady()
        |     ↳ existing records → done
        |     ↳ legacy analytics migration → insert
        |     ↳ hardcoded seed → insert
        |
        +-- pricing-registry.ts / resolveCanonicalPrice()
        |     → best price for (model_key, as_of_time)
        |
        +-- pricing-identity.ts / normalizePricingModelKey()
        |     → strip scope, resolve aliases
        |
        +-- cost-engine.ts / calculateUsageCost()
              → token × price → USD per dimension + total
```

**Cold-start detection** (`cold-start-sync.ts`): On server start, checks if the analytics DB is empty (`message_usage_fact` row count = 0, `session_tree_edge` row count = 0) and has no prior sync evidence (no non-empty cursors, no non-idle status in `sync_state`). If both conditions hold and a raw DB exists, queues a sync refresh.

**Session leaderboard with tree rollup.** `buildSessionLeaderboardRows()` reads all session-tree edges and all usage facts, groups usage by session, then calls `rollupSessionTree()` which recursively sums child session tokens and costs into parent sessions (DFS with cycle detection). The rolled-up values are merged with session metadata (directory, title, project) before sorting and limiting.

**Time-series bucketing.** `buildSeries()` iterates all usage facts within the window bounds, assigns each to a UTC bucket start (hour, day, Monday of week, or 1st of month), and accumulates per-dimension tokens and cost. Buckets are sorted chronologically. For daily granularity, a `date` field (YYYY-MM-DD) is included alongside `bucketStart` (ISO 8601).

**Pricing coverage observability.** Both `buildOverview()` and `buildObservedPricingCoverageRows()` report gaps where observed model IDs have no matching pricing record. `buildOverview()` returns aggregate `pricingCoverageGaps` sorted by total tokens; `readObservedPricingCoverage()` returns per-(provider,model) rows with resolution status and canonical record details.

## Integration

- **`server/storage/db.ts`**: Provides `openAnalyticsDb`, `openAnalyticsReadonlyDb`, `openRawOpencodeDb`. Services use these to open connections with proper `configure()` settings (WAL mode, busy timeout, etc.). Drizzle ORM is used for the analytics schema but raw SQL is used for most queries.

- **`server/storage/pricing-db.ts`**: Provides `openPricingDb`, `openPricingReadonlyDb`. Same pattern as analytics DB but with the `pricing_record` and `pricing_source_event` schema.

- **`server/storage/db-internals.ts`**: `configure()` sets SQLite pragmas (WAL journal, busy timeout, foreign keys). `normalizeLegacySyncState()` / `normalizeLegacyPricingRecord()` handle schema migrations from older versions.

- **`server/sync-worker.ts`**: Entry point for the background sync worker process. Reads the payload JSON, calls `syncRawOpencodeToAnalytics()`, writes the result JSON. Referenced by `dashboard-analytics.ts` via `fileURLToPath` path resolution.

- **`server/routes/`** (consumers): Route handlers call `buildOverview()`, `buildSeries()`, `buildCostSessionLeaderboard()`, `buildTokenSessionLeaderboard()`, `getSyncRefreshLifecycle()`, `readObservedPricingCoverage()`, `ensurePricingRegistryReady()`. They pass analytics DB path and pricing DB path (typically resolved from request context or config).

- **`shared/`** (types): `PresetDashboardWindow`, `ParsedDashboardWindow`, and window-parsing utilities are consumed from `window-range.ts` which is in the service layer.

- **SQLite busy handling**: `isSqliteBusyError()` and `tryRespondWithAnalyticsBusy()` are used by route handlers to catch `SQLITE_BUSY` / `SQLITE_LOCKED` errors during concurrent access and return HTTP 503 with a `{ retryable: true }` body. The `JsonResponder` interface matches Hono's context response shape.
