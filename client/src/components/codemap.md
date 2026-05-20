# client/src/components/

## Responsibility

The components directory contains all **presentational and dashboard-UI components** for the OpenCode Cost Observatory. Every component is a pure React function component that receives data, labels, and action callbacks exclusively through props -- no component owns data fetching, state management, or business logic. Their sole job is to render the dashboard layout: hero summary cards, an inline SVG time-series chart with interactive controls, collapsible detail panels for session leaderboards and pricing CRUD, secondary stat panels, a backend-management console, and chrome-level UI toggles (language, refresh). The components collectively surface token usage, cost telemetry, sync health, pricing coverage, and per-session rankings in a bilingual (en/zh) retro-terminal aesthetic.

## Design

### Universal Label-Injection i18n

Every component receives a `labels` object (sometimes named `copy`) containing every user-facing string it renders. Components **never hard-code English or Chinese strings**. Bilingual support is delivered through two mechanisms:

- **Inline helper functions** (`localCopy(locale)`, `chartCopy(locale)`) that return a zh/en dictionary keyed by the `locale` prop, checked via `typeof locale === "string" && locale.startsWith("zh")`.
- **Parent-provided `labels` props** (`labels.expensiveSessions`, `labels.chartTitle`, etc.) that the page-level component (`DashboardPage`) populates from the `useI18n` dictionary and passes down.

This design avoids any external i18n library while keeping all translatable strings discoverable at the page composition site.

### CollapsiblePanel as Universal Disclosure

`<CollapsiblePanel>` is the dashboard's primary vertical-space management primitive. It wraps chart detail tables, insight-rail sections, all five leaderboard panels, the pricing drilldown, and the effective-cost panel. Key behaviors:

- Controlled open/collapsed state via `useState`, toggled by a button with `aria-controls`, `aria-expanded`, and keyboard support (Enter/Space).
- Accepts `summary` (ReactNode) shown inline in the header, `defaultOpen` (defaults `true`), and `scrollBody` for constrained-height scrollable content areas.
- Generates accessible IDs via `useId()` for `aria-labelledby` relationships.
- Used by: `MainSeriesChart`, `LeaderboardTables`, `SecondaryPanels`.

| Component | Where It Uses CollapsiblePanel |
|---|---|
| `MainSeriesChart` | Bucket-detail footer table + three insight-rail blocks (anomaly alerts, window overview, pricing issues) |
| `LeaderboardTables` | Five disclosure sections: cost sessions, token sessions, pricing drilldown, observed coverage, freshness, missing pricing |
| `SecondaryPanels` | Effective-cost-per-million-tokens panel with formula explanation |

### Inline SVG Chart (No Library)

`MainSeriesChart` renders a custom bar chart with a cost-polyline overlay entirely in JSX `<svg>` elements. No charting library is imported. This zero-dependency approach gives full control over the retro-terminal styling and keeps the bundle small. Key rendering decisions:

- **Bars**: `<rect>` per time bucket, positioned by `xForPoint()` (time-scaled x-axis) and `yForValue()` (linear y-axis). Bar width dynamically clamped between 4px and 28px. Zero-activity bars get a `.chart-token-bar--zero` class.
- **Polyline overlay**: A `<polyline>` connecting all bar tops, built by `buildPolyline()`, rendered in a contrasting accent color.
- **Grid lines**: Four horizontal grid lines at 0, 1/3, 2/3, and max, with y-axis labels.
- **X-axis ticks**: Smart tick selection via `buildXAxisTicks()` that picks up to 5 evenly-spaced labels, enforces a 72px minimum spacing, and clamps first/last labels within the plot area with appropriate `text-anchor` (`start`/`middle`/`end`).
- **Time scaling**: Buckets are positioned proportionally to real time (not just index-order) when `rangeStart`/`rangeEnd` metadata is available, using `bucketOverlapsRange()` for filtering.
- **Accessibility**: Every SVG has a `<desc>` and `role="img"` with `aria-label`; each bar has a `<title>` tooltip; the empty state renders an annotated empty chart skeleton.

### ControlGroup + Pill-Button Toggle Pattern

