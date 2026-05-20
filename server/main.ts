import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { authRoutes, requireDashboardToken } from "./auth"
import { AppConfig, getDefaultDataSourcePath, loadConfig } from "./config"
import { diagnosticsRoutes } from "./routes/diagnostics"
import { healthRoutes } from "./routes/health"
import { leaderboardsRoutes } from "./routes/leaderboards"
import { overviewRoutes } from "./routes/overview"
import { pricingRoutes } from "./routes/pricing"
import { seriesRoutes } from "./routes/series"
import { syncRoutes } from "./routes/sync"
import { queueColdStartAnalyticsRefresh } from "./services/cold-start-sync"
import { ensurePricingRegistryReady } from "./services/pricing-recovery"
import { bootstrapAnalyticsDb } from "./storage/db"
import { mountPublicBuiltClient, resolveBuiltClientDir } from "./static-client"

type CreateServerOptions = {
  builtClientDir?: string
}

function formatHttpHost(host: string) {
  return host.includes(":") ? `[${host}]` : host
}

export function createServer(_config: AppConfig = loadConfig(), options: CreateServerOptions = {}) {
  bootstrapAnalyticsDb(_config.analyticsDbPath)
  ensurePricingRegistryReady(_config.analyticsDbPath, _config.pricingDbPath)

  const builtClientDir = options.builtClientDir ?? resolveBuiltClientDir()
  const app = express()
  app.disable("x-powered-by")
  app.use(express.json())
  app.use(healthRoutes())
  app.use(authRoutes(_config.dashboardToken, { localAuthFilePath: _config.dashboardTokenFilePath }))
  app.use("/api", authRoutes(_config.dashboardToken, { localAuthFilePath: _config.dashboardTokenFilePath }))
  app.use(diagnosticsRoutes(_config.analyticsDbPath, _config.dashboardToken))
  app.use("/api", diagnosticsRoutes(_config.analyticsDbPath, _config.dashboardToken))
  // ---- public boundary: built client mount is the last unauthenticated registration ----
  // All routes below this point require dashboard authentication.
  app.locals.mountedBuiltClient = mountPublicBuiltClient(app, builtClientDir)
  app.use(requireDashboardToken(_config.dashboardToken))
  app.use(overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(syncRoutes(_config.analyticsDbPath, _config.dataSources))
  app.use("/api", overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", syncRoutes(_config.analyticsDbPath, _config.dataSources))
  return app
}

export async function startServer(config: AppConfig = loadConfig(), options: CreateServerOptions = {}) {
  const builtClientDir = options.builtClientDir ?? resolveBuiltClientDir()
  const app = createServer(config, { builtClientDir })

  return await new Promise<import("node:http").Server>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(`observatory backend listening on http://${formatHttpHost(config.host)}:${config.port}`)
      if (app.locals.mountedBuiltClient) {
        console.log(`usage mode homepage available at http://${formatHttpHost(config.host)}:${config.port}`)
      } else {
        console.log("vite client is separate; run npm run dev for the browser scaffold")
      }
      try {
        queueColdStartAnalyticsRefresh(config.analyticsDbPath, getDefaultDataSourcePath(config)!)
      } catch (error) {
        console.warn("cold-start analytics refresh was not queued", error)
      }
      resolve(server)
    })

    server.once("error", reject)
  })
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : ""
const modulePath = fileURLToPath(import.meta.url)

if (executedPath === modulePath) {
  void startServer()
}
