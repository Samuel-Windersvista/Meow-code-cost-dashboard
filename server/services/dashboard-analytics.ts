import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { calculateUsageCost } from "./cost-engine"
import { buildObservedPricingCoverageRows } from "./observed-pricing-coverage"
import { normalizePricingModelKey, rowMatchesPricingModelKey } from "./pricing-identity"
import { resolveCanonicalPrice, type PricingResolverRow } from "./pricing-registry"
import {
  rawOpencodeMessagesCursorKey,
  rawOpencodeSessionsCursorKey,
  iterateAssistantMessagesFromRawDb,
  readProjectsFromRawDb,
  readSessionsFromRawDb,
  writeCursorValue,
} from "./raw-opencode"
import { rollupSessionTree } from "./session-rollup"
import type { ParsedDashboardWindow } from "./window-range"
import { openAnalyticsDb, openAnalyticsReadonlyDb, openRawOpencodeDb } from "../storage/db"
import { openPricingReadonlyDb } from "../storage/pricing-db"

type UsageFactRow = {
  message_id: string
  session_id: string
  project_id: string
  parent_message_id: string | null
  provider_id: string
  model_id: string
  time_created: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  source_label: string
}

type PricingCoverageGap = {
  providerId: string
  modelId: string
  totalTokens: number
  messageCount: number
  firstSeen: number
  lastSeen: number
  reason: "no_matching_pricing_record"
  hint: string
}

type SessionTreeRow = {
  session_id: string
  parent_session_id: string | null
  project_id: string
  directory: string
  title: string
  time_created: number
  source_label: string
}

type SyncStateRow = {
  key: string
  value: string
}

type RawProjectRow = ReturnType<typeof readProjectsFromRawDb>[number]
type RawSessionRow = ReturnType<typeof readSessionsFromRawDb>[number]

type SyncRefreshResult = {
  sessionsSynced: number
  messagesSynced: number
  syncedAt: number
}

type SyncRefreshRunner = (rawDatabasePath: string, analyticsDatabasePath: string, sourceLabel: string, now: number) => SyncRefreshResult | Promise<SyncRefreshResult>

type SyncLifecycleStatus = "idle" | "requested" | "started" | "running" | "completed" | "failed" | "interrupted"

type ActiveSyncJob = {
  jobId: string
  databasePath: string
  rawDatabasePath: string
  sourceLabel: string
  requestedAt: number
  startedAt: number
  startedAtMs: number
  promise: Promise<void>
}

const activeSyncJobs = new Map<string, ActiveSyncJob>()
let syncRefreshRunner: SyncRefreshRunner = syncRawOpencodeToAnalytics
let useDefaultSyncRefreshRunner = true
let defaultSyncRefreshRunner: SyncRefreshRunner = runSyncRefreshInWorkerProcess

const modulePath = fileURLToPath(import.meta.url)
const serverServicesDir = path.dirname(modulePath)
const projectRoot = path.resolve(serverServicesDir, "..", "..")
const syncWorkerEntryPoint = path.join(projectRoot, "server", "sync-worker.ts")
const tsxPreflightPath = path.join(projectRoot, "node_modules", "tsx", "dist", "preflight.cjs")
const tsxLoaderPath = path.join(projectRoot, "node_modules", "tsx", "dist", "loader.mjs")
const tsxLoaderUri = new URL(`file:///${tsxLoaderPath.replace(/\\/g, "/")}`).href

