# server/routes/

## Responsibility

The `routes/` directory defines every HTTP endpoint the observatory backend serves. Each file exports a factory function that builds and returns an Express `Router`. Routes handle request parsing, parameter validation, authentication gating, and delegate all business logic to services in `../services/`. No route handler performs direct database I/O beyond the pricing CRUD helpers (which are colocated in `pricing.ts` for transactional integrity).

## Design

### Factory Function Pattern

Every module exports a single function named `<domain>Routes`, accepting at minimum `analyticsDbPath: string` and `pricingDbPath: string` (with `sync.ts` taking `rawDbPath` and `diagnostics.ts` taking `dashboardToken`). These functions receive configuration from `main.ts` and return a fully configured `Router`. There is zero global mutable state.

```
export function overviewRoutes(analyticsDbPath: string, pricingDbPath: string) { ... }
export function pricingRoutes(analyticsDbPath: string, pricingDbPath: string) { ... }
export function syncRoutes(analyticsDbPath: string, rawDbPath: string) { ... }
export function diagnosticsRoutes(analyticsDbPath: string, dashboardToken: string) { ... }
export function leaderboardsRoutes(analyticsDbPath: string, pricingDbPath: string) { ... }
export function seriesRoutes(analyticsDbPath: string, pricingDbPath: string) { ... }
export function healthRoutes() { ... }
```

### Auth Gating

- **No auth**: `health.ts` (`GET /health`) is unconditionally public.
- **Hybrid auth**: `diagnostics.ts` (`GET /backend/diagnostics`) checks auth and returns a reduced payload (`{ auth: { authenticated: false } }`) for unauthenticated callers instead of rejecting.
- **Full auth**: All remaining route families require `requireDashboardToken` middleware, enforced by mount order in `main.ts`.

Auth is validated via `x-dashboard-token` header or `dashboard_auth` cookie. The token is compared against the `DASHBOARD_TOKEN` (or `DASHBOARD_TOKEN_FILE` contents) loaded by `config.ts`.

### Error Handling

Every route handler that touches the analytics database wraps its service call in `tryRespondWithAnalyticsBusy(res, error)`. This helper detects SQLite `SQLITE_BUSY` errors and responds with `503 Service Unavailable` so concurrent writes from the sync worker do not crash the request.

Validation failures return `400 Bad Request` with a structured JSON body:

```json
{ "error": "invalid_leaderboard_request" }
// or
{ "error": "invalid_window", "message": "Window must be a single string value" }
```

Pricing CRUD routes additionally catch `ZodError` from schema parsing and extract the first issue message.

### Validation Patterns

- **Custom parsers**: `parseLimit` (leaderboards), `parseGranularity` / `parseMetrics` (series) validate against allowed sets and return `null` or `NaN` on failure.
- **Zod schemas**: `pricingRecordCreateSchema` and `pricingRecordUpdateSchema` enforce the full shape of pricing records.
- **Window parsing**: `parseDashboardWindowQuery` from `services/window-range` handles the `window` query parameter (e.g., `7d`, `24h`, ISO ranges), throwing on invalid input so the route can translate to a 400.
- **Path params**: `req.params.granularity` (series) and `req.params.id` (pricing) are validated against allowed enumerations or existence checks.

## Flow

### Mount Order (from `main.ts`)

```
1. healthRoutes()              // /health
2. authRoutes(...)             // /auth/*, /api/auth/*
3. diagnosticsRoutes(...)      // /backend/diagnostics, /api/backend/diagnostics
=== requireDashboardToken gate ===
4. overviewRoutes(...)         // /overview/*, /api/overview/*
5. seriesRoutes(...)           // /series/*, /api/series/*
6. leaderboardsRoutes(...)     // /leaderboards/*, /api/leaderboards/*
7. pricingRoutes(...)          // /pricing/*, /api/pricing/*
8. syncRoutes(...)             // /sync/*, /api/sync/*
```

Routes 1-3 are mounted before the auth middleware. Routes 4-8 are mounted after it, so they are gated. All gated routes are also mounted under the `/api` prefix.

### Per-Route Data Flow

1. **Request arrives** -- Express parses path, query, body (via `express.json()`).
2. **Auth check** -- Either the route factory checks `isDashboardRequestAuthenticated` inline (diagnostics) or the `requireDashboardToken` middleware rejects with `401`.
3. **Validation** -- Custom parsers or Zod schemas validate inputs. Bad input returns `400`.
4. **Service call** -- The route calls a named service function from `../services/dashboard-analytics`, `../services/pricing-registry`, or `../services/sqlite-busy`.
5. **Error translation** -- `tryRespondWithAnalyticsBusy` catches SQLite busy. Any other thrown error propagates to Express default error handling.
6. **Response** -- JSON payload serialized with `res.json()`.

