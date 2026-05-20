# client/

## Responsibility

The `client/` folder is the Vite SPA (single-page application) root and packaging boundary for the OpenCode Cost Observatory frontend. It contains a zero-dependency (beyond React) dashboard that visualises token usage, cost telemetry, pricing coverage, and sync health from a local OpenCode analytics store. Because the repository is a single `package.json` monolith, `client/` is not an independent npm package -- instead it is the `root` directory configured in `vite.config.ts` (`root: "client"`). Everything the browser loads originates under this directory.

## Design

| Decision | Detail |
|---|---|
| **SPA root via Vite `root`** | `vite.config.ts` sets `root: "client"`. All dev-serving, HMR, and production builds are scoped to this folder. |
| **Single HTML entry** | `client/index.html` is the sole HTML file. It declares `<div id="root">` and loads the module entry `<script type="module" src="/src/main.tsx">`. No multi-page routing, no server-side rendering. |
| **`client/src/` as the code boundary** | All React components, hooks, API client code, types, styles, and utilities live under `client/src/`. The `client/` folder itself contains only the HTML shell, the `src/` subtree, and this codemap. |
| **No client-side package.json** | The root `package.json` declares React and React DOM as shared dependencies and `vite` + `@vitejs/plugin-react` as shared dev-dependencies. There is no separate client `package.json`, `tsconfig.json`, or lockfile -- the monolith owns build tooling globally. |
| **Build output external to client/** | `vite build` writes to `../dist/client` (i.e. `<repo-root>/dist/client`) via `build.outDir`. The `client/` folder itself is never the build target; it is strictly a source directory. |
| **Dev server at `127.0.0.1:41778`** | The Vite dev server binds to localhost only (no LAN exposure), reflecting the localhost-only security model. |
| **API proxy to local backend** | Vite proxies `/api/*` and `/auth/*` to `http://127.0.0.1:41777` (the observatory backend). The frontend only ever calls same-origin paths. Vite own's custom `observatoryBackendControlPlugin` also injects `__observatory/*` endpoints for backend lifecycle management. |
| **Internal architecture** | For component hierarchy, state management, request deduplication, polling lifecycle, and bilingual support patterns, see `client/src/codemap.md`. |

## Flow

```
                    +---------------------+
                    |  client/index.html  |   SPA shell; mounts React at #root
                    +----------+----------+
                               |
                    +----------v----------+
                    |  client/src/main.tsx |   React 18 createRoot + StrictMode
                    +----------+----------+
                               |
                    +----------v----------+
                    |  client/src/App.tsx  |   Single-route: renders <DashboardPage />
                    +----------+----------+
                               |
            +------------------+------------------+
            |                                     |
  +---------v----------+              +-----------v-----------+
  | useI18n()          |              | useDashboardState()   |   Central state machine:
  |   -> Dictionary    |              |   load()/refresh()    |   auth, fetch, poll,
  |   -> locale/en-zh  |              |   requestTracker      |   filters, CRUD, alerts
  +--------------------+              +-----------+-----------+
                                                  |
                          +----------+-----------+-----------+----------+
                          |          |           |           |          |
                   GET /api/*     HeroCards   MainSeries   Leaderboards  BackendMgmt
                   (proxy to        Chart      Tables       + Pricing     Panel
                    41777)                                  CRUD
```

1. **Browser requests `index.html`** -- Vite serves the shell with the module `<script>`.
2. **`main.tsx` boots React 18**, mounting `<App />` inside `<StrictMode>` and importing the global stylesheet `index.css`.
3. **`App.tsx` renders `<DashboardPage />`** -- the only page component; no client-side router exists.
4. **`DashboardPage` consumes two hooks**: `useI18n()` for locale/bilingual strings and `useDashboardState()` for all data fetching, polling, auth, and state transitions.
5. **All API calls** use plain `fetch` through a thin `readJson<T>()` wrapper in `client/src/api/client.ts` (with `503` busy-retry logic in `client/src/lib/dashboard-retry.ts`).
6. **Vite proxies** route `/api/*` and `/auth/*` to the Node backend on `127.0.0.1:41777`. Custom `__observatory/*` endpoints (from `server/vite-backend-control.ts`) allow the frontend to start/restart/check the backend process directly.
7. **Production build** (`npm run build`) produces static assets in `dist/client/` served by the backend or any static file host.

## Integration

| Boundary | Connection | Description |
|---|---|---|
| **Vite dev server** | `vite.config.ts` sets `root: "client"` | Declares `client/` as the SPA root; dev server hosts everything under this tree with HMR. |
| **Backend API** | Vite proxy: `"/api"` => `http://127.0.0.1:41777` | All REST calls (overview, series, sync, pricing, leaderboards) are dev-proxied; in production the same-origin assumption holds if the backend serves the built assets. |
| **Backend control** | Custom Vite plugin: `__observatory/*` | Frontend calls `GET /__observatory/backend/status` and `POST /__observatory/backend/{start,restart}` to manage the backend process lifecycle. |
| **Auth session** | `GET/POST /api/auth/*` | Localhost-token authentication (token or `.run/dashboard.token` file) exchanged for a session cookie. |
| **Root `package.json`** | Shared `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, TypeScript | No separate dependency manifest; the monorepo's single `package.json` covers both client and server. |
| **`client/src/codemap.md`** | Internal subsystem docs | Documents the full component tree, state machine design, data flow, individual file roles, and API endpoint catalog inside `client/src/`. |