function newSyncJobId() {
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function toNumberOrNull(value: string | undefined) {
  if (value == null || value === "") {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function blankToUndefined(value: string | undefined) {
  return value === "" ? undefined : value
}

function writeSyncStateValues(databasePath: string, entries: Array<[string, string]>) {
  const db = openAnalyticsDb(databasePath)

  try {
    const writeState = db.sqlite.prepare(`
      insert into sync_state (key, value)
      values (?, ?)
      on conflict(key) do update set value = excluded.value
    `)

    for (const [key, value] of entries) {
      writeState.run(key, value)
    }
  } finally {
    db.sqlite.close()
  }
}

function newWorkerRunPath(databasePath: string, suffix: string) {
  const runDir = path.dirname(databasePath)
  fs.mkdirSync(runDir, { recursive: true })
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return path.join(runDir, `sync-worker-${runId}.${suffix}`)
}

function readWorkerError(errorPath: string, stderrPath: string, fallback: string) {
  for (const candidate of [errorPath, stderrPath]) {
    if (!fs.existsSync(candidate)) {
      continue
    }
    const content = fs.readFileSync(candidate, "utf8").trim()
    if (content) {
      return content
    }
  }

  return fallback
}

function runSyncRefreshInWorkerProcess(rawDatabasePath: string, analyticsDatabasePath: string, sourceLabel: string, now: number) {
  const payloadPath = newWorkerRunPath(analyticsDatabasePath, "json")
  const resultPath = newWorkerRunPath(analyticsDatabasePath, "result.json")
  const errorPath = newWorkerRunPath(analyticsDatabasePath, "error.log")
  const stdoutPath = newWorkerRunPath(analyticsDatabasePath, "out.log")
  const stderrPath = newWorkerRunPath(analyticsDatabasePath, "err.log")

  fs.writeFileSync(payloadPath, JSON.stringify({
    rawDatabasePath,
    analyticsDatabasePath,
    sourceLabel,
    now,
    resultPath,
    errorPath,
  }), "utf8")

  const stdout = fs.openSync(stdoutPath, "a")
  const stderr = fs.openSync(stderrPath, "a")
  const child = spawn(process.execPath, [
    "--require",
    tsxPreflightPath,
    "--import",
    tsxLoaderUri,
    syncWorkerEntryPoint,
    payloadPath,
  ], {
    cwd: projectRoot,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  })
  fs.closeSync(stdout)
  fs.closeSync(stderr)

  return new Promise<SyncRefreshResult>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      try {
        if (code === 0 && fs.existsSync(resultPath)) {
          resolve(JSON.parse(fs.readFileSync(resultPath, "utf8")) as SyncRefreshResult)
          return
        }

        reject(new Error(readWorkerError(errorPath, stderrPath, `sync_worker_failed:${code ?? signal ?? "unknown"}`)))
      } finally {
        fs.rmSync(payloadPath, { force: true })
        fs.rmSync(resultPath, { force: true })
      }
    })
  })
}

function shouldMarkInterrupted(state: Record<string, string>) {
  const status = state.sync_status
  const requestedAt = toNumberOrNull(blankToUndefined(state.sync_requested_at) ?? state.last_refresh_requested_at ?? state.refresh_requested_at)
  const completedAt = toNumberOrNull(blankToUndefined(state.sync_completed_at) ?? state.last_refresh_completed_at)
  const failedAt = toNumberOrNull(blankToUndefined(state.sync_failed_at))

  return requestedAt != null
    && completedAt == null
    && failedAt == null
    && (status === "requested" || status === "started" || status === "running")
}

function readSyncStateRaw(databasePath: string) {
  const db = openAnalyticsReadonlyDb(databasePath)

  try {
    const rows = db.sqlite.prepare(`
      select key, value
      from sync_state
      order by key asc
    `).all() as SyncStateRow[]

    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  } finally {
    db.sqlite.close()
  }
}

export function buildSyncLifecycle(state: Record<string, string>, source?: string) {
  const requestedAt = toNumberOrNull(blankToUndefined(state.sync_requested_at) ?? state.last_refresh_requested_at ?? state.refresh_requested_at)
  const startedAt = toNumberOrNull(blankToUndefined(state.sync_started_at))
  const completedAt = toNumberOrNull(blankToUndefined(state.sync_completed_at) ?? state.last_refresh_completed_at)
  const failedAt = toNumberOrNull(blankToUndefined(state.sync_failed_at))
  const lastSuccessfulSyncTime = readLastSyncTime(state, source)
  const explicitStatus = (state.sync_status ?? state.last_refresh_status ?? "idle") as SyncLifecycleStatus
  const interruptedPersisted = explicitStatus === "interrupted" && completedAt == null && failedAt == null
  const incomplete = shouldMarkInterrupted(state) || interruptedPersisted
  const status: SyncLifecycleStatus = incomplete && explicitStatus !== "interrupted" ? "interrupted" : explicitStatus

  return {
    status,
    jobId: blankToUndefined(state.sync_job_id) ?? null,
    requestedAt,
    startedAt,
    heartbeatAt: toNumberOrNull(blankToUndefined(state.sync_heartbeat_at)),
    completedAt,
    failedAt,
    lastSuccessfulSyncTime,
    sessionsSynced: toNumberOrNull(state.last_refresh_sessions_synced),
    messagesSynced: toNumberOrNull(state.last_refresh_messages_synced),
    durationMs: toNumberOrNull(state.last_refresh_duration_ms),
    error: blankToUndefined(state.sync_error) ?? blankToUndefined(state.last_refresh_error) ?? null,
    incomplete,
    ...(source ? { source } : {}),
  }
}

export function setSyncRefreshRunnerForTests(runner: SyncRefreshRunner | null) {
  syncRefreshRunner = runner ?? syncRawOpencodeToAnalytics
  useDefaultSyncRefreshRunner = runner == null
  activeSyncJobs.clear()
}