### Route Families

| Family | Paths | Auth | Key Parameters |
|--------|-------|------|----------------|
| Health | `GET /health` | None | None |
| Auth | `GET /auth/session`, `POST /auth/localhost-token` | None (POST restricted to loopback) | `body.authFilePath`, `body.token` |
| Diagnostics | `GET /backend/diagnostics` | Hybrid | None |
| Overview | `GET /overview/lifetime` | Full | `?window` (optional time range) |
| Series | `GET /series/:granularity` | Full | `:granularity` (`hourly\|daily\|weekly\|monthly`), `?metrics` (csv), `?window` (optional) |
| Leaderboards | `GET /leaderboards/token-sessions`, `/cost-sessions`, `/expensive-sessions` | Full | `?limit` (positive integer, optional) |
| Pricing | `GET /pricing/records`, `GET /pricing/observed-coverage`, `POST /pricing/refresh`, `POST /pricing/records`, `PUT /pricing/records/:id`, `DELETE /pricing/records/:id` | Full | Zod-validated body for POST/PUT, `:id` for PUT/DELETE |
| Sync | `GET /sync/status`, `POST /sync/refresh` | Full | None |

### Pricing CRUD Specifics

Pricing record management goes beyond simple delegation -- it contains transaction-scoped DB logic colocated in the route file:

- **POST** (`/pricing/records`): Validates body with Zod, calls `insertPricingRecord` (inserts into pricing DB), returns 201.
- **PUT** (`/pricing/records/:id`): Validates body with Zod, calls `updatePricingRecord` which archives the current record (prefixes `id` with `#superseded-{now}-{effectiveTime}-{counter}`), inserts the updated version in a transaction, returns the new record or 404.
- **DELETE** (`/pricing/records/:id`): Soft-deletes by setting `enabled=0` and `superseded_time`, returns `{ deleted: true, tombstoned: true }`.

## Integration

### Dependencies

| Route module | Services imported |
|---|---|
| `health.ts` | None |
| `diagnostics.ts` | `../auth` (`isDashboardRequestAuthenticated`), `../services/dashboard-analytics` (`getSyncRefreshLifecycle`, `readSyncState`), `../services/raw-opencode` (cursor key constants) |
| `overview.ts` | `../services/dashboard-analytics` (`buildOverview`), `../services/sqlite-busy` (`tryRespondWithAnalyticsBusy`), `../services/window-range` (`parseDashboardWindowQuery`) |
| `series.ts` | `../services/dashboard-analytics` (`buildSeries`), `../services/sqlite-busy`, `../services/window-range` |
| `leaderboards.ts` | `../services/dashboard-analytics` (`buildCostSessionLeaderboard`, `buildTokenSessionLeaderboard`), `../services/sqlite-busy` |
| `pricing.ts` | `../services/pricing-registry` (`createPricingRecordDraft`, `sanitizePricingSourceUrl`, types), `../services/dashboard-analytics` (`readPricingRecords`, `readObservedPricingCoverage`), `../services/sqlite-busy`, `../storage/db` (`openAnalyticsDb`), `../storage/pricing-db` (`openPricingDb`), `../storage/schema.sql` (`pricing_record`, `sync_state`), `zod` |
| `sync.ts` | `../services/dashboard-analytics` (`getSyncRefreshLifecycle`, `queueSyncRefresh`, `readSyncState`), `../services/sqlite-busy` |

### Upstream (main.ts)

`main.ts` imports all seven route factory functions and mounts them on the Express app. It passes the three DB path strings (`analyticsDbPath`, `opencodeDbPath`, `pricingDbPath`) and the `dashboardToken` string from `config.ts`. Bootstrap operations (`bootstrapAnalyticsDb`, `ensurePricingRegistryReady`) run before mount to guarantee the databases are ready.

### Upstream (auth.ts)

`auth.ts` is technically a route module in the parent directory, not under `routes/`. It provides:
- `authRoutes()` -- mounted directly by `main.ts` for `/auth/*` and `/api/auth/*`
- `requireDashboardToken()` -- Express middleware used as a mount-level gate
- `isDashboardRequestAuthenticated()` -- used inline by `diagnostics.ts`

### Dual Mounting

All gated route families are mounted at both root (`/`) and under `/api`. This means, for example, `GET /overview/lifetime` and `GET /api/overview/lifetime` both resolve to the same handler. The public routes (health, auth, diagnostics) follow the same pattern.