`TimeControls` defines a reusable `<ControlGroup>` sub-component that renders a labeled row of `<button>` elements with:
- `aria-pressed` for active state
- `.pill-button` / `.pill-button--active` CSS classes
- Optional `disabled` per option

This pattern is used for window presets (24h/7d/30d/90d/all), granularity (hourly/daily/weekly/monthly), and metric toggles. `MainSeriesChart` also renders its own metric toggle row using the same `pill-button` pattern directly, since `TimeControls` delegates metric display to the chart header.

### Pricing Card Pattern (Editable Records)

`LeaderboardTables` defines a reusable "pricing card" layout used in two contexts:
1. **Pricing Drilldown panel**: Editable cards for existing enabled pricing records with inline input fields, save/manual/archive actions.
2. **Observed Provider Coverage panel**: Read-only cards showing resolution status for observed provider/model pairs.
3. **Missing Pricing panel**: Gap-fill cards with inline input fields and a "Create" button that submits via `onCreatePricing`.

Both editable contexts use `useState<Record<string, DraftState>>` to manage per-item form state without re-rendering unrelated rows. Drafts are initialized from the current record values or from gap metadata.

### Formatters as Module-Level Functions

Formatting helpers (`formatUsd`, `formatPercent`, `formatCompactNumber`, `formatUnixTime`, `formatBucketLabel`, `formatMetricValue`, etc.) are defined as **top-level functions within each component file**, not imported from a shared utility module. This colocation keeps each component self-contained. The `Intl` browser API handles all locale-aware number/date formatting; no external formatting library is used.

### Hero Card Sparkline

`HeroCards` renders an inline SVG sparkline (180x48 viewBox) in the lifetime-spend card using `buildSparkline()`, which normalizes trend point values into a `<polyline>` coordinate string. When no trend data exists, it falls back to a `--` placeholder.

## Flow

### Data Flow (Top-Down)

```
useDashboardState (hooks/)
  produces: overview, points, costSessions, tokenSessions, pricingRecords, 
            pricingCoverageGaps, observedCoverage, diagnostics, alerts, etc.
  produces: action callbacks (onRefresh, onWindowChange, onGranularityChange,
            onMetricChange, onAuthenticate, onArchivePricing, etc.)
    |
    v
DashboardPage (pages/)
  formats derived strings (buildStatusText, formatLagSummary, 
                         formatWindowSummary, formatWindowBadge)
  maps copy (Dictionary) into per-component labels objects
    |
    v
  +--> HeroCards              (overview, trendPoints, alertItems, labels)
  +--> BackendManagementPanel (auth state, diagnostics, refresh, backend controls, labels)
  +--> LanguageToggle         (language, onToggle)
  +--> MainSeriesChart        (points, metadata, window, granularity, metric, 
  |      +--> TimeControls     chart labels, insight labels, callbacks)
  |      +--> CollapsiblePanel x4 (bucket details, anomaly alerts, window overview, pricing issues)
  +--> SecondaryPanels        (overview, points, pricingRecords, labels)
  +--> LeaderboardTables      (costSessions, tokenSessions, pricingRecords,
         +--> CollapsiblePanel x6  coverage, gaps, CRUD callbacks, labels)
```

### Control Flow (Bottom-Up)

Every user interaction raises a callback prop, never mutates shared state internally:

