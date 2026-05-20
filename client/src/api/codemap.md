# client/src/api/

## Responsibility

The API client layer is the **typed HTTP fetch wrapper** for the Cost Observatory dashboard. It owns all client-to-server communication: constructing requests, serializing parameters, handling cookie-based authentication, parsing JSON responses, and propagating errors in a typed, predictable way. Every backend endpoint the dashboard calls has exactly one exported function here, paired with its response type definition.

## Design

### Core fetch wrapper: `readJson<T>`

A single generic function (not exported) that wraps the native `fetch` API:

- **Credentials**: Injects `credentials: "include"` on every request so the browser sends the session cookie for authentication.
- **Content-type**: Merges `content-type: application/json` into the headers (preserving any caller-supplied overrides).
- **JSON parsing**: Calls `response.json()`. If parsing fails on a non-OK response, the error body is silently replaced with `null` so the error path still gets a usable status code.
- **Error propagation**: On any non-OK response, inspects the parsed payload for an `error` string and a `retryable` boolean, then throws a `DashboardApiError` with the HTTP status, error code, retryable flag, and full payload for upstream handling.

### Endpoint functions

Every backend route is exposed as a named, async function. Each function:

1. Accepts typed parameters (if any).
2. Builds the URL with `URLSearchParams` (using the imported `windowSelectionToQuery` helper for time-window parameters).
3. Calls `readJson<T>` with the constructed URL and optional `RequestInit` (method, body, headers).
4. Returns the typed response.

**Function signature conventions**:

| Verb-prefix | HTTP method | Example |
|---|---|---|
| `fetch*` | GET | `fetchOverview` |
| `request*` | POST (fire-and-forget-ish) | `requestRefresh` |
| `create*` | POST (create resource) | `createPricingRecord` |
| `update*` | PUT | `updatePricingRecord` |
| `delete*` | DELETE | `deletePricingRecord` |
| `authenticate*` | POST (auth-specific) | `authenticateWithLocalhostToken` |
| `refresh*` | POST (trigger side-effect) | `refreshPricingRecords` |
| `start*` / `restart*` | POST (backend control) | `startBackendService` |

### Endpoint families

| Family | URL prefix | Functions | Purpose |
|---|---|---|---|
| Overview | `/api/overview/` | `fetchOverview` | Lifetime + window cost/token summary |
| Series | `/api/series/` | `fetchSeries` | Time-series metrics (hourly/daily/weekly/monthly) |
| Sync | `/api/sync/` | `fetchSyncStatus`, `requestRefresh` | Sync state monitoring + manual refresh trigger |
| Auth | `/api/auth/` | `fetchAuthSession`, `authenticateWithLocalhostToken` | Session check + localhost token login |
| Backend diagnostics | `/api/backend/` | `fetchBackendDiagnostics` | Health/status diagnostics |
| Backend control | `/__observatory/backend/` | `fetchBackendControlStatus`, `startBackendService`, `restartBackendService` | Lifecycle control of the backend process (requires `x-observatory-control` header) |
| Leaderboards | `/api/leaderboards/` | `fetchCostLeaderboard`, `fetchTokenLeaderboard` | Top sessions by cost or tokens |
| Pricing | `/api/pricing/` | `fetchPricingRecords`, `fetchObservedPricingCoverage`, `refreshPricingRecords`, `createPricingRecord`, `updatePricingRecord`, `deletePricingRecord` | CRUD for pricing records + coverage report |

### Types

All response types are co-located in `client.ts`. Key types:

- **`OverviewResponse`** -- Dashboard summary (lifetime tokens/spend, window spend, coverage %, sync lag).
- **`SeriesResponse`** -- Time-series data with `points[]`, each containing token/cost buckets and optional `pricedTokens`/`unpricedTokens` fields.
- **`RefreshResponse`** + **`SyncLifecycle`** -- Sync job status with full lifecycle tracking (requested/started/completed/failed timestamps, counts, errors).
- **`BackendDiagnosticsResponse`** -- Nested health object (`backend`, `auth`, `sync`, `update`).
- **`PricingRecordResponse`** -- Canonical pricing record with `reasoningBillingRule` sub-object, `sourceType`, `confidence`, and effective/superseded time window.
- **`ObservedPricingCoverageResponse`** -- Pricing coverage gaps: which provider/model combinations lack pricing.
- **`DashboardWindow`** -- Re-exported alias of `DashboardWindowSelection`.
- **`LocalhostAuthPayload`** -- Token or auth file path for local development login.

The `CreatePricingRecordPayload` type is derived via `Omit` from `PricingRecordResponse`, excluding server-managed fields (`observedTime`, `enabled`, `supersededTime`).

## Flow

```
Caller (React hook / component)
  |
  v
fetchOverview(window)          // typed public function
  |
  +-- windowSelectionToQuery(window) --> URLSearchParams
  |
  v
readJson<OverviewResponse>("/api/overview/lifetime?...")
  |
  +-- fetch(url, { credentials: "include", headers: { "content-type": "application/json" }, ...init })
  |
  +-- response.ok? 
  |     YES --> return response.json() as T
  |     NO  --> extract error/retryable from body
  |             throw new DashboardApiError(status, code, retryable, payload)
  |
  v
Caller receives typed T  OR  catches DashboardApiError
```

Key flow details:

1. **Window parameters**: The `windowSelectionToQuery` helper (from `../lib/windowSelection`) converts a `{ mode: "preset", preset: "30d" }` or `{ mode: "custom", start, end }` object into `URLSearchParams` (`?window=30d` or `?window=custom&start=...&end=...`).
2. **Auth cookie**: Every request sends `credentials: "include"`. The browser attaches the session cookie automatically. For local development, `authenticateWithLocalhostToken` POSTs a token (or reads `authFilePath`) to establish a session.
3. **Error normalization**: All HTTP errors (4xx, 5xx) become `DashboardApiError` instances. Upstream code (e.g., React Query hooks) can inspect `status`, `code`, and `retryable` to decide whether to retry. The helper `isRetryableAnalyticsBusyError()` from `../lib/dashboard-api-error` identifies the specific 503 / `analytics_db_busy` retryable case.
4. **Backend control**: The `/__observatory/backend/*` endpoints require the custom header `x-observatory-control: 1` and are POST-only. These manage the backend process itself (start, restart, status).

## Integration

### Dependencies (imports from)

| Module | What is imported | Purpose |
|---|---|---|
| `../lib/windowSelection` | `windowSelectionToQuery`, `DashboardWindowSelection` | Convert time-window presets or custom ranges to query parameters |
| `../lib/dashboard-api-error` | `DashboardApiError` | Typed error class thrown on non-OK responses |

### Consumers (who depends on this)

- React hooks in `client/src/hooks/` (or similar) that call these functions to fetch data for the dashboard UI.
- React components that trigger mutations (create/update/delete pricing records, request sync refresh, authenticate).

### Runtime dependencies

- **Browser `fetch` API**: No external HTTP library. All requests use the native `fetch` global.
- **Cookie-based session**: Relies on the browser's automatic cookie handling via `credentials: "include"`. The backend sets the session cookie on successful authentication.

### Error contract

All functions in this layer either:
- **Resolve** with the typed response `T`, or
- **Throw** a `DashboardApiError` with `status`, `code`, `retryable`, and the raw `payload`.

No function in this layer catches errors or performs retries -- that responsibility belongs to callers (typically React Query or similar data-fetching infrastructure).
