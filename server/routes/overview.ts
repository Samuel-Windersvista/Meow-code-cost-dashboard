import { Router } from "express"

import { buildOverview } from "../services/dashboard-analytics"
import { tryRespondWithAnalyticsBusy } from "../services/sqlite-busy"
import { parseDashboardWindowQuery } from "../services/window-range"

export function overviewRoutes(analyticsDbPath: string, pricingDbPath: string) {
  const router = Router()

  router.get("/overview/lifetime", (req, res) => {
    const hasWindow = Object.prototype.hasOwnProperty.call(req.query, "window")
    const now = Math.floor(Date.now() / 1000)
    const source = typeof req.query.source === "string" ? req.query.source : undefined

    if (!hasWindow) {
      try {
        res.json(buildOverview(analyticsDbPath, pricingDbPath, now, undefined, source))
      } catch (error) {
        if (tryRespondWithAnalyticsBusy(res, error)) {
          return
        }
        throw error
      }
      return
    }

    let parsedWindow
    try {
      parsedWindow = parseDashboardWindowQuery(req.query, new Date(now * 1000))
    } catch (error) {
      res.status(400).json({
        error: "invalid_window",
        message: error instanceof Error ? error.message : "Invalid window",
      })
      return
    }

    try {
      res.json(buildOverview(analyticsDbPath, pricingDbPath, now, parsedWindow, source))
    } catch (error) {
      if (tryRespondWithAnalyticsBusy(res, error)) {
        return
      }
      throw error
    }
  })

  return router
}
