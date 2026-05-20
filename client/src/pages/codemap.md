# client/src/pages/

## Responsibility

This folder houses the page-level composition layer for the OpenCode Cost Observatory dashboard. It contains exactly one page component -- `DashboardPage` -- which acts as the **top-level orchestrator**. It does not own data fetching, business logic, or UI rendering details. Instead it:

- Calls `useI18n` and `useDashboardState` to acquire all state, actions, and internationalisation strings.
- Derives UI-specific formatted literals (status text, lag summaries, window badges, granularity labels) from raw state.
- Wires derived values and raw state into child component props, acting as a **prop-injection hub** for the five primary display sections.

The page has no route-awareness, no side-effects of its own, and no internal state beyond what the two hooks provide.

## Design

### Single Default Export, Plus Testable Helpers

`DashboardPage` is the default export. All pure derivation functions are **exported separately** at module scope so they can be unit-tested without mounting the full component tree:

| Export               | Kind        | Purpose                                                |
|----------------------|-------------|--------------------------------------------------------|
| `DashboardPage`      | default     | Page composition component                             |
| `buildStatusText`    | pure fn     | Derive a human-readable status string                  |
| `deriveSystemStateTone` | pure fn  | Derive a tone label (error/loading/unauthenticated/live) |
| `formatLagSummary`   | private fn  | Format lag seconds into compact duration (s/m/h/d)     |
| `formatBackendSyncSummary` | private fn | Combine lag summary with health/delayed tone           |
| `formatWindowSummary`| private fn  | Format window selection with granularity label         |
| `formatWindowBadge`  | private fn  | Format a short badge label for the selected window     |

The private (non-exported) formatters exist to keep the component body lean. They receive typed arguments that decouple them from React lifecycle -- they operate on plain data.

### Prop Plumbing Pattern

Every child component receives its **labels** as a flat object (`labels={{ ... }}`) carrying all user-facing strings. This keeps i18n resolution in the page layer; child components never call `useI18n` directly. The `copy` dictionary from `useI18n` is the single source of truth for all copy.

Numbers and dates are formatted in the page layer too (`Intl.DateTimeFormat`, `toLocaleTimeString`), using the `locale` derived from `useI18n`.

### Component Sections (in order of layout)

```
dashboard-shell
  header
    copy (eyebrow, title, subtitle)
    status grid
      BackendManagementPanel
      LanguageToggle
  HeroCards (5 KPI tiles)
  main-grid
    MainSeriesChart (series explorer + controls)
    SecondaryPanels (cache/pricing/freshness cards)
    LeaderboardTables (cost/token leaders + pricing drilldown)
```

## Flow

### Data Load Cycle

1. `useI18n(language)` returns `{ language, locale, copy, toggleLanguage }`.
2. `useDashboardState(locale)` calls the backend diagnostics endpoint, then (if authenticated) fans out to 7 parallel fetches: overview, series, sync status, cost leaderboard, token leaderboard, pricing records, observed pricing coverage.
3. The hook returns all raw state (`overview`, `series`, `pricingRecords`, …) plus action callbacks (`refresh`, `authenticateBackend`, `archivePricing`, …) and loading/error flags.
4. `DashboardPage` reads the hook's return value and begins deriving.

### Derivation Pass

| Derivation               | Inputs                                           | Output            | Consumer                                      |
|--------------------------|--------------------------------------------------|-------------------|-----------------------------------------------|
| `granularityLabel`       | `granularity` + `copy`                          | localized string  | `formatWindowSummary`                         |
| `statusText`             | `isLoading, isRefreshing, error, authSession, lastLoadedAt...` | status bar string | `BackendManagementPanel.status`               |
| `lastSyncEpochSeconds`   | `syncState.last_sync_time / raw_*_cursor`       | epoch seconds     | `HeroCards.lastSyncEpochSeconds`              |
| `diagnosticLagSeconds`   | `backendDiagnostics.sync.lagSeconds ?? overview.syncLagSeconds` | seconds | `formatBackendSyncSummary`                    |
| `backendHealthLabel`     | `backendStatus` + `copy`                        | "Online"/"Offline"| `BackendManagementPanel.backendHealthLabel`   |
| `formatBackendSyncSummary` | `diagnosticLagSeconds, copy`                  | "Healthy - 5m lag"| `BackendManagementPanel.lagSummary`           |
| `formatWindowSummary`    | `window, granularityLabel, copy`                | "24h - Daily"     | `MainSeriesChart.selectedWindowSummary`       |
| `formatWindowBadge`      | `window, copy`                                  | "24H" / "Custom"  | `HeroCards.labels.selectedWindowBadge`        |

### Props Pass-Through

Each child component receives a subset of the hook return values plus derived labels:

- **HeroCards**: `overview`, `trendPoints` (last 8 cost values from series), `activeAlerts`, `activeAlertItems`, `isLoading`, `lastSyncEpochSeconds`, `locale`, and a `labels` object.
- **BackendManagementPanel**: Auth state, backend status, refresh actions, diagnostics, lag summary, locale.
- **MainSeriesChart**: `series.points`, `series.metadata`, `series.metrics`, window/granularity/metric state + setters, pricing data, and a deeply nested `labels` object with a `controls` sub-object for all UI copy.
- **SecondaryPanels**: `overview`, `series.points`, `pricingRecords`, labels, locale.
- **LeaderboardTables**: `costLeaderboard`, `tokenLeaderboard`, `pricingRecords`, `observedPricingCoverage`, points, locale, pricing CRUD callbacks, pricing coverage data, and a large `labels` object.

## Integration

### Upstream (the hooks it consumes)

| Module                        | Role                                          |
|-------------------------------|-----------------------------------------------|
| `../hooks/useI18n`            | Language switching, locale detection, all UI copy as a `Dictionary` |
| `../hooks/useDashboardState`  | All backend state and async actions (the "everything" hook) |

`useDashboardState` itself depends on `../api/client` (REST client types and functions) and `../lib/dashboard-api-error` / `../lib/dashboard-retry` (error classification and retry logic).

### Downstream (the components it renders)

| Component                | Path                                    | Receives                                                            |
|--------------------------|-----------------------------------------|---------------------------------------------------------------------|
| `HeroCards`              | `../components/HeroCards`               | Overview KPIs, trend points, alert counts, sync lag, labels         |
| `LeaderboardTables`      | `../components/LeaderboardTables`       | Cost/token leaderboards, pricing CRUD, coverage, labels             |
| `LanguageToggle`         | `../components/LanguageToggle`          | Current language, label, toggle callback                            |
| `MainSeriesChart`        | `../components/MainSeriesChart`         | Series points, window/granularity/metric controls, pricing gaps     |
| `BackendManagementPanel` | `../components/BackendManagementPanel`  | Auth, backend lifecycle controls, diagnostics, lag summary          |
| `SecondaryPanels`        | `../components/SecondaryPanels`         | Cache efficiency, pricing coverage, freshness overview              |

### Utility dependency

| Module                      | Role                                              |
|-----------------------------|---------------------------------------------------|
| `../lib/windowSelection`    | `describeWindowSelection` used in `formatWindowSummary` and `formatWindowBadge` for custom window label rendering |

### No routing dependency

This page does not use React Router or any route-level abstraction. It is rendered unconditionally -- the dashboard application is a single-page composition with no client-side navigation.
