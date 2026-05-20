import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { authenticateWithLocalhostToken, createPricingRecord, deletePricingRecord, fetchBackendControlStatus, fetchBackendDiagnostics, fetchCostLeaderboard, fetchObservedPricingCoverage, fetchOverview, fetchPricingRecords, fetchSeries, fetchSyncStatus, fetchTokenLeaderboard, requestRefresh, restartBackendService, startBackendService, updatePricingRecord, type AuthSessionResponse, type BackendControlResponse, type BackendDiagnosticsResponse, type CreatePricingRecordPayload, type DashboardWindow, type LeaderboardSession, type LocalhostAuthPayload, type ObservedPricingCoverageRow, type OverviewResponse, type PricingRecordResponse, type RefreshResponse, type SeriesGranularity, type SeriesMetric, type SeriesResponse } from "../api/client"
import { isRetryableAnalyticsBusyError } from "../lib/dashboard-api-error"
import { retryAnalyticsBusy } from "../lib/dashboard-retry"

export type { DashboardWindow } from "../api/client"

export function createDashboardRequestTracker() {
  let currentRequestId = 0

  return {
    issue() {
      currentRequestId += 1
      return currentRequestId
    },
    isCurrent(requestId: number) {
      return requestId === currentRequestId
    },
  }
}

export function createRefreshStateTracker() {
  let currentRefreshId = 0

  return {
    begin() {
      currentRefreshId += 1
      return currentRefreshId
    },
    shouldSettle(refreshId: number) {
      return refreshId === currentRefreshId
    },
  }
}

const EMPTY_OVERVIEW: OverviewResponse = {
  lifetimeTokens: 0,
  lifetimeSpendUsd: null,
  windowSpendUsd: null,
  priceCoverage: 0,
  syncLagSeconds: null,
}

const EMPTY_SERIES: SeriesResponse = {
  granularity: "daily",
  metrics: ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "cost"],
  points: [],
}

export type DashboardAlertItem = {
  id: string
  title: string
  severity: "info" | "warning" | "critical"
  action: string
  detail: string
}

const ALERT_COPY = {
  en: {
    backendOfflineTitle: "Backend offline",
    backendOfflineAction: "Start local service",
    backendOfflineDetail: "The local dashboard backend is unreachable; start the localhost service before refreshing data.",
    unauthenticatedTitle: "Local dashboard unauthenticated",
    unauthenticatedAction: "Connect local dashboard",
    unauthenticatedDetail: "Authenticate this local browser with a localhost token or .run/dashboard.token file.",
    loadFailedTitle: "Dashboard data load failed",
    retryUpdateAction: "Retry Update",
    pricingRegistryEmptyTitle: "Pricing registry empty",
    pricingRegistryEmptyAction: "Restore pricing registry",
    pricingRegistryEmptyDetail: "Token analytics are available, but the durable pricing registry is empty so spend and coverage are incomplete.",
    updateFailedTitle: "Update failed",
    inspectSyncLogsAction: "Inspect sync logs",
    updateFailedDetail: "The latest synchronous update did not complete.",
    updateInterruptedTitle: "Update interrupted",
    runUpdateAgainAction: "Run Update again",
    updateInterruptedDetail: "The previous update was interrupted before completion.",
    pricingCoverageTitle: "Pricing coverage degraded",
    pricingCoverageAction: "Review pricing sources",
    pricingCoverageDetail(coverage: number) {
      return `${Math.round(coverage * 100)}% coverage means some usage is not priced and is not included in priced spend.`
    },
    syncLagTitle: "Sync is delayed",
    syncLagAction: "Run Update",
    syncLagDetail(lagSeconds: number) {
      return `Last sync is ${Math.round(lagSeconds / 60)}m behind the local store.`
    },
    noSourceDataTitle: "No data for selected source",
    noSourceDataAction: "Switch source",
    noSourceDataDetail: "The selected data source has no usage data for the current window.",
  },
  zh: {
    backendOfflineTitle: "后端离线",
    backendOfflineAction: "启动本地服务",
    backendOfflineDetail: "本地仪表盘后端不可访问；请先启动 localhost 服务再刷新数据。",
    unauthenticatedTitle: "本地仪表盘未认证",
    unauthenticatedAction: "连接本地仪表盘",
    unauthenticatedDetail: "使用 localhost 令牌或 .run/dashboard.token 文件认证此本机浏览器。",
    loadFailedTitle: "仪表盘数据加载失败",
    retryUpdateAction: "重试更新",
    pricingRegistryEmptyTitle: "定价注册表为空",
    pricingRegistryEmptyAction: "恢复定价注册表",
    pricingRegistryEmptyDetail: "令牌分析数据可用，但持久定价注册表为空，因此支出和覆盖率不完整。",
    updateFailedTitle: "更新失败",
    inspectSyncLogsAction: "检查同步日志",
    updateFailedDetail: "最近一次同步更新未完成。",
    updateInterruptedTitle: "更新中断",
    runUpdateAgainAction: "再次运行更新",
    updateInterruptedDetail: "上一次更新在完成前中断。",
    pricingCoverageTitle: "定价覆盖下降",
    pricingCoverageAction: "检查定价来源",
    pricingCoverageDetail(coverage: number) {
      return `当前覆盖率为 ${Math.round(coverage * 100)}%，部分用量未定价，未计入已定价支出。`
    },
    syncLagTitle: "同步延迟",
    syncLagAction: "运行更新",
    syncLagDetail(lagSeconds: number) {
      return `最近同步比本地存储落后约 ${Math.round(lagSeconds / 60)} 分钟。`
    },
    noSourceDataTitle: "所选数据源无数据",
    noSourceDataAction: "切换数据源",
    noSourceDataDetail: "当前数据源在所选时间窗口内无用量数据。",
  },
}

