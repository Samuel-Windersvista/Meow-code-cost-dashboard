import { windowSelectionToQuery, type DashboardWindowSelection } from "../lib/windowSelection"
import { DashboardApiError } from "../lib/dashboard-api-error"

export type OverviewResponse = {
  lifetimeTokens: number
  lifetimeSpendUsd: number | null
  windowSpendUsd: number | null
  priceCoverage: number
  syncLagSeconds: number | null
  pricedTokens?: number
  unpricedTokens?: number
  pricingCoverageGaps?: PricingCoverageGap[]
}

export type PricingCoverageGap = {
  providerId: string
  modelId: string
  totalTokens: number
  messageCount: number
  firstSeen: number
  lastSeen: number
  reason: string
  hint: string
}

export type SeriesGranularity = "hourly" | "daily" | "weekly" | "monthly"

export type SeriesMetric = "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens" | "cacheWriteTokens" | "cost"

export type SeriesPoint = {
  bucketStart: string
  date?: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  pricedTokens?: number
  unpricedTokens?: number
  totalCostUsd?: number | null
}

export type SeriesResponse = {
  granularity: SeriesGranularity
  metrics: SeriesMetric[]
  rangeStart?: string
  rangeEnd?: string
  windowLabel?: string
  bucketCount?: number
  points: SeriesPoint[]
}

export type SyncStatusResponse = {
  state: Record<string, string>
}

export type RefreshResponse = {
  status?: "completed" | "failed" | "started" | "running" | "requested" | "interrupted" | "idle"
  jobId?: string | null
  queued?: boolean
  requestedAt: number
  startedAt?: number
  completedAt?: number
  lifecycle?: SyncLifecycle
  durationMs?: number
  sessionsSynced?: number
  messagesSynced?: number
  error?: string
}

export type SyncLifecycle = {
  status: "completed" | "failed" | "started" | "running" | "requested" | "interrupted" | "idle"
  jobId?: string | null
  requestedAt?: number | null
  startedAt?: number | null
  heartbeatAt?: number | null
  completedAt?: number | null
  failedAt?: number | null
  lastSuccessfulSyncTime?: number | null
  sessionsSynced?: number | null
  messagesSynced?: number | null
  durationMs?: number | null
  error?: string | null
}

export type AuthSessionResponse = {
  authenticated: boolean
}

export type LocalhostAuthPayload = {
  token?: string
  authFilePath?: string
}

export function normalizeLocalhostAuthPayload(payload: LocalhostAuthPayload = { authFilePath: ".run/dashboard.token" }): LocalhostAuthPayload {
  const token = payload.token?.trim()
  if (token) {
    return { token }
  }

  const authFilePath = payload.authFilePath?.trim()
  return { authFilePath: authFilePath || ".run/dashboard.token" }
}

export type BackendDiagnosticsResponse = {
  backend: { ok: boolean; now: number }
  auth: { authenticated: boolean }
  sync: null | {
    state: Record<string, string>
    lastSyncTime: number | null
    lastSuccessfulSyncTime?: number | null
    lifecycle?: SyncLifecycle
    lagSeconds: number | null
    cursors: Record<string, string>
  }
  update: {
    available: boolean
    reason?: "unauthenticated" | "offline" | string
    last?: null | {
      status: string
      sessionsSynced: number | null
      messagesSynced: number | null
      requestedAt: number | null
      completedAt: number | null
      durationMs: number | null
      error?: string | null
    }
  }
}

export type BackendControlResponse = {
  ok: boolean
  action?: "status" | "start" | "restart"
  stdout?: string
  stderr?: string
  error?: string
  detail?: string
}

export type LeaderboardSession = {
  sessionId: string
  parentSessionId: string | null
  title: string
  projectId: string
  directory: string
  totalTokens: number
  totalCostUsd: number | null
}

export type LeaderboardResponse = {
  sessions: LeaderboardSession[]
}

export type PricingRecordResponse = {
  id: string
  canonicalVendor: string
  canonicalModel: string
  vendorModelId: string
  currency: string
  inputPrice: number
  outputPrice: number
  reasoningPrice: number
  reasoningBillingRule: {
    kind: "per_token" | "included_in_output"
    provenance: {
      sourceType: "manual" | "official" | "openrouter" | "websearch"
      sourceUrl: string | null
    }
  }
  cacheReadPrice: number
  cacheWritePrice: number
  sourceType: "manual" | "official" | "openrouter" | "websearch"
  sourceUrl: string | null
  confidence: string
  isManualOverride: boolean
  observedTime: number | null
  enabled: boolean
  effectiveTime: number
  supersededTime: number | null
}

export type PricingRecordsResponse = {
  records: PricingRecordResponse[]
}

