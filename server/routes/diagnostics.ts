import { Router } from "express"

import { isDashboardRequestAuthenticated } from "../auth"
import { getSyncRefreshLifecycle, readSyncState } from "../services/dashboard-analytics"
import { rawOpencodeMessagesCursorKey, rawOpencodeSessionsCursorKey } from "../services/raw-opencode"

function toNumber(value: string | undefined) {
  if (value == null) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function pickCursorState(syncState: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(syncState).filter(([key]) => key.endsWith("_cursor") || key.startsWith("raw_opencode_")),
  )
}

function buildLastRefresh(syncState: Record<string, string>, lifecycle = buildSyncLifecycle(syncState)) {
  const status = lifecycle.status !== "idle" ? lifecycle.status : syncState.last_refresh_status
  if (!status) {
    return null
  }

  return {
    status,
    sessionsSynced: lifecycle.sessionsSynced,
    messagesSynced: lifecycle.messagesSynced,
    requestedAt: lifecycle.requestedAt,
    startedAt: lifecycle.startedAt,
    completedAt: lifecycle.completedAt,
    failedAt: lifecycle.failedAt,
    durationMs: toNumber(syncState.last_refresh_duration_ms),
    error: lifecycle.error,
    incomplete: lifecycle.incomplete,
  }
}

function blankToUndefined(value: string | undefined) {
  return value === "" ? undefined : value
}

function buildSyncLifecycle(syncState: Record<string, string>) {
  const requestedAt = toNumber(blankToUndefined(syncState.sync_requested_at) ?? syncState.last_refresh_requested_at ?? syncState.refresh_requested_at)
  const startedAt = toNumber(blankToUndefined(syncState.sync_started_at))
  const completedAt = toNumber(blankToUndefined(syncState.sync_completed_at) ?? syncState.last_refresh_completed_at)
  const failedAt = toNumber(blankToUndefined(syncState.sync_failed_at))
  const lastSuccessfulSyncTime = toNumber(syncState.last_successful_sync_time ?? syncState.last_sync_time)
  const explicitStatus = syncState.sync_status ?? syncState.last_refresh_status ?? "idle"
  const incomplete = requestedAt != null && completedAt == null && failedAt == null && (explicitStatus === "requested" || explicitStatus === "started")
  const status = incomplete ? "interrupted" : explicitStatus

  return {
    status,
    requestedAt,
    startedAt,
    completedAt,
    failedAt,
    lastSuccessfulSyncTime,
    sessionsSynced: toNumber(syncState.last_refresh_sessions_synced),
    messagesSynced: toNumber(syncState.last_refresh_messages_synced),
    error: blankToUndefined(syncState.sync_error) ?? blankToUndefined(syncState.last_refresh_error) ?? null,
    incomplete,
  }
}

export function diagnosticsRoutes(analyticsDbPath: string, dashboardToken: string) {
  const router = Router()

  router.get("/backend/diagnostics", (req, res) => {
    const now = Math.floor(Date.now() / 1000)
    const authenticated = isDashboardRequestAuthenticated(req, dashboardToken)

    if (!authenticated) {
      res.json({
        backend: { ok: true, now },
        auth: { authenticated: false },
        sync: null,
        update: { available: false, reason: "unauthenticated" },
      })
      return
    }

    const lifecycle = getSyncRefreshLifecycle(analyticsDbPath)
    const isActiveRefresh = lifecycle.status === "started" || lifecycle.status === "running"
    const state = isActiveRefresh ? {
      sync_status: lifecycle.status,
      sync_job_id: lifecycle.jobId ?? "",
      sync_requested_at: lifecycle.requestedAt == null ? "" : String(lifecycle.requestedAt),
      sync_started_at: lifecycle.startedAt == null ? "" : String(lifecycle.startedAt),
      sync_error: "",
    } : readSyncState(analyticsDbPath)
    const lastSyncTime = isActiveRefresh ? null : toNumber(state.last_sync_time ?? state[rawOpencodeMessagesCursorKey("opencode")] ?? state[rawOpencodeSessionsCursorKey("opencode")] ?? state["raw_opencode_messages"] ?? state["raw_opencode_sessions"])

    res.json({
      backend: { ok: true, now },
      auth: { authenticated: true },
      sync: {
        state,
        lastSyncTime,
        lastSuccessfulSyncTime: lifecycle.lastSuccessfulSyncTime,
        lagSeconds: lastSyncTime == null ? null : Math.max(0, now - lastSyncTime),
        cursors: pickCursorState(state),
        lifecycle,
      },
      update: {
        available: true,
        last: buildLastRefresh(state, lifecycle),
      },
    })
  })

  return router
}