function alertCopyFor(locale: Intl.LocalesArgument = "en-US") {
  return typeof locale === "string" && locale.startsWith("zh") ? ALERT_COPY.zh : ALERT_COPY.en
}

function hasLoadedOverviewData(overview: OverviewResponse) {
  return overview.lifetimeTokens > 0 || overview.lifetimeSpendUsd != null || overview.windowSpendUsd != null || overview.syncLagSeconds != null
}

function hasMeaningfulUpdateStatus(updateStatus: RefreshResponse | null) {
  return updateStatus?.status === "completed" || updateStatus?.status === "failed" || updateStatus?.status === "interrupted"
}

function isTerminalRefreshStatus(status: RefreshResponse["status"] | undefined) {
  return status === "completed" || status === "failed" || status === "interrupted"
}

function isNonBlockingRefreshStatus(status: RefreshResponse["status"] | undefined) {
  return status === "started" || status === "running" || status === "requested"
}

function refreshResponseFromDiagnostics(diagnostics: BackendDiagnosticsResponse): RefreshResponse | null {
  const lifecycle = diagnostics.sync?.lifecycle
  if (!lifecycle?.status) {
    return null
  }

  return {
    status: lifecycle.status,
    jobId: lifecycle.jobId,
    requestedAt: lifecycle.requestedAt ?? Math.floor(Date.now() / 1000),
    startedAt: lifecycle.startedAt ?? undefined,
    completedAt: lifecycle.completedAt ?? undefined,
    durationMs: lifecycle.durationMs ?? undefined,
    sessionsSynced: lifecycle.sessionsSynced ?? undefined,
    messagesSynced: lifecycle.messagesSynced ?? undefined,
    error: lifecycle.error ?? undefined,
    lifecycle,
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function waitForBackendPoll(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function isTerminalLifecycleStatus(status: string | null | undefined) {
  return status === "completed" || status === "failed" || status === "interrupted" || status === "idle"
}

function backendControlReportsStopped(response: BackendControlResponse) {
  return response.ok && response.action === "status" && response.stdout?.trim().toLowerCase() === "stopped"
}

function isBackendUnreachableError(error: unknown) {
  if (isRetryableAnalyticsBusyError(error)) {
    return false
  }

  if (error instanceof TypeError) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch|networkerror|network error|load failed|backend unreachable|econnrefused|connection refused|dashboard_request_failed:50[0234]/i.test(message)
}

export function buildAlertItems(args: { overview: OverviewResponse; pricingRecordCount: number; error: string | null; isLoading: boolean; authenticated: boolean; backendStatus: "offline" | "unauthenticated" | "authenticated"; updateStatus: RefreshResponse | null; locale?: Intl.LocalesArgument }) {
  if (args.isLoading) {
    return []
  }

  const alerts: DashboardAlertItem[] = []
  const copy = alertCopyFor(args.locale)
  const authenticatedDataLoaded = args.backendStatus === "authenticated" && args.authenticated && hasLoadedOverviewData(args.overview)
  const lifecycleMeaningful = hasMeaningfulUpdateStatus(args.updateStatus)

  if (args.backendStatus === "offline") {
    alerts.push({ id: "backend-offline", title: copy.backendOfflineTitle, severity: "critical", action: copy.backendOfflineAction, detail: copy.backendOfflineDetail })
  } else if (!args.authenticated || args.backendStatus === "unauthenticated") {
    alerts.push({ id: "backend-unauthenticated", title: copy.unauthenticatedTitle, severity: "warning", action: copy.unauthenticatedAction, detail: copy.unauthenticatedDetail })
  }
  if (args.error) {
    alerts.push({ id: "dashboard-error", title: copy.loadFailedTitle, severity: "warning", action: copy.retryUpdateAction, detail: args.error })
  }
  if (authenticatedDataLoaded && args.pricingRecordCount === 0) {
    alerts.push({
      id: "pricing-registry-empty",
      title: copy.pricingRegistryEmptyTitle,
      severity: "critical",
      action: copy.pricingRegistryEmptyAction,
      detail: copy.pricingRegistryEmptyDetail,
    })
  }
  if (args.backendStatus !== "offline" && args.updateStatus?.status === "failed") {
    alerts.push({ id: "update-failed", title: copy.updateFailedTitle, severity: "critical", action: copy.inspectSyncLogsAction, detail: args.updateStatus.error ?? copy.updateFailedDetail })
  }
  if (args.backendStatus !== "offline" && args.updateStatus?.status === "interrupted") {
    alerts.push({ id: "update-interrupted", title: copy.updateInterruptedTitle, severity: "warning", action: copy.runUpdateAgainAction, detail: args.updateStatus.error ?? copy.updateInterruptedDetail })
  }
  if (authenticatedDataLoaded && args.overview.priceCoverage < 1) {
    alerts.push({
      id: "pricing-coverage",
      title: copy.pricingCoverageTitle,
      severity: "warning",
      action: copy.pricingCoverageAction,
      detail: copy.pricingCoverageDetail(args.overview.priceCoverage),
    })
  }
  if ((authenticatedDataLoaded || lifecycleMeaningful) && (args.overview.syncLagSeconds ?? 0) > 15 * 60) {
    alerts.push({
      id: "sync-lag",
      title: copy.syncLagTitle,
      severity: "warning",
      action: copy.syncLagAction,
      detail: copy.syncLagDetail(args.overview.syncLagSeconds ?? 0),
    })
  }

  return alerts
}

export function useDashboardState(locale: Intl.LocalesArgument = "en-US") {
  const [window, setWindow] = useState<DashboardWindow>({ mode: "preset", preset: "24h" })
  const [granularity, setGranularity] = useState<SeriesGranularity>("daily")
  const [metric, setMetric] = useState<SeriesMetric>("cost")
  const [overview, setOverview] = useState<OverviewResponse>(EMPTY_OVERVIEW)
  const [series, setSeries] = useState<SeriesResponse>(EMPTY_SERIES)
  const [syncState, setSyncState] = useState<Record<string, string>>({})
  const [authSession, setAuthSession] = useState<AuthSessionResponse>({ authenticated: false })
  const [backendDiagnostics, setBackendDiagnostics] = useState<BackendDiagnosticsResponse | null>(null)
  const [backendStatus, setBackendStatus] = useState<"offline" | "unauthenticated" | "authenticated">("offline")
  const [updateStatus, setUpdateStatus] = useState<RefreshResponse | null>(null)
  const [backendActionStatus, setBackendActionStatus] = useState<null | "authenticating" | "authenticated" | "failed">(null)
  const [backendControlStatus, setBackendControlStatus] = useState<null | "checking" | "starting" | "restarting" | "started" | "restarted" | "failed">(null)
  const [costLeaderboard, setCostLeaderboard] = useState<LeaderboardSession[]>([])
  const [tokenLeaderboard, setTokenLeaderboard] = useState<LeaderboardSession[]>([])
  const [pricingRecords, setPricingRecords] = useState<PricingRecordResponse[]>([])
  const [observedPricingCoverage, setObservedPricingCoverage] = useState<ObservedPricingCoverageRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null)
  const requestTracker = useRef(createDashboardRequestTracker())
  const refreshTracker = useRef(createRefreshStateTracker())
  const latestQuery = useRef<{ window: DashboardWindow; granularity: SeriesGranularity }>({ window, granularity })

  const effectiveGranularity = useMemo<SeriesGranularity>(() => {
    if (window.mode === "preset" && window.preset === "all" && granularity === "hourly") {
      return "daily"
    }

    return granularity
  }, [granularity, window])

  latestQuery.current = { window, granularity: effectiveGranularity }

  const load = useCallback(async (requestId: number, nextWindow: DashboardWindow, nextGranularity: SeriesGranularity) => {
    let diagnosticsResponse: BackendDiagnosticsResponse
    try {
      diagnosticsResponse = await fetchBackendDiagnostics()
    } catch (diagnosticsError) {
      if (requestTracker.current.isCurrent(requestId)) {
        setAuthSession({ authenticated: false })
        setBackendDiagnostics(null)
        setBackendStatus("offline")
        setUpdateStatus(null)
        setOverview(EMPTY_OVERVIEW)
        setSeries(EMPTY_SERIES)
        setSyncState({})
        setCostLeaderboard([])
        setTokenLeaderboard([])
        setPricingRecords([])
        setObservedPricingCoverage([])
        setLastLoadedAt(null)
      }
      throw diagnosticsError
    }
    const authSessionResponse = { authenticated: diagnosticsResponse.auth.authenticated }

    if (!requestTracker.current.isCurrent(requestId)) {
      return false
    }

    setAuthSession(authSessionResponse)
    setBackendDiagnostics(diagnosticsResponse)
    setBackendStatus(authSessionResponse.authenticated ? "authenticated" : "unauthenticated")

    if (!authSessionResponse.authenticated) {
      setOverview(EMPTY_OVERVIEW)
      setSeries(EMPTY_SERIES)
      setSyncState(diagnosticsResponse.sync?.state ?? {})
      setCostLeaderboard([])
      setTokenLeaderboard([])
      setPricingRecords([])
      setObservedPricingCoverage([])
      setLastLoadedAt(null)
      return diagnosticsResponse
    }

    const [overviewResponse, seriesResponse, syncResponse, costLeaderboardResponse, tokenLeaderboardResponse, pricingRecordsResponse, observedCoverageResponse] = await Promise.all([
      fetchOverview(nextWindow),
      fetchSeries(nextGranularity, nextWindow, ["cost", "inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"]),
      fetchSyncStatus(),
      fetchCostLeaderboard(),
      fetchTokenLeaderboard(),
      fetchPricingRecords(),
      fetchObservedPricingCoverage(),
    ])

    if (!requestTracker.current.isCurrent(requestId)) {
      return false
    }

    setOverview(overviewResponse)
    setSeries(seriesResponse)
    setSyncState(syncResponse.state)
    setCostLeaderboard(costLeaderboardResponse.sessions)
    setTokenLeaderboard(tokenLeaderboardResponse.sessions)
    setPricingRecords(pricingRecordsResponse.records)
    setObservedPricingCoverage(observedCoverageResponse.rows)
    setLastLoadedAt(Date.now())
    return diagnosticsResponse
  }, [])

  const loadWithBusyRetry = useCallback(async (requestId: number, nextWindow: DashboardWindow, nextGranularity: SeriesGranularity) => {
    return await retryAnalyticsBusy(() => load(requestId, nextWindow, nextGranularity))
  }, [load])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setIsLoading(true)
      setError(null)
      const requestId = requestTracker.current.issue()

      try {
        await loadWithBusyRetry(requestId, window, effectiveGranularity)
      } catch (loadError) {
        if (!cancelled && requestTracker.current.isCurrent(requestId)) {
          setError("dashboard_load_failed")
        }
      } finally {
        if (!cancelled && requestTracker.current.isCurrent(requestId)) {
          setIsLoading(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [effectiveGranularity, loadWithBusyRetry, window])

  const reload = useCallback(async () => {
    if (!authSession.authenticated) {
      return
    }

    setError(null)
    const refreshId = refreshTracker.current.begin()
    const requestId = requestTracker.current.issue()

    try {
      await loadWithBusyRetry(requestId, window, effectiveGranularity)
    } catch (refreshError) {
      if (requestTracker.current.isCurrent(requestId)) {
        setError("dashboard_refresh_failed")
      }
    } finally {
      if (refreshTracker.current.shouldSettle(refreshId)) {
        setIsRefreshing(false)
      }
    }
  }, [authSession.authenticated, effectiveGranularity, loadWithBusyRetry, window])

  const markBackendStopped = useCallback(() => {
    requestTracker.current.issue()
    setAuthSession({ authenticated: false })
    setBackendDiagnostics(null)
    setBackendStatus("offline")
    setUpdateStatus(null)
    setOverview(EMPTY_OVERVIEW)
    setSeries(EMPTY_SERIES)
    setSyncState({})
    setCostLeaderboard([])
    setTokenLeaderboard([])
    setPricingRecords([])
    setObservedPricingCoverage([])
    setLastLoadedAt(null)
  }, [])

  const refresh = useCallback(async () => {
    if (!authSession.authenticated) {
      return
    }

    setIsRefreshing(true)
    setError(null)
    const refreshId = refreshTracker.current.begin()

    try {
      let refreshResponse = await requestRefresh()
      setUpdateStatus(refreshResponse)

      if (isNonBlockingRefreshStatus(refreshResponse.status)) {
        for (let attempt = 0; attempt < 120 && isNonBlockingRefreshStatus(refreshResponse.status); attempt += 1) {
          await delay(1_000)
          const diagnostics = await fetchBackendDiagnostics()
          setBackendDiagnostics(diagnostics)
          setAuthSession({ authenticated: diagnostics.auth.authenticated })
          setBackendStatus(diagnostics.auth.authenticated ? "authenticated" : "unauthenticated")
          const nextRefreshResponse = refreshResponseFromDiagnostics(diagnostics)
          if (nextRefreshResponse) {
            refreshResponse = nextRefreshResponse
            setUpdateStatus(nextRefreshResponse)
          }
        }

        if (!isTerminalRefreshStatus(refreshResponse.status)) {
          refreshResponse = {
            ...refreshResponse,
            status: "interrupted",
            error: "sync_refresh_poll_timeout",
            lifecycle: refreshResponse.lifecycle
              ? { ...refreshResponse.lifecycle, status: "interrupted", error: "sync_refresh_poll_timeout" }
              : undefined,
          }
          setUpdateStatus(refreshResponse)
        }
      }

      const requestId = requestTracker.current.issue()
      const query = latestQuery.current
      await loadWithBusyRetry(requestId, query.window, query.granularity)
    } catch (refreshError) {
      if (isBackendUnreachableError(refreshError)) {
        markBackendStopped()
        setError(null)
      } else {
        setUpdateStatus({ status: "failed", requestedAt: Math.floor(Date.now() / 1000), error: "dashboard_refresh_failed" })
        setError("dashboard_refresh_failed")
      }
    } finally {
      if (refreshTracker.current.shouldSettle(refreshId)) {
        setIsRefreshing(false)
      }
    }
  }, [authSession.authenticated, loadWithBusyRetry, markBackendStopped])

  const authenticateBackend = useCallback(async (payload?: LocalhostAuthPayload) => {
    setBackendActionStatus("authenticating")
    setError(null)
    try {
      await authenticateWithLocalhostToken(payload)
      setBackendActionStatus("authenticated")
      const requestId = requestTracker.current.issue()
      const query = latestQuery.current
      await loadWithBusyRetry(requestId, query.window, query.granularity)
    } catch {
      setBackendActionStatus("failed")
      setError("dashboard_auth_failed")
    }
  }, [loadWithBusyRetry])

  const reloadAfterBackendControl = useCallback(async () => {
    const requestId = requestTracker.current.issue()
    const query = latestQuery.current
    await loadWithBusyRetry(requestId, query.window, query.granularity)
  }, [loadWithBusyRetry])

  const checkBackend = useCallback(async () => {
    setBackendControlStatus("checking")
    setError(null)
    try {
      const controlStatus = await fetchBackendControlStatus()
      if (backendControlReportsStopped(controlStatus)) {
        markBackendStopped()
        setBackendControlStatus(null)
        return
      }
      await reloadAfterBackendControl()
      setBackendControlStatus(null)
    } catch {
      setBackendControlStatus("failed")
      setError("backend_control_failed")
    }
  }, [markBackendStopped, reloadAfterBackendControl])

  const startBackend = useCallback(async () => {
    setBackendControlStatus("starting")
    setError(null)
    try {
      await startBackendService()
      setBackendControlStatus("started")
      await reloadAfterBackendControl()
    } catch {
      setBackendControlStatus("failed")
      setError("backend_control_failed")
    }
  }, [reloadAfterBackendControl])

  const restartBackend = useCallback(async () => {
    setBackendControlStatus("restarting")
    setError(null)
    try {
      await restartBackendService()
      setBackendControlStatus("restarted")
      await reloadAfterBackendControl()
    } catch {
      setBackendControlStatus("failed")
      setError("backend_control_failed")
    }
  }, [reloadAfterBackendControl])

  const activeAlertItems = useMemo(() => buildAlertItems({ overview, pricingRecordCount: pricingRecords.length, error, isLoading, authenticated: authSession.authenticated, backendStatus, updateStatus, locale }), [authSession.authenticated, backendStatus, error, isLoading, locale, overview, pricingRecords.length, updateStatus])
  const activeAlerts = activeAlertItems.length

  const archivePricing = useCallback(async (id: string) => {
    try {
      await deletePricingRecord(id)
      await reload()
    } catch {
      setError("dashboard_refresh_failed")
    }
  }, [reload])

  const markPricingManual = useCallback(async (record: PricingRecordResponse) => {
    try {
      await updatePricingRecord(record.id, {
        sourceType: "manual",
        isManualOverride: true,
        sourceUrl: record.sourceUrl,
        reasoningBillingRule: {
          ...record.reasoningBillingRule,
          provenance: {
            sourceType: "manual",
            sourceUrl: record.sourceUrl,
          },
        },
      })
      await reload()
    } catch {
      setError("dashboard_refresh_failed")
    }
  }, [reload])

  const savePricing = useCallback(async (record: PricingRecordResponse, patch: Partial<PricingRecordResponse>) => {
    try {
      await updatePricingRecord(record.id, {
        ...patch,
        reasoningBillingRule: patch.sourceUrl
          ? {
              ...record.reasoningBillingRule,
              provenance: {
                ...record.reasoningBillingRule.provenance,
                sourceUrl: patch.sourceUrl,
              },
            }
          : patch.reasoningBillingRule,
      })
      await reload()
    } catch {
      setError("dashboard_refresh_failed")
    }
  }, [reload])

  const createPricing = useCallback(async (payload: CreatePricingRecordPayload) => {
    try {
      await createPricingRecord(payload)
      await reload()
    } catch {
      setError("dashboard_refresh_failed")
    }
  }, [reload])

  return {
    window,
    setWindow,
    granularity: effectiveGranularity,
    setGranularity,
    metric,
    setMetric,
    overview,
    series,
    syncState,
    authSession,
    backendStatus,
    backendDiagnostics,
    updateStatus,
    costLeaderboard,
    tokenLeaderboard,
    pricingRecords,
    observedPricingCoverage,
    isLoading,
    isRefreshing,
    error,
    activeAlerts,
    activeAlertItems,
    lastLoadedAt,
    refresh,
    authenticateBackend,
    startBackend,
    restartBackend,
    checkBackend,
    backendActionStatus,
    backendControlStatus,
    archivePricing,
    markPricingManual,
    savePricing,
    createPricing,
  }
}
