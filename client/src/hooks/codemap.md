# client/src/hooks/

## Responsibility

This directory encapsulates the dashboard state-management layer for the OpenCode Cost Observatory client. It owns two concerns:

1. **Global dashboard state** (`useDashboardState`) — the single source of truth consumed by all dashboard page components. It manages query parameters (window, granularity, metric), data fetched from the localhost analytics backend (overview, series, leaderboards, pricing records, sync/diagnostics telemetry), loading/error/refresh lifecycles, backend authentication, backend service control (start/stop/restart), pricing-record CRUD operations, and derived alert items.
2. **Internationalization** (`useI18n`) — a lightweight translation hook providing English (`en`) and Simplified Chinese (`zh`) copies of every visible label in the dashboard UI, along with a language-toggle function.

The hooks are framework-agnostic React hooks. They declare no JSX, no routing, and no context providers — they are designed to be consumed directly by page-level components or passed via props.

## Design

### Pattern: request-tracking gate

Data fetching is guarded by a monotonic request-id system (`createDashboardRequestTracker`) stored in a `useRef`. Before every async fetch the hook issues a new request id; every `await` boundary checks `requestTracker.current.isCurrent(requestId)`. If the user triggers a new load (by changing window, granularity, or initiating a refresh) before an in-flight request completes, the stale callbacks simply discard their results. This prevents out-of-order state overwrites and acts as an implicit cancellation mechanism without needing `AbortController`.

### Pattern: refresh-pair gate

`createRefreshStateTracker()` provides a separate monotonic counter to pair refresh lifecycle management (the `isRefreshing` flag). A `begin()` call at the start of `refresh` and `reload` sets `isRefreshing = true`; the corresponding `shouldSettle()` in the `finally` block sets it back to `false` only when no newer refresh has started. This ensures `isRefreshing` stays true across pipelined refresh→load sequences but correctly resolves when the latest one finishes.

### Pattern: derived alerts (`buildAlertItems`)

Alert generation is a pure function separated from the hook. Given the current state snapshot (`overview`, `error`, `isLoading`, `authenticated`, `backendStatus`, `updateStatus`, `pricingRecordCount`, `locale`), it produces an ordered list of `DashboardAlertItem` objects (id, title, severity, action, detail). The hook wraps this in a `useMemo` that depends on the full state tuple, so alerts recompute only when underlying state changes.

Alert copy lives in a static `ALERT_COPY` record keyed by locale (`en` / `zh`), selected by `alertCopyFor(locale)`. Functions like `pricingCoverageDetail(coverage)` and `syncLagDetail(lagSeconds)` accept numeric values to produce parameterized message strings at the call site.

### Pattern: state reset on auth/backed-offline transitions

When the backend becomes unreachable or unauthenticated, all data-state slices are reset to their empty defaults in a single synchronous batch of `set*` calls. The `markBackendStopped()` callback encapsulates this reset, invalidates the current request tracker (by issuing a new request id), and is reused by `refresh` (on unreachable error) and `checkBackend` (when control status reports "stopped").

### i18n: switchable dictionary

`useI18n` holds `language` in `useState` and derives `copy` from a static `DICTIONARY` record via `useMemo`. Every UI label is a typed key in the `Dictionary` interface, guaranteeing that a missing key in either language is a compile-time error. The hook also derives `locale` (`"en-US"` | `"zh-CN"`) for Intl-compatible consumers (e.g., alert copy selection).

## Flow

### 1. Initial load and re-load cycle

```
useEffect([window, effectiveGranularity])
  |
  v
setIsLoading(true), setError(null)
issue new requestId
  |
  v
loadWithBusyRetry(requestId, window, effectiveGranularity)
  |                                       (retryAnalyticsBusy wraps load with up to 3 retries for 503/analytics_db_busy)
  v
load(requestId, window, granularity)
  |
  +--[1] fetchBackendDiagnostics() ----------------------------------+
  |     |                                                           |
  |     error --> if isCurrent: setBackendStatus("offline"),        |
  |               reset all data, throw (ends load cycle)           |
  |     |                                                           |
  |     success --> setAuthSession, setBackendDiagnostics,          |
  |                 setBackendStatus("authenticated"|"unauthenticated")
  |     |                                                           |
  |     unauthenticated --> reset data, return diagnostics          |
  |     |                                                           |
  |     authenticated -->                                            |
  +--[2] Promise.all([                                              |
        |   fetchOverview(window),                                  |
        |   fetchSeries(granularity, window, [...allMetrics]),       |
        |   fetchSyncStatus(),                                      |
        |   fetchCostLeaderboard(),                                 |
        |   fetchTokenLeaderboard(),                                |
        |   fetchPricingRecords(),                                  |
        |   fetchObservedPricingCoverage(),                         |
        ])                                                          |
        |                                                           |
        if isCurrent: set all data slices, setLastLoadedAt          |
  |
  v
on error (after retries): if cancelled/current -> setError("dashboard_load_failed")
finally: if isCurrent -> setIsLoading(false)
```

