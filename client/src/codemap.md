# client/src/

## Responsibility

A single-page React dashboard (the "OpenCode Cost Observatory") that visualizes token usage and cost telemetry from a local OpenCode analytics store. It surfaces lifetime/window spend, token flow over time, sync health, pricing coverage, and per-session leaderboards. The dashboard also provides local backend lifecycle management (start/restart/authenticate) and a full pricing-record CRUD UI so operators can inspect, edit, and create model pricing directly from the browser. The entire UI is localhost-only and expects a Vite-dev-server-hosted backend on the same origin.

## Design Patterns / Architecture

| Pattern | Where | Why |
|---|---|---|
| **Single-page app (SPA) with a single page component** | `App.tsx` renders only `<DashboardPage />` | No routing needed -- one dashboard is the entire product. |
| **Custom hook as state machine** | `useDashboardState` owns all async fetching, polling, and derived state | Centralizes the complex interplay of auth, backend health, window/filter changes, refresh lifecycles, and pricing mutations so the page component stays declarative. |
| **Composable function components with label-injection** | Every component receives a `labels` (or `copy`) prop with all UI strings; internal copy functions handle zh/en inline | Enables full bilingual (en/zh) support without an external i18n library. Components never hard-code user-facing strings. |
| **Request deduplication via request tracker** | `createDashboardRequestTracker()` issues monotonically increasing request IDs; stale callbacks are silently dropped | Prevents out-of-order state updates when the user rapidly changes window/granularity. |
| **Refresh lifecycle with poll-and-settle** | `refresh()` POSTs a sync request, then polls backend diagnostics every 1s (up to 120 attempts) until the lifecycle reaches a terminal status | The sync operation is async server-side; the client wait-loops for completion then reloads all data. |
| **Busy-retry decorator** | `retryAnalyticsBusy()` wraps any async function and retries up to 3 times with exponential backoff on 503 `analytics_db_busy` errors | Handles SQLite contention without surfacing transient errors to the user. |
| **Collapsible disclosure panels** | `<CollapsiblePanel>` wraps chart details, insight rail sections, leaderboards, and pricing drilldowns | Conserves vertical space on a dense dashboard; panels default-open so information is visible by default. |
| **SVG chart rendered inline** | `MainSeriesChart` builds bar + polyline SVGs entirely in JSX (no chart library) | Keeps the bundle zero-dependency and gives full control over the retro-terminal aesthetic. |
| **Generic `ControlGroup` and `pill-button` pattern** | Used in `TimeControls` for preset window, granularity, and metric toggles; requires `aria-pressed` and `ControlGroup` abstraction | Consistent toggle-button UX with active-state styling via `.pill-button--active`. |

## Data & Control Flow

### Startup / Auth Bootstrap

1. `useDashboardState` mounts, sets `isLoading = true`, and calls `load()`.
2. `load()` fetches `GET /api/backend/diagnostics` first.
   - **If unreachable**: all state is reset to empty/offline; alerts fire for "backend offline".
   - **If reachable but unauthenticated**: sets `backendStatus = "unauthenticated"`, stops -- no data queries fire.
   - **If authenticated**: proceeds to parallel data fetch.
3. On authenticated path, `Promise.all` fetches seven endpoints simultaneously:
   - `GET /api/overview/lifetime?window=...`
   - `GET /api/series/{granularity}?metrics=...&window=...`
   - `GET /api/sync/status`
   - `GET /api/leaderboards/cost-sessions?limit=5`
   - `GET /api/leaderboards/token-sessions?limit=5`
   - `GET /api/pricing/records`
   - `GET /api/pricing/observed-coverage`

### Window / Granularity Changes

- When the user changes `window` or `granularity`, a `useEffect` re-triggers `load()` with a new request ID.
- The `requestTracker` invalidates any in-flight requests from the previous effect run.
- `windowSelectionToQuery()` serializes preset (`24h|7d|30d|90d|all`) or custom (`start/end` date strings) into URLSearchParams.

### Refresh (Sync Update)

- User clicks the "Update" button -> `refresh()` called.
- `POST /api/sync/refresh` triggers backend sync.
- If the response status is non-terminal (`started`, `running`, `requested`), the client polls `GET /api/backend/diagnostics` every 1s to read `sync.lifecycle.status`.
- After 120 attempts without a terminal status, the refresh is marked `interrupted`.
- On any terminal status (or timeout), `load()` re-fetches all data channels.