export type ObservedPricingCoverageRow = {
  observedProviderId: string
  observedModelId: string
  canonicalRecordId: string | null
  canonicalVendor: string | null
  canonicalModel: string | null
  vendorModelId: string | null
  sourceType: "manual" | "official" | "openrouter" | "websearch" | null
  sourceUrl: string | null
  confidence: string | null
  inputPrice: number | null
  outputPrice: number | null
  reasoningPrice: number | null
  cacheReadPrice: number | null
  cacheWritePrice: number | null
  messageCount: number
  totalTokens: number
  firstSeen: number
  lastSeen: number
  resolutionStatus: "priced" | "missing"
}

export type ObservedPricingCoverageResponse = {
  rows: ObservedPricingCoverageRow[]
}

export type PricingMutationResponse = {
  record?: PricingRecordResponse | null
  deleted?: boolean
}

export type CreatePricingRecordPayload = Omit<PricingRecordResponse, "observedTime" | "enabled" | "supersededTime">

export type DashboardWindow = DashboardWindowSelection

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (response.ok) {
      throw error
    }
    payload = null
  }

  if (!response.ok) {
    const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : null
    const retryable = payload && typeof payload === "object" && "retryable" in payload ? payload.retryable === true : false
    throw new DashboardApiError(response.status, code, retryable, payload)
  }

  return payload as T
}

export async function fetchOverview(window: DashboardWindow = { mode: "preset", preset: "30d" }, source?: string) {
  const params = windowSelectionToQuery(window)
  if (source) params.set("source", source)
  return await readJson<OverviewResponse>(`/api/overview/lifetime?${params.toString()}`)
}

export async function fetchSeries(
  granularity: SeriesGranularity,
  window: DashboardWindow,
  metrics: SeriesMetric[] = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "cost"],
  source?: string,
) {
  const params = new URLSearchParams({ metrics: metrics.join(",") })
  windowSelectionToQuery(window).forEach((value, key) => params.set(key, value))
  if (source) params.set("source", source)

  return await readJson<SeriesResponse>(`/api/series/${granularity}?${params.toString()}`)
}

export async function fetchSyncStatus(source?: string) {
  const params = source ? new URLSearchParams({ source }) : undefined
  const url = params ? `/api/sync/status?${params.toString()}` : "/api/sync/status"
  return await readJson<SyncStatusResponse>(url)
}

export async function requestRefresh() {
  return await readJson<RefreshResponse>("/api/sync/refresh", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export async function fetchAuthSession() {
  return await readJson<AuthSessionResponse>("/api/auth/session")
}

export async function authenticateWithLocalhostToken(payload: LocalhostAuthPayload = { authFilePath: ".run/dashboard.token" }) {
  return await readJson<AuthSessionResponse>("/api/auth/localhost-token", {
    method: "POST",
    body: JSON.stringify(normalizeLocalhostAuthPayload(payload)),
  })
}

export async function fetchBackendDiagnostics() {
  return await readJson<BackendDiagnosticsResponse>("/api/backend/diagnostics")
}

export async function fetchBackendControlStatus() {
  return await readJson<BackendControlResponse>("/__observatory/backend/status")
}

export async function startBackendService() {
  return await readJson<BackendControlResponse>("/__observatory/backend/start", {
    method: "POST",
    headers: { "x-observatory-control": "1" },
    body: JSON.stringify({}),
  })
}

export async function restartBackendService() {
  return await readJson<BackendControlResponse>("/__observatory/backend/restart", {
    method: "POST",
    headers: { "x-observatory-control": "1" },
    body: JSON.stringify({}),
  })
}

export async function fetchCostLeaderboard(limit = 5, source?: string) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (source) params.set("source", source)
  return await readJson<LeaderboardResponse>(`/api/leaderboards/cost-sessions?${params.toString()}`)
}

export async function fetchTokenLeaderboard(limit = 5, source?: string) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (source) params.set("source", source)
  return await readJson<LeaderboardResponse>(`/api/leaderboards/token-sessions?${params.toString()}`)
}

export async function fetchPricingRecords() {
  return await readJson<PricingRecordsResponse>("/api/pricing/records")
}

export async function fetchObservedPricingCoverage() {
  return await readJson<ObservedPricingCoverageResponse>("/api/pricing/observed-coverage")
}

export async function refreshPricingRecords() {
  return await readJson<RefreshResponse>("/api/pricing/refresh", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export async function updatePricingRecord(id: string, payload: Partial<PricingRecordResponse>) {
  return await readJson<PricingMutationResponse>(`/api/pricing/records/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export async function createPricingRecord(payload: CreatePricingRecordPayload) {
  return await readJson<PricingMutationResponse>("/api/pricing/records", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function deletePricingRecord(id: string) {
  return await readJson<PricingMutationResponse>(`/api/pricing/records/${id}`, {
    method: "DELETE",
  })
}
