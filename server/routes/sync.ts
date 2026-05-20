import { Router } from "express"

import type { DataSourceConfig } from "../config"
import { getSyncRefreshLifecycle, queueSyncRefresh, readSyncState } from "../services/dashboard-analytics"
import { tryRespondWithAnalyticsBusy } from "../services/sqlite-busy"

function resolveDataSource(dataSources: DataSourceConfig[], source?: string): DataSourceConfig | undefined {
  if (source) {
    return dataSources.find((ds) => ds.label === source)
  }
  return dataSources.find((ds) => ds.enabled)
}

export function syncRoutes(analyticsDbPath: string, dataSources: DataSourceConfig[]) {
  const router = Router()

  router.get("/sync/status", (req, res) => {
    const source = typeof req.query.source === "string" ? req.query.source : undefined
    const resolved = resolveDataSource(dataSources, source) ?? dataSources.find((ds) => ds.enabled)
    const sourceLabel = resolved?.label ?? "opencode"

    try {
      res.json({
        state: readSyncState(analyticsDbPath),
        lifecycle: getSyncRefreshLifecycle(analyticsDbPath, sourceLabel),
      })
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  router.post("/sync/refresh", (req, res) => {
    const source = typeof req.query.source === "string" ? req.query.source
      : (typeof req.body?.source === "string" ? req.body.source : undefined)
    const resolved = resolveDataSource(dataSources, source) ?? dataSources.find((ds) => ds.enabled)

    if (!resolved) {
      res.status(400).json({
        status: "failed",
        error: "No enabled data source available",
      })
      return
    }

    try {
      res.json(queueSyncRefresh(analyticsDbPath, resolved.path, resolved.label))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      res.status(500).json({
        status: "failed",
        error: error instanceof Error ? error.message : "sync_refresh_failed",
      })
    }
  })

  return router
}