### Pricing CRUD

- `archivePricing(id)`: `DELETE /api/pricing/records/:id` then `reload()`.
- `markPricingManual(record)`: `PUT /api/pricing/records/:id` with `sourceType: "manual"` and `isManualOverride: true` then `reload()`.
- `savePricing(record, patch)`: `PUT /api/pricing/records/:id` with merged patch then `reload()`.
- `createPricing(payload)`: `POST /api/pricing/records` (from gap-fill form in Missing Pricing panel) then `reload()`.
- `reload()` is a lighter reload that respects the current auth session; it skips if not authenticated.

### Alert Derivation

`buildAlertItems()` runs as a `useMemo` over overview, pricing count, error, auth, backend status, and update status. It emits alerts for:
- Backend offline (critical)
- Unauthenticated (warning)
- Load error (warning)
- Pricing registry empty (critical)
- Update failed (critical)
- Update interrupted (warning)
- Pricing coverage < 100% (warning)
- Sync lag > 15 minutes (warning)

Alerts are rendered in the Hero Cards section (alert column) and drive the alert count badge.

### Backend Management

- `checkBackend()`: `GET /__observatory/backend/status`; if response reports "stopped", marks backend offline.
- `startBackend()`: `POST /__observatory/backend/start` then reloads.
- `restartBackend()`: `POST /__observatory/backend/restart` then reloads.
- `authenticateBackend(payload)`: `POST /api/auth/localhost-token` then reloads.

### Rendering Pipeline

```
useI18n() -> copy (Dictionary)
useDashboardState(locale) -> all data + action callbacks
  |
  v
DashboardPage
  |-- buildStatusText()        -> header status string
  |-- deriveSystemStateTone()  -> (unused in page but exported)
  |-- formatLagSummary()       -> backend sync lag display
  |-- formatWindowSummary()    -> chart sub-header
  |-- formatWindowBadge()      -> hero card chip
  |
  |-- <HeroCards>              (lifetime spend, alerts, coverage)
  |-- <BackendManagementPanel> (auth form, start/restart, refresh button)
  |-- <LanguageToggle>         (en/zh switcher)
  |-- <MainSeriesChart>        (SVG bar chart + polyline + insight rail)
  |     |-- <TimeControls>     (preset window, custom date range, granularity)
  |     |-- <CollapsiblePanel> (bucket details table)
  |-- <SecondaryPanels>        (cache efficiency, pricing coverage, effective cost)
  |-- <LeaderboardTables>      (cost sessions, token sessions, pricing drilldown,
  |                              observed coverage, freshness, missing pricing)
```

