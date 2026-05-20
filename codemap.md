# opencode-cost-observatory/

## Responsibility

This is a **local-first analytics dashboard** for [OpenCode](https://github.com/opencode-ai/opencode) usage. It reads the user's local OpenCode SQLite database, builds derived analytics and pricing registries in separate local SQLite stores, and serves a browser dashboard showing token spend, model mix, pricing coverage, and session leaderboards. All data stays on the user's machine. The tool is targeted at Windows + PowerShell 7+.

## Runtime Topology

```
+------------------------------------------------------------------+
|  User's Machine (Windows, Node 22+, PowerShell 7+)               |
|                                                                  |
|  +------------------------------+   +---------------------------+ |
|  |  Vite Dev Server (:41778)    |   |  Express Backend (:41777) | |
|  |  (client/ React 19 SPA)      |   |  (server/ tsx + express)  | |
|  |                              |   |                           | |
|  |  proxy /api --> backend:41777|-->|  /health                  | |
|  |  proxy /auth --> backend:41777|  |  /auth/*                  | |
|  |                              |   |  /api/overview/*          | |
|  |  /__observatory/backend/*    |   |  /api/series/*            | |
|  |    (backend lifecycle mgmt)  |   |  /api/leaderboards/*      | |
|  +------------------------------+   |  /api/pricing/*           | |
|                                     |  /api/sync/*              | |
|  +------------------------------+   |                           | |
|  |  bootstrap.ps1               |   |  Reads:                   | |
|  |  (start/status/stop          |   |  - raw OpenCode DB (RO)   | |
|  |   lifecycle manager)         |   |  Writes:                  | |
|  |    spawns backend process    |   |  - analytics.db (R/W)     | |
|  +------------------------------+   |  - pricing.db (R/W)       | |
|                                     +---------------------------+ |
+------------------------------------------------------------------+
```

- **Frontend**: Vite dev server at `http://127.0.0.1:41778`, proxies `/api` and `/auth` to the backend.
- **Backend**: Express server at `http://127.0.0.1:41777`, managed by `bootstrap.ps1` (PowerShell lifecycle script).
- **Backend control**: Vite plugin (`server/vite-backend-control.ts`) exposes `/__observatory/backend/{status,start,restart}` for frontend-driven backend management.
- **Sync worker**: Spawned as a separate `node` process (`server/sync-worker.ts`) to avoid blocking the API server during sync.

## System Entry Points

| Entry Point | File | How It Runs |
|---|---|---|
| **Backend server** | `server/main.ts` | `npm run server` or `bootstrap.ps1 start` via `tsx` |
| **Frontend dev server** | `client/index.html` → `client/src/main.tsx` | `npm run dev` (Vite) |
| **Backend lifecycle** | `bootstrap.ps1` | `pwsh -File bootstrap.ps1 [start\|status\|stop]` |
| **Sync worker** | `server/sync-worker.ts` | Spawned as child process by `dashboard-analytics.ts` |
| **DB migrations** | Drizzle Kit | `npm run db:generate` |
| **Type check** | TypeScript | `npm run check` |
| **Tests** | Node test runner | `npm run test` |
| **Production build** | Vite | `npm run build` (client bundle only) |

## Directory Map

| Directory | Responsibility | Sub-codemap |
|---|---|---|
| `client/` | Vite SPA root; contains `index.html` and all React source under `src/` | [client/codemap.md](client/codemap.md) |
| `client/src/` | React 19 application source (entry `main.tsx` → `App.tsx` → `DashboardPage`) | [client/src/codemap.md](client/src/codemap.md) |
| `client/src/api/` | Typed HTTP client for backend JSON endpoints (overview, series, sync, pricing, leaderboards, auth, diagnostics) | [client/src/api/codemap.md](client/src/api/codemap.md) |
| `client/src/components/` | Presentational React components: HeroCards, MainSeriesChart, LeaderboardTables, TimeControls, BackendManagementPanel, etc. | [client/src/components/codemap.md](client/src/components/codemap.md) |
| `client/src/hooks/` | React state management: `useDashboardState` (central data-fetching/state hook), `useI18n` (EN/ZH localization) | [client/src/hooks/codemap.md](client/src/hooks/codemap.md) |
| `client/src/lib/` | Shared client utilities: API error handling, retry logic with analytics-busy backoff, pricing identity matching, window selection serialization | [client/src/lib/codemap.md](client/src/lib/codemap.md) |
| `client/src/pages/` | Page-level component: `DashboardPage.tsx` (composes all panels, wires state, status text, i18n labels) | [client/src/pages/codemap.md](client/src/pages/codemap.md) |
| `server/` | Express backend: entry point, config, auth, Vite integration, sync worker | [server/codemap.md](server/codemap.md) |
| `server/routes/` | Express route handlers: overview, series, leaderboards, pricing, sync, diagnostics, health | [server/routes/codemap.md](server/routes/codemap.md) |
| `server/services/` | Business logic: dashboard analytics builder, cost engine, pricing registry, pricing recovery, cold-start sync, raw OpenCode DB reader, session rollup, SQLite busy detection, window range parsing | [server/services/codemap.md](server/services/codemap.md) |
| `server/storage/` | Database layer: analytics DB bootstrap, pricing DB bootstrap, Drizzle ORM schema (`schema.sql.ts`), SQLite pragma configuration | [server/storage/codemap.md](server/storage/codemap.md) |
| `types/` | Ambient type declarations (better-sqlite3 module declaration) | [types/codemap.md](types/codemap.md) |
| `migrations/` | Drizzle Kit SQL migration files (Drizzle snapshot in `migrations/meta/`) | -- |
| `scripts/` | PowerShell helpers: `opencode-usage.ps1` (optional `opencode --usage` launcher), `spawn-frontend.ps1` | -- |
| `.slim/` | `.slim` AI context cache (`codemap.json` with file/folder hashes) | -- |

## Configuration Surface

Three config layers, applied in order (later overrides earlier):

1. **`dashboard.config.json`** (optional) — JSON with `host`, `port`, `opencodeDbPath`, `analyticsDbPath`, `pricingDbPath`, `dashboardTokenFile`.
2. **`.env`** (optional) — key=value pairs: `HOST`, `PORT`, `OPENCODE_DB_PATH`, `ANALYTICS_DB_PATH`, `PRICING_DB_PATH`, `DASHBOARD_TOKEN`, `DASHBOARD_TOKEN_FILE`.
3. **Process environment variables** (highest precedence) — same keys as `.env`.

Key config values:

| Config Key | Env Var | Default | Purpose |
|---|---|---|---|
| `host` | `HOST` | `127.0.0.1` | Backend bind address |
| `port` | `PORT` | `41777` | Backend listen port |
| `opencodeDbPath` | `OPENCODE_DB_PATH` | `~/local/share/opencode/opencode.db` | Path to user's raw OpenCode DB (read-only) |
| `analyticsDbPath` | `ANALYTICS_DB_PATH` | `./.run/analytics.db` | Path to rebuildable analytics cache DB |
| `pricingDbPath` | `PRICING_DB_PATH` | `~/local/share/opencode-cost-observatory/pricing.db` | Path to durable pricing registry DB |
| `dashboardToken` | `DASHBOARD_TOKEN` | (required) | Plaintext auth token for localhost dashboard |
| `dashboardTokenFile` | `DASHBOARD_TOKEN_FILE` | -- | File path containing the token (alternative to env var) |

**Pricing recovery** at backend startup:
1. Keep existing durable pricing registry if active rows present.
2. Otherwise migrate legacy pricing rows from analytics DB.
3. Otherwise insert built-in current-effective pricing seed rows.

**Auth**: Localhost-only token auth. The frontend POSTs to `/auth/localhost-token` and receives an `httpOnly` cookie. All data endpoints require the token via `x-dashboard-token` header or `dashboard_auth` cookie. Only loopback requests can obtain the cookie.

## Database Schema

**Analytics DB** (`analytics.db`) — Drizzle-managed, rebuildable from raw OpenCode DB:
- `message_usage_fact` — per-message token usage (provider, model, input/output/reasoning/cache tokens)
- `session_tree_edge` — session metadata with parent-child relationships
- `sync_state` — key-value store for sync cursors and lifecycle state

**Pricing DB** (`pricing.db`) — Drizzle-managed, durable:
- `pricing_record` — canonical pricing rows (vendor, model, price per 1M tokens, reasoning billing rule, source metadata)
- `pricing_source_event` — audit trail of pricing changes

**Raw OpenCode DB** — read-only, external; the user's OpenCode installation owns this.

## Typical User Flow

1. **Install**: `npm ci` (Node 22+, PowerShell 7+)
2. **Configure**: Copy `.env.example` → `.env`, point `OPENCODE_DB_PATH` to your local OpenCode database, set `DASHBOARD_TOKEN`
3. **Start backend**: `pwsh -File bootstrap.ps1 start` (background process, health-checked)
4. **Start frontend**: `npm run dev` → opens `http://127.0.0.1:41778`
5. **Auth**: Browser POSTs to backend for localhost token, stores cookie
6. **Sync**: Backend triggers cold-start sync on boot → reads raw OpenCode messages + sessions → populates analytics DB (truncate + bulk insert in transaction)
7. **Dashboard**: User sees hero cards (lifetime spend, window spend, active alerts, pricing coverage), interactive time-series chart (hourly/daily/weekly/monthly), cost and token leaderboards by session, and pricing management panel
8. **Refresh**: User clicks "Refresh" to trigger an on-demand sync refresh; backend spawns a worker process to re-sync from raw OpenCode DB
9. **Pricing management**: User can create, edit, archive, or mark pricing records as manual overrides for models with missing or incorrect pricing
10. **Stop**: `pwsh -File bootstrap.ps1 stop` or use the Backend Management Panel in the dashboard UI

## npm Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server (frontend only, port 41778) |
| `npm run server` | Start Express backend directly via tsx (port 41777) |
| `npm start` | Alias for `npm run server` |
| `npm run build` | Production Vite build → `dist/client/` |
| `npm run check` | TypeScript type checking (`tsc --noEmit`) |
| `npm test` | Run all `*.test.ts` files via Node test runner + tsx |
| `npm run db:generate` | Drizzle Kit migration generation |