| Interaction | Component | Callback | Destination |
|---|---|---|---|
| Change time window preset | `TimeControls` | `onWindowChange(preset)` | `useDashboardState` → triggers `load()` |
| Change custom date range | `TimeControls` | `onWindowChange(custom)` | `useDashboardState` → triggers `load()` |
| Change granularity | `TimeControls` | `onGranularityChange(value)` | `useDashboardState` → triggers `load()` |
| Change metric | `MainSeriesChart` | `onMetricChange(value)` | `useDashboardState` → triggers `load()` |
| Click "Update" | `RefreshButton` | `onRefresh()` | `useDashboardState` → `refresh()` |
| Submit auth token | `BackendManagementPanel` | `onAuthenticate(payload)` | `useDashboardState` → `authenticateBackend()` |
| Start/restart backend | `BackendManagementPanel` | `onStartBackend()` / `onRestartBackend()` | `useDashboardState` |
| Toggle language | `LanguageToggle` | `onToggle()` | `useI18n` → `toggleLanguage()` |
| Save/edit pricing | `LeaderboardTables` | `onSavePricing(record, patch)` | `useDashboardState` → `savePricing()` → `reload()` |
| Archive pricing | `LeaderboardTables` | `onArchivePricing(id)` | `useDashboardState` → `archivePricing()` → `reload()` |
| Mark pricing manual | `LeaderboardTables` | `onMarkPricingManual(record)` | `useDashboardState` → `markPricingManual()` → `reload()` |
| Create pricing from gap | `LeaderboardTables` | `onCreatePricing(payload)` | `useDashboardState` → `createPricing()` → `reload()` |

### Local State (Component-Internal)

Components own **only UI ephemera**, never business data:

| Component | Local State | Purpose |
|---|---|---|
| `CollapsiblePanel` | `open: boolean` | Expand/collapse toggle |
| `BackendManagementPanel` | `token`, `authFilePath` | Auth form input values |
| `TimeControls` | `draftStart`, `draftEnd` | Custom date-range input values (synced from props on window change) |
| `LeaderboardTables` | `drafts: Record<id, DraftState>` | Per-record edit-form values for pricing drilldown and gap-fill forms |
| `MainSeriesChart` | (none) | Fully prop-driven |
| `HeroCards` | (none) | Fully prop-driven |
| `SecondaryPanels` | (none) | Fully prop-driven |
| `RefreshButton` | (none) | Fully prop-driven |
| `LanguageToggle` | (none) | Fully prop-driven |

### Loading & Empty States

Every data-displaying component handles three states:
1. **Loading**: `isLoading` prop → shows `"..."` or a localized loading label (e.g., `loadingLabel` or `"Loading"` / `"加载中"`).
2. **Empty/No Data**: Either a dedicated empty message (`"No sessions"`, `"No series"`, `"No activity"`) or an annotated empty SVG skeleton for the chart.
3. **Data Present**: Full rendering with formatted values.

`RefreshButton` disables itself when `isLoading`, `isRefreshing`, `!isAuthenticated`, or `!isBackendOnline`, and shows a status string.

`BackendManagementPanel` conditionally renders the auth form when unauthenticated, backend control buttons when offline, and the refresh button always.

### Insight Rail (Chart Sidebar)

`MainSeriesChart` renders a right-side `<aside className="insight-rail">` containing three `CollapsiblePanel` sections:
1. **Anomaly Alerts**: Spike diagnostics computed by `buildSpikeDiagnostics()` -- median-based threshold (3x median), up to 3 highest spikes listed with bucket label and formatted value.
2. **Top Model Share / Window Overview**: Bucket count, selected-metric total, and total token activity for the current window.
3. **Pricing Issues**: Coverage percentage, enabled pricing record count, and per-gap detail list (provider/model, token count, message count, reason, hint, first/last seen timestamps).

## Integration

### API Type Dependencies

All components import TypeScript types from `../api/client` for prop typing:

| Component | Types Imported |
|---|---|
| `BackendManagementPanel` | `BackendDiagnosticsResponse`, `RefreshResponse`, `LocalhostAuthPayload`; imports `normalizeLocalhostAuthPayload` |
| `HeroCards` | `OverviewResponse`; imports `DashboardAlertItem` from `../hooks/useDashboardState` |
| `MainSeriesChart` | `SeriesPoint`, `SeriesMetric`, `PricingCoverageGap`, `PricingRecordResponse`; imports `DashboardWindow` from `../hooks/useDashboardState` |
| `TimeControls` | `SeriesGranularity`, `SeriesMetric` (from api/client); `DashboardWindow`, `PresetWindow` (from hooks/lib); `isValidCustomWindow` (from `../lib/windowSelection`) |
| `LeaderboardTables` | `LeaderboardSession`, `PricingRecordResponse`, `ObservedPricingCoverageRow`, `PricingCoverageGap`, `CreatePricingRecordPayload`; imports `deriveManualPricingIdentity` from `../lib/pricingIdentity` |
| `SecondaryPanels` | `OverviewResponse`, `PricingRecordResponse`, `SeriesPoint` |
| `RefreshButton` | (none -- primitive boolean/string props) |
| `LanguageToggle` | `DashboardLanguage` from `../hooks/useI18n` |
| `CollapsiblePanel` | (none -- generic ReactNode props) |