## Integration Points

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/backend/diagnostics` | GET | Auth state + sync lifecycle + backend health (always called first) |
| `/api/overview/lifetime?window=` | GET | Lifetime tokens, lifetime/window spend, price coverage, sync lag, pricing gaps |
| `/api/series/{granularity}?metrics=&window=` | GET | Time-bucketed token and cost data points |
| `/api/sync/status` | GET | Raw sync state cursors |
| `/api/sync/refresh` | POST | Trigger a backend sync update (async) |
| `/api/auth/session` | GET | Current auth session status |
| `/api/auth/localhost-token` | POST | Authenticate with a localhost token or `.run/dashboard.token` file path |
| `/api/leaderboards/cost-sessions?limit=5` | GET | Top 5 most expensive sessions |
| `/api/leaderboards/token-sessions?limit=5` | GET | Top 5 highest-token sessions |
| `/api/pricing/records` | GET | All pricing records (enabled, superseded, manual, etc.) |
| `/api/pricing/records/:id` | PUT | Update a pricing record |
| `/api/pricing/records/:id` | DELETE | Archive/delete a pricing record |
| `/api/pricing/records` | POST | Create a new pricing record |
| `/api/pricing/observed-coverage` | GET | Observed provider/model -> pricing resolution status |
| `/api/pricing/refresh` | POST | Refresh pricing registry |
| `/__observatory/backend/status` | GET | Vite-local backend control status |
| `/__observatory/backend/start` | POST | Start backend via Vite control endpoint |
| `/__observatory/backend/restart` | POST | Restart backend via Vite control endpoint |

All API calls are made through `readJson<T>()`, a thin wrapper around `fetch` that:
- Sends `credentials: "include"` and `content-type: application/json`
- Parses JSON responses (or handles non-JSON error bodies)
- Throws `DashboardApiError` on non-2xx responses, carrying `status`, `code`, `retryable`, and raw `payload`

The `retryAnalyticsBusy()` utility wraps calls with up to 3 retries on `503 / analytics_db_busy / retryable: true` errors.

The frontend has no routing library, no state management library (pure React useState/useRef), and no charting library. The only runtime dependency beyond React is the browser's `Intl` API for number/date formatting.

## Key Files

| File | Role |
|---|---|
| `main.tsx` | React 18 entry point; mounts `<App />` with `<StrictMode>` |
| `App.tsx` | Root component; renders `<DashboardPage />` |
| `pages/DashboardPage.tsx` | Page composition: assembles header, hero cards, chart, secondary panels, leaderboard tables; owns formatting helpers (`buildStatusText`, `formatLagSummary`, etc.) |
| `hooks/useDashboardState.ts` | Central state hook: all `useState` fields, `load()`/`refresh()`/`reload()`, request tracking, refresh lifecycle polling, backend control actions, alert derivation via `buildAlertItems()` |
| `hooks/useI18n.ts` | Language toggle + full en/zh dictionary (`Dictionary` type); returns `{ language, locale, copy, toggleLanguage }` |
| `api/client.ts` | All API endpoint functions (`fetchOverview`, `fetchSeries`, `requestRefresh`, `fetchPricingRecords`, etc.) + full TypeScript types for every response shape; `readJson` fetch wrapper |
| `lib/windowSelection.ts` | `DashboardWindowSelection` discriminated union (`preset` with `24h\|7d\|30d\|90d\|all` or `custom` with `start`/`end` date strings); `windowSelectionToQuery()` serialization; `isValidCustomWindow()` |
| `lib/dashboard-api-error.ts` | `DashboardApiError` class + `isRetryableAnalyticsBusyError()` guard |
| `lib/dashboard-retry.ts` | `retryAnalyticsBusy()` -- retries any async operation on 503 busy errors with exponential backoff (250ms, 500ms, 750ms) |
| `lib/pricingIdentity.ts` | `deriveManualPricingIdentity()` -- normalizes provider/model IDs into canonical form with vendor inference for manual pricing record creation |
| `components/HeroCards.tsx` | Top-row cards: lifetime spend (with sparkline trend, window-spend chip, lifetime share %), active alerts list, price coverage % |
| `components/MainSeriesChart.tsx` | Primary data visualization: inline SVG bar chart + cost polyline overlay + collapsible bucket-detail table + insight rail (spike diagnostics, window overview, pricing issues) |
| `components/TimeControls.tsx` | Time window selector (preset buttons + custom date-range inputs), granularity toggle (hourly/daily/weekly/monthly), metric toggle (cost/input/output/reasoning/cache) |
| `components/BackendManagementPanel.tsx` | Backend health status display, local-token auth form (token + file path inputs), start/restart/check backend buttons, refresh button with status |
| `components/LeaderboardTables.tsx` | Five collapsible panels: Most Expensive Sessions, Highest Token Sessions, Pricing Drilldown (editable price cards with save/manual/archive actions), Observed Provider Coverage, Pricing Freshness, Missing Pricing (with gap-fill creation form) |
| `components/SecondaryPanels.tsx` | Cache efficiency %, pricing coverage %, effective cost per 1M tokens (with formula explanation) |
| `components/CollapsiblePanel.tsx` | Generic expand/collapse container with ARIA attributes, keyboard support, scrollable body option |
| `components/RefreshButton.tsx` | "Update" button with disabled states (loading, unauthenticated, offline) and live status text |
| `components/LanguageToggle.tsx` | Simple button that calls `toggleLanguage()` from `useI18n` |
| `index.css` | Full application stylesheet: dark theme with CSS custom properties, grid layout, backdrop gradient, SVG chart styling, pill/toggle buttons, pricing cards, collapsible panels, Chinese-language typography overrides, responsive breakpoint at 1080px, reduced-motion support |