export function setDefaultSyncRefreshRunnerForTests(runner: SyncRefreshRunner | null) {
  defaultSyncRefreshRunner = runner ?? runSyncRefreshInWorkerProcess
  activeSyncJobs.clear()
}

export type SeriesGranularity = "hourly" | "daily" | "weekly" | "monthly"

export type SeriesMetric = "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens" | "cacheWriteTokens" | "cost"

export type DashboardWindow = "1h" | "24h" | "7d" | "30d" | "90d" | "all"

type DashboardWindowRange = DashboardWindow | ParsedDashboardWindow

function roundUsd(value: number) {
  return Number(value.toFixed(6))
}

function roundUsdOrNull(value: number | null) {
  return value == null ? null : roundUsd(value)
}

function mergeUsdTotals(base: number | null, next: number | null) {
  if (base == null || next == null) {
    return null
  }

  return base + next
}

function normalizeAnalyticsUnixSeconds(value: number) {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value
}

function resolvePriceForUsage(rows: PricingResolverRow[], usage: UsageFactRow) {
  const modelKey = normalizePricingModelKey(usage.model_id)
  const usageTime = normalizeAnalyticsUnixSeconds(usage.time_created)
  const candidates = rows.filter((row) => rowMatchesPricingModelKey(modelKey, row))
  return candidates.length > 0 ? resolveCanonicalPrice(candidates, usageTime) : null
}

function addPricingCoverageGap(gaps: Map<string, PricingCoverageGap>, usage: UsageFactRow) {
  const providerId = usage.provider_id
  const modelId = usage.model_id
  const modelKey = normalizePricingModelKey(modelId)
  const usageTime = normalizeAnalyticsUnixSeconds(usage.time_created)
  const key = `${providerId}\u0000${modelId}`
  const existing = gaps.get(key)

  if (existing) {
    existing.totalTokens += usage.total_tokens
    existing.messageCount += 1
    existing.firstSeen = Math.min(existing.firstSeen, usageTime)
    existing.lastSeen = Math.max(existing.lastSeen, usageTime)
    return
  }

  gaps.set(key, {
    providerId,
    modelId,
    totalTokens: usage.total_tokens,
    messageCount: 1,
    firstSeen: usageTime,
    lastSeen: usageTime,
    reason: "no_matching_pricing_record",
    hint: `Add an enabled pricing row for canonical model ${modelKey}. Provider wrappers such as ${providerId} are treated as transport layers, not pricing identity.`,
  })
}

function calculateUsageSpend(priceRows: PricingResolverRow[], usage: UsageFactRow) {
  const price = resolvePriceForUsage(priceRows, usage)
  if (!price) {
    return null
  }

  const reasoningBillingRule = JSON.parse(price.reasoning_billing_rule_json) as { kind?: "per_token" | "included_in_output" }

  return calculateUsageCost(
    {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      reasoningTokens: usage.reasoning_tokens,
      cacheReadTokens: usage.cache_read_tokens,
      cacheWriteTokens: usage.cache_write_tokens,
    },
    {
      input: price.input_price,
      output: price.output_price,
      reasoning: price.reasoning_price,
      cacheRead: price.cache_read_price,
      cacheWrite: price.cache_write_price,
      reasoningBillingRule: reasoningBillingRule.kind,
    },
  )
}

function readUsageFacts(databasePath: string, source?: string) {
  const db = openAnalyticsReadonlyDb(databasePath)

  try {
    if (source) {
      return db.sqlite.prepare(`
        select message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created,
               input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
               source_label
        from message_usage_fact
        where source_label = ?
        order by time_created asc, message_id asc
      `).all(source) as UsageFactRow[]
    }
    return db.sqlite.prepare(`
      select message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created,
             input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
             source_label
      from message_usage_fact
      order by time_created asc, message_id asc
    `).all() as UsageFactRow[]
  } finally {
    db.sqlite.close()
  }
}

function readSessionTree(databasePath: string, source?: string) {
  const db = openAnalyticsReadonlyDb(databasePath)

  try {
    if (source) {
      return db.sqlite.prepare(`
        select session_id, parent_session_id, project_id, directory, title, time_created, source_label
        from session_tree_edge
        where source_label = ?
        order by time_created asc, session_id asc
      `).all(source) as SessionTreeRow[]
    }
    return db.sqlite.prepare(`
      select session_id, parent_session_id, project_id, directory, title, time_created, source_label
      from session_tree_edge
      order by time_created asc, session_id asc
    `).all() as SessionTreeRow[]
  } finally {
    db.sqlite.close()
  }
}