### 2. Refresh (synchronous update) cycle

```
refresh()
  |
  setIsRefreshing(true), begin refreshId
  |
  v
requestRefresh() --> setUpdateStatus
  |
  [if status is non-blocking (started/running/requested)]
  |
  poll loop (max 120 x 1s):
    fetchBackendDiagnostics() --> update auth/status
    extract refreshResponseFromDiagnostics() --> setUpdateStatus
  |
  [timeout] --> synthesize "interrupted" status
  |
  v
issue new requestId
loadWithBusyRetry(latestQuery.window, latestQuery.granularity)
  |
  v
on error:
  - unreachable? -> markBackendStopped(), clear error
  - otherwise   -> setUpdateStatus("failed"), setError("dashboard_refresh_failed")
finally:
  if shouldSettle(refreshId) -> setIsRefreshing(false)
```

The poll loop reads the sync lifecycle from successive `/diagnostics` responses (converted via `refreshResponseFromDiagnostics`) and stops when the status becomes terminal (`completed`, `failed`, `interrupted`).

### 3. Authentication flow

```
authenticateBackend(payload?)
  |
  setBackendActionStatus("authenticating")
  |
  v
authenticateWithLocalhostToken(payload)
  |
  success -> setBackendActionStatus("authenticated")
             issue requestId, loadWithBusyRetry(latestQuery)
  error   -> setBackendActionStatus("failed")
             setError("dashboard_auth_failed")
```

Backend control (start/restart/check) follows the same pattern: set transient status, call the API, then `reloadAfterBackendControl()` (which issues a new request id and reloads with the latest query parameters).

### 4. Alert derivation

```
buildAlertItems({ overview, pricingRecordCount, error, isLoading, authenticated, backendStatus, updateStatus, locale })
  |
  if isLoading -> []
  |
  otherwise, ordered checks:         severity    condition
  |-- backend-offline                critical    backendStatus === "offline"
  |-- backend-unauthenticated        warning     !authenticated || backendStatus === "unauthenticated"
  |-- dashboard-error                warning     error is non-null
  |-- pricing-registry-empty         critical    authenticated + data loaded + 0 pricing records
  |-- update-failed                  critical    !offline + updateStatus.status === "failed"
  |-- update-interrupted             warning     !offline + updateStatus.status === "interrupted"
  |-- pricing-coverage               warning     authenticated + data loaded + priceCoverage < 1
  |-- sync-lag                       warning     authenticated/lifecycle meaningful + lag > 15min
```

The first two alerts (offline/unauthenticated) gate the rest — if the backend is offline, subsequent checks that require backend interaction are skipped via the `!offline` guard.

## Integration

### Inbound dependencies

| Source | What the hooks consume |
|---|---|
| `../api/client` | All 14 API fetch functions (`fetchOverview`, `fetchSeries`, `fetchSyncStatus`, `fetchBackendDiagnostics`, `fetchBackendControlStatus`, `fetchCostLeaderboard`, `fetchTokenLeaderboard`, `fetchPricingRecords`, `fetchObservedPricingCoverage`, `requestRefresh`, `authenticateWithLocalhostToken`, `startBackendService`, `restartBackendService`) and all related TypeScript types (`DashboardWindow`, `SeriesGranularity`, `SeriesMetric`, `OverviewResponse`, `SeriesResponse`, `RefreshResponse`, `AuthSessionResponse`, `BackendDiagnosticsResponse`, `BackendControlResponse`, `LeaderboardSession`, `PricingRecordResponse`, `ObservedPricingCoverageRow`, `CreatePricingRecordPayload`, `LocalhostAuthPayload`). |
| `../lib/dashboard-api-error` | `isRetryableAnalyticsBusyError` — classifies 503/analytics_db_busy errors for retry and distinguishes them from unreachable-backend errors. |
| `../lib/dashboard-retry` | `retryAnalyticsBusy` — wraps any async operation with up to 3 retries (250/500/750 ms backoff) when the error is a retryable 503. |

### Outbound consumers (typical)

- **Page components** — the dashboard route (`/`) imports `useDashboardState` and `useI18n`, destructures the returned state bag, and distributes slices to child components (chart, leaderboards, pricing panels, status bar, alert banner, window/granularity controls).
- **Alert banner** — renders `activeAlertItems` in priority order.
- **Window/Granularity/Metric controls** — call `setWindow`, `setGranularity`, `setMetric`; the `useEffect` dependency on `[window, effectiveGranularity]` triggers a new load.
- **Backend control buttons** — call `checkBackend`, `startBackend`, `restartBackend` and read `backendControlStatus` for UI state.
- **Pricing management panels** — call `archivePricing`, `markPricingManual`, `savePricing`, `createPricing`; each mutates via API then calls `reload()` to re-fetch pricing records.

### No context provider

The hooks do not wrap state in React Context. The dashboard page is expected to instantiate the hooks once at the top level and thread state via props. This keeps the hook module free of architectural assumptions about how the page tree is organized — the consuming page owns the integration topology.