### Import Graph

```
CollapsiblePanel  <-- MainSeriesChart, LeaderboardTables, SecondaryPanels
TimeControls      <-- MainSeriesChart
RefreshButton     <-- BackendManagementPanel

api/client types  <-- HeroCards, MainSeriesChart, TimeControls, 
                      LeaderboardTables, SecondaryPanels, BackendManagementPanel

hooks/useDashboardState  <-- HeroCards (DashboardAlertItem), MainSeriesChart (DashboardWindow),
                             TimeControls (DashboardWindow)

hooks/useI18n     <-- LanguageToggle (DashboardLanguage)

lib/windowSelection   <-- TimeControls (isValidCustomWindow, PresetWindow)
lib/pricingIdentity   <-- LeaderboardTables (deriveManualPricingIdentity)
```

### Component Size & Complexity Summary

| Component | Lines | Internal Formatters | Internal Sub-components | Local State |
|---|---|---|---|---|
| `MainSeriesChart` | ~798 | 15+ pure functions | (none) | None |
| `LeaderboardTables` | ~486 | 3 formatters + `localCopy` | (none) | 2 `useState` (drafts, gapDrafts) |
| `TimeControls` | ~201 | (none) | `ControlGroup` | 2 `useState` (draftStart, draftEnd) |
| `HeroCards` | ~182 | 5 formatters + `calculateLifetimeShare` + `buildSparkline` | (none) | None |
| `BackendManagementPanel` | ~146 | 2 formatters + `lifecycleFrom` | `RefreshButton` | 2 `useState` (token, authFilePath) |
| `SecondaryPanels` | ~87 | 2 formatters + `localCopy` | (none) | None |
| `CollapsiblePanel` | ~70 | (none) | (none) | `useState` (open) |
| `RefreshButton` | ~12 | (none) | (none) | None |
| `LanguageToggle` | ~9 | (none) | (none) | None |

### Page Integration (from DashboardPage)

`DashboardPage` is the sole consumer of all components. It:
1. Calls `useI18n()` → `copy` dictionary
2. Calls `useDashboardState(locale)` → all data + all callbacks
3. Derives formatted strings via helper functions (`buildStatusText`, `formatLagSummary`, `formatWindowSummary`, `formatWindowBadge`)
4. Maps `copy` into per-component label objects (including nested `controls` for `TimeControls`)
5. Renders the full page layout grid: header → hero cards + backend panel + language toggle → chart + time controls → secondary panels → leaderboard tables

No component knows about `DashboardPage` or the existence of any sibling component -- they are all pure leaf renderers.

### Style Integration

All components use CSS classes defined in `index.css` with a consistent BEM-like naming convention:
- `hero-card`, `hero-card__label`, `hero-card__value`, `hero-card__chip`
- `chart-panel`, `chart-panel__header`, `chart-panel__toolbar`, `chart-frame`, `chart-svg`, `chart-token-bar`, `chart-spend-line`, `chart-x-tick-label`
- `collapsible-panel`, `collapsible-panel__heading`, `collapsible-panel__body`
- `pill-button`, `pill-button--active`
- `pricing-card`, `pricing-card__header`, `pricing-card__price-grid`, `pricing-card__edit-grid`, `pricing-card__actions`
- `control-group`, `control-group__buttons`, `control-group--inactive`
- `refresh-cluster`, `backend-auth-panel`, `leaderboard-grid`, `secondary-panels`, `insight-rail`

No CSS-in-JS, no Tailwind, no CSS modules -- a single global stylesheet with a dark theme using CSS custom properties, retro-terminal green accents, and responsive breakpoints at 1080px with `prefers-reduced-motion` support.