export function readPricingRecords(pricingDbPath: string) {
  const db = openPricingReadonlyDb(pricingDbPath)

  try {
    return db.sqlite.prepare(`
      select id, canonical_vendor, canonical_model, vendor_model_id, currency, source_type, source_url,
             input_price, output_price, reasoning_price, reasoning_billing_rule_json,
             cache_read_price, cache_write_price, confidence, is_manual_override,
             observed_time, enabled, effective_time, superseded_time
      from pricing_record
      order by canonical_vendor asc, canonical_model asc, effective_time desc, id asc
    `).all() as PricingResolverRow[]
  } finally {
    db.sqlite.close()
  }
}

export function readObservedPricingCoverage(analyticsDbPath: string, pricingDbPath: string, asOfTime = Math.floor(Date.now() / 1000), source?: string) {
  return buildObservedPricingCoverageRows({
    usageFacts: readUsageFacts(analyticsDbPath, source),
    pricingRows: readPricingRecords(pricingDbPath),
    asOfTime,
  })
}

export function readSyncState(databasePath: string) {
  const state = readSyncStateRaw(databasePath)

  if (!activeSyncJobs.has(databasePath) && shouldMarkInterrupted(state)) {
    const interruptedAt = String(Math.floor(Date.now() / 1000))
    writeSyncStateValues(databasePath, [
      ["sync_status", "interrupted"],
      ["sync_interrupted_at", interruptedAt],
      ["sync_error", "backend_exited_during_refresh"],
      ["last_refresh_status", "interrupted"],
      ["last_refresh_error", "backend_exited_during_refresh"],
    ])
    return readSyncStateRaw(databasePath)
  }

  return state
}

