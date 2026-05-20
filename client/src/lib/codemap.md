# `client/src/lib/` -- Shared Utility Layer

## Responsibility

The `lib/` directory provides stateless, framework-agnostic utilities consumed by the client
API layer, React hooks, and UI components. Each module solves one narrow concern:

| Module | Purpose |
|--------|---------|
| `windowSelection.ts` | Type-safe representation of the dashboard time window (preset or custom), plus serialization to URL search params and human-readable descriptions. |
| `dashboard-api-error.ts` | Structured error class (`DashboardApiError`) and a classifier predicate for the "analytics DB busy" retryable condition. |
| `dashboard-retry.ts` | Lightweight retry loop that resumes a failed operation only when the error matches the `analytics_db_busy` pattern (HTTP 503 with a specific error code). |
| `pricingIdentity.ts` | Normalization and canonical derivation of vendor/model identity for pricing records, including alias resolution and heuristic vendor inference. |

All modules are **pure TypeScript with zero React or DOM imports**. They do not close over
component state, side-effects, or environment globals beyond `fetch` and standard library
primitives (with the exception of `dashboard-retry.ts` which accepts a pluggable `delay`
to remain testable without real timers).

## Design

### 1. Distinct union for window selection (`DashboardWindowSelection`)

The domain distinguishes two window modes:

```ts
type DashboardWindowSelection =
  | { mode: "preset"; preset: "24h" | "7d" | "30d" | "90d" | "all" }
  | { mode: "custom"; start: string; end: string }
```

This union eliminates the "absent vs. present" ambiguity that a single `window:` plus
optional `start/end` fields would create. Callers destructure by `mode` and get
tightly-scoped fields per variant.

### 2. Structured API error with classification predicate

`DashboardApiError` carries four fields (`status`, `code`, `retryable`, `payload`) so
consumers never need to inspect opaque raw error shapes. The predicate
`isRetryableAnalyticsBusyError` encodes the exact retry contract:

```
status === 503  AND  code === "analytics_db_busy"  AND  retryable === true
```

New retry scenarios are added as additional predicates rather than mashing all conditions
into a single function, keeping classification open for extension but closed for
modification.

### 3. Retry loop with backoff and a configurable delay

`retryAnalyticsBusy` wraps `retry` + `isRetryable`. The loop uses fixed linear backoff:
attempt `n` (0-indexed) waits `250 * (n + 1)` ms. A pluggable `delay(ms)` function
(defaulting to `setTimeout`-based promise) decouples timing from the retry strategy,
making deterministic testing possible by injecting `() => Promise.resolve()`.

When `maxAttempts` is reached or the error is non-retryable, the original error is
re-thrown so the caller observes the root cause rather than a generic "retry exhausted"
wrapper.

### 4. Pricing identity derivation -- layered inference

Pricing records need a stable `canonicalVendor` and `canonicalModel` independent of the
raw transport provider or scoped model ID. The derivation uses three fallback layers:

1. **Provider alias map** (`TRANSPORT_PROVIDER_CANONICAL_VENDOR`) -- e.g. `gauge-forge-openai` becomes `openai`.
2. **Model-id prefix patterns** (`CANONICAL_VENDOR_BY_MODEL_PREFIX`) -- `gpt-*` maps to `openai`, `claude-*` to `anthropic`, `kimi-*` to `moonshot`.
3. **Fallback** -- the lowercased provider ID is used as-is.

Model IDs are first destructured: if they contain a `/`, the prefix is treated as a
scoped vendor (and checked against the transport-provider alias map), with the suffix
becoming the unscoped model ID. Model aliases (`k2p6` → `kimi-2.6`,
`gpt-5.3-codex-spark` → `gpt-5.3-codex`) resolve before the canonical key is formed.

The final record ID follows the convention `price-{vendor}-{model}-manual` with all parts
normalised to lowercase alphanumeric/hyphen slugs.

## Flow

### Dashboard data load (error → retry → success)

```
[useDashboardState.loadWithBusyRetry]
    │
    ▼
retryAnalyticsBusy(load, { maxAttempts: 3, delay: defaultDelay })
    │
    ├─ attempt 0 ──► load() ────────────► success ──► return data
    │                   │
    │                   └─ error ──► isRetryableAnalyticsBusyError?
    │                                   │
    │                                   ├─ yes, not last attempt ──► await 250ms ──► attempt 1
    │                                   │
    │                                   └─ no, or last attempt ──► throw original error
    │
    └─ attempts exhausted ──► throw Error("retry_attempts_exhausted")
```

`load()` calls `fetchBackendDiagnostics` via the API client. The API client's `readJson`
helper catches non-2xx responses and constructs a `DashboardApiError`. The error bubbles
up to `retryAnalyticsBusy`, which checks `isRetryableAnalyticsBusyError` and either
retries (after a delay) or rethrows. The hook's `useEffect` catches failures and sets
`error: "dashboard_load_failed"`.

### Window selection → query parameters

```
[TimeControls] / [DashboardPage]
    │  user selects "7d" or custom date range
    ▼
DashboardWindowSelection ──► windowSelectionToQuery() ──► URLSearchParams
    │                                                         │
    │  preset "7d"                                            │  window=7d
    │  custom { start, end }                                  │  window=custom&start=...&end=...
    ▼
fetchOverview(window)          ──► GET /api/overview/lifetime?window=7d
fetchSeries(granularity, window) ──► GET /api/series/daily?metrics=...&window=7d
```

### Pricing gap fill → identity derivation

```
[LeaderboardTables.submitGapPricing]
    │  gap = { providerId: "openai", modelId: "gpt-5.1" }
    ▼
deriveManualPricingIdentity({ providerId, modelId })
    │
    ├─ normalizePricingModelKey("gpt-5.1")     → "gpt-5.1"
    ├─ inferCanonicalVendor("openai", "gpt-5.1", "gpt-5.1")
    │     ├─ slash check: no "/"
    │     ├─ transport alias for "openai"? no match
    │     ├─ prefix match? /^gpt-/ → "openai"
    │     └─ return "openai"
    │
    ▼
    { id: "price-openai-gpt-5-1-manual", canonicalVendor: "openai", canonicalModel: "gpt-5.1", vendorModelId: "gpt-5.1" }
    │
    ▼
    Props.onCreatePricing({ ...identity, inputPrice, outputPrice, ... })
```

## Integration

### `windowSelection.ts`

| Consumer | Import | Role |
|----------|--------|------|
| `api/client.ts` | `windowSelectionToQuery, DashboardWindowSelection` (aliased as `DashboardWindow`) | Converts the UI window state into `URLSearchParams` for the `/api/overview/lifetime` and `/api/series/:granularity` endpoints. |
| `components/TimeControls.tsx` | `isValidCustomWindow, PresetWindow` | Validates custom `start`/`end` date strings before emitting a `DashboardWindow` change; uses `PresetWindow` for the pill-button labels. |
| `pages/DashboardPage.tsx` | `describeWindowSelection` | Renders the human-readable window label in the status bar and chart metadata badges. |

### `dashboard-api-error.ts`

| Consumer | Import | Role |
|----------|--------|------|
| `api/client.ts` | `DashboardApiError` | Constructed inside the shared `readJson<T>()` helper whenever a `fetch` response is non-2xx. The helper reads `error` and `retryable` from the JSON body to populate the structured error. |
| `hooks/useDashboardState.ts` | `isRetryableAnalyticsBusyError` | Indirectly, via `retryAnalyticsBusy` (see below). The hook also uses this predicate inside `isBackendUnreachableError` to distinguish a true backend-down (`TypeError` / network error) from a transient 503, so the UI shows different alerts. |

### `dashboard-retry.ts`

| Consumer | Import | Role |
|----------|--------|------|
| `hooks/useDashboardState.ts` | `retryAnalyticsBusy` | Wraps the core `load()` function. Every data-fetching code path (`useEffect` initial load, `refresh`, `reload`, `authenticateBackend`, `reloadAfterBackendControl`) calls `loadWithBusyRetry` which delegates to `retryAnalyticsBusy(load)`. This gives all fetch flows resilience against transient `analytics_db_busy` without duplicating retry logic. |

### `pricingIdentity.ts`

| Consumer | Import | Role |
|----------|--------|------|
| `components/LeaderboardTables.tsx` | `deriveManualPricingIdentity` | Called inside `submitGapPricing()` when the user fills in pricing for an uncovered `PricingCoverageGap`. The derived identity (id, canonicalVendor, canonicalModel, vendorModelId) is spread directly into a `CreatePricingRecordPayload` and posted via `onCreatePricing`. |