function readLastSyncTime(syncState: Record<string, string>, source?: string) {
  const raw = source
    ? (syncState[`last_successful_sync_time:${source}`]
      ?? syncState[`last_sync_time:${source}`]
      ?? syncState[rawOpencodeMessagesCursorKey(source)]
      ?? syncState[rawOpencodeSessionsCursorKey(source)])
    : (syncState.last_successful_sync_time
      ?? syncState.last_sync_time
      ?? syncState["raw_opencode_messages"]
      ?? syncState["raw_opencode_sessions"])

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function deriveAnalyticsSessionRow(session: RawSessionRow, project: RawProjectRow | undefined, sourceLabel: string): SessionTreeRow {
  const directory = session.directory === session.projectId && project?.path
    ? project.path
    : session.directory
  const title = session.title === session.sessionId && project?.title
    ? project.title
    : session.title

  return {
    session_id: session.sessionId,
    parent_session_id: session.parentSessionId,
    project_id: session.projectId,
    directory,
    title,
    time_created: session.createdAt,
    source_label: sourceLabel,
  }
}

export function syncRawOpencodeToAnalytics(rawDatabasePath: string, analyticsDatabasePath: string, sourceLabel: string, now = Math.floor(Date.now() / 1000)) {
  const rawDb = openRawOpencodeDb(rawDatabasePath)
  const analyticsDb = openAnalyticsDb(analyticsDatabasePath)

  try {
    const projects = readProjectsFromRawDb(rawDb)
    const projectsById = new Map(projects.map((project) => [project.projectId, project]))
    const sessions = readSessionsFromRawDb(rawDb)
    const sessionRows = sessions.map((session) => deriveAnalyticsSessionRow(session, projectsById.get(session.projectId), sourceLabel))
    const sessionProjectIds = new Map(sessionRows.map((session) => [session.session_id, session.project_id]))
    const maxSessionTime = sessionRows.reduce((max, row) => Math.max(max, row.time_created), 0)

    const deleteMessageFacts = analyticsDb.sqlite.prepare("delete from message_usage_fact where source_label = ?")
    const deleteSessionTree = analyticsDb.sqlite.prepare("delete from session_tree_edge where source_label = ?")
    const insertSession = analyticsDb.sqlite.prepare(`
      insert into session_tree_edge (source_label, session_id, parent_session_id, project_id, directory, title, time_created)
      values (?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMessage = analyticsDb.sqlite.prepare(`
      insert into message_usage_fact (
        source_label, message_id, session_id, project_id, parent_message_id, provider_id, model_id, time_created,
        input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let messagesSynced = 0
    let maxMessageTime = 0

    analyticsDb.sqlite.exec("begin")
    try {
      deleteMessageFacts.run(sourceLabel)
      deleteSessionTree.run(sourceLabel)

      for (const session of sessionRows) {
        insertSession.run(
          session.source_label,
          session.session_id,
          session.parent_session_id,
          session.project_id,
          session.directory,
          session.title,
          session.time_created,
        )
      }

      for (const message of iterateAssistantMessagesFromRawDb(rawDb)) {
        insertMessage.run(
          sourceLabel,
          message.messageId,
          message.sessionId,
          sessionProjectIds.get(message.sessionId) ?? message.sessionId,
          message.parentMessageId,
          message.providerId,
          message.modelId,
          message.createdAt,
          message.inputTokens,
          message.outputTokens,
          message.reasoningTokens,
          message.cacheReadTokens,
          message.cacheWriteTokens,
          message.totalTokens,
        )
        messagesSynced += 1
        maxMessageTime = Math.max(maxMessageTime, message.createdAt)
      }

      writeCursorValue(analyticsDb, rawOpencodeSessionsCursorKey(sourceLabel), String(maxSessionTime))
      writeCursorValue(analyticsDb, rawOpencodeMessagesCursorKey(sourceLabel), String(maxMessageTime))
      writeCursorValue(analyticsDb, `last_sync_time:${sourceLabel}`, String(now))
      writeCursorValue(analyticsDb, `last_successful_sync_time:${sourceLabel}`, String(now))
      analyticsDb.sqlite.exec("commit")
    } catch (error) {
      analyticsDb.sqlite.exec("rollback")
      throw error
    }

    return {
      sessionsSynced: sessionRows.length,
      messagesSynced,
      syncedAt: now,
    }
  } finally {
    rawDb.close()
    analyticsDb.sqlite.close()
  }
}

function getOverviewWindowSeconds(window: string | undefined) {
  switch (window) {
    case "1h":
      return 60 * 60
    case "24h":
      return 24 * 60 * 60
    case "7d":
      return 7 * 24 * 60 * 60
    case "30d":
      return 30 * 24 * 60 * 60
    case "90d":
      return 90 * 24 * 60 * 60
    case "all":
      return Number.POSITIVE_INFINITY
    default:
      return 30 * 24 * 60 * 60
  }
}

function getDashboardWindowSeconds(window: DashboardWindow | undefined) {
  switch (window) {
    case "1h":
      return 60 * 60
    case "24h":
      return 24 * 60 * 60
    case "7d":
      return 7 * 24 * 60 * 60
    case "30d":
      return 30 * 24 * 60 * 60
    case "90d":
      return 90 * 24 * 60 * 60
    case "all":
      return Number.POSITIVE_INFINITY
    default:
      return 30 * 24 * 60 * 60
  }
}

function isParsedDashboardWindow(window: DashboardWindowRange | string | undefined): window is ParsedDashboardWindow {
  return typeof window === "object" && window !== null && "start" in window && "end" in window
}

function getWindowBounds(window: DashboardWindowRange | string | undefined, now: number, defaultWindow: DashboardWindow = "30d") {
  if (isParsedDashboardWindow(window)) {
    return {
      start: Math.floor(window.start.getTime() / 1000),
      end: Math.floor(window.end.getTime() / 1000),
      label: window.label,
      rangeStart: window.start.toISOString(),
      rangeEnd: window.end.toISOString(),
      includeMetadata: true,
    }
  }

  const windowSeconds = getDashboardWindowSeconds((window as DashboardWindow | undefined) ?? defaultWindow)
  return {
    start: Number.isFinite(windowSeconds) ? now - windowSeconds : Number.NEGATIVE_INFINITY,
    end: Number.POSITIVE_INFINITY,
    label: undefined,
    rangeStart: undefined,
    rangeEnd: undefined,
    includeMetadata: false,
  }
}

export function buildOverview(
  analyticsDbPath: string,
  pricingDbPath: string,
  now = Math.floor(Date.now() / 1000),
  window: string | ParsedDashboardWindow | undefined = "30d",
  source?: string,
) {
  const usageRows = readUsageFacts(analyticsDbPath, source)
  const priceRows = readPricingRecords(pricingDbPath)
  const syncState = readSyncStateRaw(analyticsDbPath)
  const windowBounds = isParsedDashboardWindow(window)
    ? getWindowBounds(window, now)
    : {
        start: Number.isFinite(getOverviewWindowSeconds(window)) ? now - getOverviewWindowSeconds(window) : Number.NEGATIVE_INFINITY,
        end: Number.POSITIVE_INFINITY,
      }

  let lifetimeTokens = 0
  let lifetimeSpendUsd: number | null = 0
  let windowSpendUsd: number | null = 0
  let pricedTokens = 0
  let windowTokens = 0
  let windowPricedTokens = 0
  const pricingCoverageGaps = new Map<string, PricingCoverageGap>()

  for (const usage of usageRows) {
    const usageTime = normalizeAnalyticsUnixSeconds(usage.time_created)
    lifetimeTokens += usage.total_tokens
    const spend = calculateUsageSpend(priceRows, usage)

    if (spend != null) {
      lifetimeSpendUsd = (lifetimeSpendUsd ?? 0) + spend.totalUsd
      pricedTokens += usage.total_tokens
    } else {
      addPricingCoverageGap(pricingCoverageGaps, usage)
    }

    if (usageTime >= windowBounds.start && usageTime <= windowBounds.end) {
      windowTokens += usage.total_tokens
      if (spend != null) {
        windowSpendUsd = (windowSpendUsd ?? 0) + spend.totalUsd
        windowPricedTokens += usage.total_tokens
      }
    }
  }

  const lastSyncTime = readLastSyncTime(syncState, source)
  const hasPricedUsage = pricedTokens > 0
  const hasWindowUsage = windowTokens > 0
  const hasPricedWindowUsage = windowPricedTokens > 0

  return {
    lifetimeTokens,
    pricedTokens,
    unpricedTokens: lifetimeTokens - pricedTokens,
    lifetimeSpendUsd: hasPricedUsage ? roundUsdOrNull(lifetimeSpendUsd) : null,
    windowSpendUsd: hasWindowUsage ? (hasPricedWindowUsage ? roundUsdOrNull(windowSpendUsd) : null) : lifetimeTokens > 0 ? 0 : null,
    priceCoverage: lifetimeTokens > 0 ? pricedTokens / lifetimeTokens : 1,
    pricingCoverageGaps: [...pricingCoverageGaps.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    syncLagSeconds: lastSyncTime == null ? null : Math.max(0, now - lastSyncTime),
    ...(source ? { source } : {}),
  }
}

function startOfUtcHour(unixSeconds: number) {
  const date = new Date(unixSeconds * 1000)
  date.setUTCMinutes(0, 0, 0)
  return date
}

function startOfUtcDay(unixSeconds: number) {
  const date = new Date(unixSeconds * 1000)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function startOfUtcWeek(unixSeconds: number) {
  const date = startOfUtcDay(unixSeconds)
  const day = date.getUTCDay()
  const daysFromMonday = (day + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysFromMonday)
  return date
}

function startOfUtcMonth(unixSeconds: number) {
  const date = new Date(unixSeconds * 1000)
  date.setUTCDate(1)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

function getBucketStart(unixSeconds: number, granularity: SeriesGranularity) {
  switch (granularity) {
    case "hourly":
      return startOfUtcHour(unixSeconds)
    case "daily":
      return startOfUtcDay(unixSeconds)
    case "weekly":
      return startOfUtcWeek(unixSeconds)
    case "monthly":
      return startOfUtcMonth(unixSeconds)
  }
}

export function buildSeries(
  analyticsDbPath: string,
  pricingDbPath: string,
  options: { granularity?: SeriesGranularity; metrics?: SeriesMetric[]; window?: DashboardWindowRange; now?: number; source?: string } = {},
) {
  const usageRows = readUsageFacts(analyticsDbPath, options.source)
  const priceRows = readPricingRecords(pricingDbPath)
  const granularity = options.granularity ?? "daily"
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const windowBounds = getWindowBounds(options.window, now, "30d")
  const metrics: SeriesMetric[] = options.metrics && options.metrics.length > 0
    ? [...new Set(options.metrics)]
    : ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "cost"]
  const includeInputTokens = metrics.includes("inputTokens")
  const includeOutputTokens = metrics.includes("outputTokens")
  const includeReasoningTokens = metrics.includes("reasoningTokens")
  const includeCacheReadTokens = metrics.includes("cacheReadTokens")
  const includeCacheWriteTokens = metrics.includes("cacheWriteTokens")
  const includeCost = metrics.includes("cost")
  const buckets = new Map<string, {
    bucketStart: string
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalCostUsd: number | null
    pricedTokens: number
    unpricedTokens: number
  }>()

  for (const usage of usageRows) {
    const usageTime = normalizeAnalyticsUnixSeconds(usage.time_created)

    if (usageTime < windowBounds.start || usageTime > windowBounds.end) {
      continue
    }

    const bucketStart = getBucketStart(usageTime, granularity).toISOString()
    const bucket = buckets.get(bucketStart) ?? {
      bucketStart,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0,
      pricedTokens: 0,
      unpricedTokens: 0,
    }
    const spend = calculateUsageSpend(priceRows, usage)
    bucket.inputTokens += usage.input_tokens
    bucket.outputTokens += usage.output_tokens
    bucket.reasoningTokens += usage.reasoning_tokens
    bucket.cacheReadTokens += usage.cache_read_tokens
    bucket.cacheWriteTokens += usage.cache_write_tokens
    if (spend != null) {
      bucket.totalCostUsd = (bucket.totalCostUsd ?? 0) + spend.totalUsd
      bucket.pricedTokens += usage.total_tokens
    } else {
      bucket.unpricedTokens += usage.total_tokens
    }
    buckets.set(bucketStart, bucket)
  }

  const points = [...buckets.values()]
    .sort((a, b) => new Date(a.bucketStart).getTime() - new Date(b.bucketStart).getTime())
    .map((bucket) => {
      const point: Record<string, string | number | null> = {
        bucketStart: bucket.bucketStart,
      }

      if (granularity === "daily") {
        point.date = bucket.bucketStart.slice(0, 10)
      }

      if (includeInputTokens) {
        point.inputTokens = bucket.inputTokens
      }

      if (includeOutputTokens) {
        point.outputTokens = bucket.outputTokens
      }

      if (includeReasoningTokens) {
        point.reasoningTokens = bucket.reasoningTokens
      }

      if (includeCacheReadTokens) {
        point.cacheReadTokens = bucket.cacheReadTokens
      }

      if (includeCacheWriteTokens) {
        point.cacheWriteTokens = bucket.cacheWriteTokens
      }

      if (includeCost) {
        point.totalCostUsd = bucket.pricedTokens > 0 ? roundUsdOrNull(bucket.totalCostUsd) : null
      }

      if (bucket.pricedTokens > 0 && bucket.unpricedTokens > 0) {
        point.pricedTokens = bucket.pricedTokens
        point.unpricedTokens = bucket.unpricedTokens
      }

      return point
    })
  const metadataRangeStart = windowBounds.label === "ALL" && points[0]?.bucketStart
    ? points[0].bucketStart
    : windowBounds.rangeStart

  return {
    granularity,
    metrics,
    ...(windowBounds.includeMetadata
      ? {
          rangeStart: metadataRangeStart,
          rangeEnd: windowBounds.rangeEnd,
          windowLabel: windowBounds.label,
          bucketCount: points.length,
        }
      : {}),
    points,
  }
}

function buildSessionLeaderboardRows(analyticsDbPath: string, pricingDbPath: string, source?: string) {
  const sessions = readSessionTree(analyticsDbPath, source)
  const priceRows = readPricingRecords(pricingDbPath)
  const usageRows = readUsageFacts(analyticsDbPath, source)
  const sessionMetaById = new Map(sessions.map((session) => [session.session_id, session]))
  const usageBySession = new Map<string, { sessionId: string; totalTokens: number; totalCostUsd: number | null }>()

  for (const usage of usageRows) {
    const spend = calculateUsageSpend(priceRows, usage)
    const current = usageBySession.get(usage.session_id) ?? {
      sessionId: usage.session_id,
      totalTokens: 0,
      totalCostUsd: 0,
    }

    current.totalTokens += usage.total_tokens
    current.totalCostUsd = mergeUsdTotals(current.totalCostUsd, spend?.totalUsd ?? null)
    usageBySession.set(usage.session_id, current)
  }

  const rolledUp = rollupSessionTree(
    sessions.map((session) => ({
      sessionId: session.session_id,
      parentSessionId: session.parent_session_id,
      projectId: session.project_id,
      directory: session.directory,
      title: session.title,
    })),
    [...usageBySession.values()],
  )

  return rolledUp.map((row) => {
    const sessionMeta = sessionMetaById.get(row.sessionId)

    return {
      sessionId: row.sessionId,
      parentSessionId: row.parentSessionId ?? null,
      title: sessionMeta?.title ?? row.sessionId,
      projectId: sessionMeta?.project_id ?? row.sessionId,
      directory: sessionMeta?.directory ?? row.sessionId,
      totalTokens: row.totalTokens,
      totalCostUsd: roundUsdOrNull(row.totalCostUsd),
    }
  })
}

function applyLeaderboardLimit<T>(rows: T[], limit?: number) {
  if (typeof limit !== "number") {
    return rows
  }

  return rows.slice(0, limit)
}

export function buildCostSessionLeaderboard(analyticsDbPath: string, pricingDbPath: string, limit?: number, source?: string) {
  const sessions = buildSessionLeaderboardRows(analyticsDbPath, pricingDbPath, source)
    .sort((a, b) => (b.totalCostUsd ?? -1) - (a.totalCostUsd ?? -1) || b.totalTokens - a.totalTokens || a.sessionId.localeCompare(b.sessionId))

  return {
    sessions: applyLeaderboardLimit(sessions, limit),
  }
}

export function buildTokenSessionLeaderboard(analyticsDbPath: string, pricingDbPath: string, limit?: number, source?: string) {
  const sessions = buildSessionLeaderboardRows(analyticsDbPath, pricingDbPath, source)
    .sort((a, b) => b.totalTokens - a.totalTokens || a.sessionId.localeCompare(b.sessionId))

  return {
    sessions: applyLeaderboardLimit(sessions, limit),
  }
}

function activeJobLifecycle(job: ActiveSyncJob, status: "started" | "running") {
  return {
    status,
    jobId: job.jobId,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    heartbeatAt: Math.floor(Date.now() / 1000),
    completedAt: null,
    failedAt: null,
    lastSuccessfulSyncTime: null,
    sessionsSynced: null,
    messagesSynced: null,
    error: null,
    incomplete: false,
  }
}

async function runBackgroundSync(job: ActiveSyncJob) {
  try {
    const runner = useDefaultSyncRefreshRunner ? defaultSyncRefreshRunner : syncRefreshRunner
    const syncResult = await runner(job.rawDatabasePath, job.databasePath, job.sourceLabel, job.requestedAt)
    const completedAt = Math.floor(Date.now() / 1000)
    const durationMs = Math.max(0, Date.now() - job.startedAtMs)

    writeSyncStateValues(job.databasePath, [
      ["sync_status", "completed"],
      ["sync_job_id", job.jobId],
      ["sync_requested_at", String(job.requestedAt)],
      ["sync_started_at", String(job.startedAt)],
      ["sync_completed_at", String(completedAt)],
      ["sync_failed_at", ""],
      ["sync_error", ""],
      ["last_successful_sync_time", String(syncResult.syncedAt)],
      ["last_refresh_status", "completed"],
      ["last_refresh_requested_at", String(job.requestedAt)],
      ["last_refresh_completed_at", String(completedAt)],
      ["last_refresh_duration_ms", String(durationMs)],
      ["last_refresh_sessions_synced", String(syncResult.sessionsSynced)],
      ["last_refresh_messages_synced", String(syncResult.messagesSynced)],
      ["last_refresh_error", ""],
    ])
  } catch (error) {
    const failedAt = Math.floor(Date.now() / 1000)
    const durationMs = Math.max(0, Date.now() - job.startedAtMs)
    const message = error instanceof Error ? error.message : "sync_refresh_failed"

    writeSyncStateValues(job.databasePath, [
      ["sync_status", "failed"],
      ["sync_job_id", job.jobId],
      ["sync_requested_at", String(job.requestedAt)],
      ["sync_started_at", String(job.startedAt)],
      ["sync_completed_at", ""],
      ["sync_failed_at", String(failedAt)],
      ["sync_error", message],
      ["last_refresh_status", "failed"],
      ["last_refresh_requested_at", String(job.requestedAt)],
      ["last_refresh_completed_at", String(failedAt)],
      ["last_refresh_duration_ms", String(durationMs)],
      ["last_refresh_error", message],
    ])
  } finally {
    activeSyncJobs.delete(job.databasePath)
  }
}

export function getSyncRefreshLifecycle(databasePath: string, source?: string) {
  const active = activeSyncJobs.get(databasePath)
  if (active) {
    return activeJobLifecycle(active, "running")
  }

  return buildSyncLifecycle(readSyncState(databasePath), source)
}

export function hasActiveSyncRefresh(databasePath: string) {
  return activeSyncJobs.has(databasePath)
}

export function queueSyncRefresh(databasePath: string, rawDatabasePath: string, sourceLabel: string, now = Math.floor(Date.now() / 1000)) {
  const active = activeSyncJobs.get(databasePath)
  if (active) {
    return {
      status: "running" as const,
      jobId: active.jobId,
      requestedAt: active.requestedAt,
      startedAt: active.startedAt,
      lifecycle: activeJobLifecycle(active, "running"),
    }
  }

  const requestedAt = now
  const startedAt = Math.floor(Date.now() / 1000)
  const job: ActiveSyncJob = {
    jobId: newSyncJobId(),
    databasePath,
    rawDatabasePath,
    sourceLabel,
    requestedAt,
    startedAt,
    startedAtMs: Date.now(),
    promise: Promise.resolve(),
  }
  writeSyncStateValues(databasePath, [
    ["refresh_requested_at", String(requestedAt)],
    ["sync_status", "started"],
    ["sync_job_id", job.jobId],
    ["sync_requested_at", String(requestedAt)],
    ["sync_started_at", String(startedAt)],
    ["sync_heartbeat_at", String(startedAt)],
    ["sync_completed_at", ""],
    ["sync_failed_at", ""],
    ["sync_error", ""],
    ["last_refresh_status", "started"],
    ["last_refresh_requested_at", String(requestedAt)],
    ["last_refresh_completed_at", ""],
    ["last_refresh_error", ""],
  ])

  activeSyncJobs.set(databasePath, job)

  job.promise = new Promise<void>((resolve) => {
    setTimeout(() => {
      void runBackgroundSync(job).then(resolve)
    }, 0)
  })
  void job.promise

  return {
    status: "started" as const,
    jobId: job.jobId,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    lifecycle: activeJobLifecycle(job, "started"),
  }
}
