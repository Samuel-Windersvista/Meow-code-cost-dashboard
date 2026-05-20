import { HeroCards } from "../components/HeroCards"
import { LeaderboardTables } from "../components/LeaderboardTables"
import { LanguageToggle } from "../components/LanguageToggle"
import { MainSeriesChart } from "../components/MainSeriesChart"
import { SourceSelector } from "../components/SourceSelector"
import { BackendManagementPanel } from "../components/BackendManagementPanel"
import { SecondaryPanels } from "../components/SecondaryPanels"
import { useDashboardState } from "../hooks/useDashboardState"
import { useI18n } from "../hooks/useI18n"
import { describeWindowSelection } from "../lib/windowSelection"

export function buildStatusText(args: {
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  errorLabel: string
  lastLoadedAt: number | null
  authenticated: boolean
  unauthenticatedLabel: string
  liveLabel: string
  runningLabel: string
  locale: Intl.LocalesArgument
}) {
  if (args.error) {
    return args.errorLabel
  }

  if (args.isLoading) {
    return args.liveLabel
  }

  if (args.isRefreshing) {
    return args.runningLabel
  }

  if (!args.authenticated) {
    return args.unauthenticatedLabel
  }

  if (args.lastLoadedAt == null) {
    return args.liveLabel
  }

  return `${args.liveLabel} · ${new Date(args.lastLoadedAt).toLocaleTimeString(args.locale, {
    hour: "2-digit",
    minute: "2-digit",
  })}`
}

export function deriveSystemStateTone(args: {
  isLoading: boolean
  error: string | null
  authenticated: boolean
  unauthenticatedLabel: string
  liveLabel: string
  loadingLabel: string
  errorLabel: string
}) {
  if (args.error) {
    return args.errorLabel
  }

  if (args.isLoading) {
    return args.loadingLabel
  }

  if (!args.authenticated) {
    return args.unauthenticatedLabel
  }

  return args.liveLabel
}

function formatLagSummary(lagSeconds: number | null, copy: ReturnType<typeof useI18n>["copy"]) {
  if (lagSeconds == null) {
    return copy.never
  }

  if (lagSeconds < 60) {
    return `${lagSeconds}${copy.secondsShort}`
  }

  if (lagSeconds < 3600) {
    return `${Math.round(lagSeconds / 60)}${copy.minutesShort}`
  }

  if (lagSeconds < 86400) {
    return `${Math.round(lagSeconds / 3600)}${copy.hoursShort}`
  }

  return `${Math.round(lagSeconds / 86400)}${copy.daysShort}`
}

function formatBackendSyncSummary(lagSeconds: number | null, copy: ReturnType<typeof useI18n>["copy"]) {
  if (lagSeconds == null) {
    return copy.unknown
  }

  const tone = lagSeconds > 15 * 60 ? copy.delayed : copy.healthy
  return `${tone} · ${formatLagSummary(lagSeconds, copy)} ${copy.lag}`
}

function formatWindowSummary(window: ReturnType<typeof useDashboardState>["window"], granularityLabel: string, copy: ReturnType<typeof useI18n>["copy"]) {
  const windowLabel = window.mode === "custom"
    ? `${copy.customWindow} ${describeWindowSelection(window)}`
    : {
        "24h": copy.twentyFourHours,
        "7d": copy.sevenDaysShort,
        "30d": copy.thirtyDaysShort,
        "90d": copy.ninetyDaysShort,
        all: copy.allTime,
      }[window.preset]

  return `${windowLabel} · ${granularityLabel}`
}

function formatWindowBadge(window: ReturnType<typeof useDashboardState>["window"], copy: ReturnType<typeof useI18n>["copy"]) {
  if (window.mode === "custom") {
    return describeWindowSelection(window)
  }

  return {
    "24h": copy.twentyFourHours,
    "7d": copy.sevenDaysShort,
    "30d": copy.thirtyDaysShort,
    "90d": copy.ninetyDaysShort,
    all: copy.allTime,
  }[window.preset]
}

export default function DashboardPage() {
  const { language, locale, copy, toggleLanguage } = useI18n()
  const {
    window,
    setWindow,
    selectedSource,
    setSelectedSource,
    granularity,
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
    activeAlerts,
    activeAlertItems,
    isLoading,
    isRefreshing,
    error,
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
  } = useDashboardState(locale)

  const granularityLabel = {
    hourly: copy.hourly,
    daily: copy.daily,
    weekly: copy.weekly,
    monthly: copy.monthly,
  }[granularity]

  const statusText = buildStatusText({
    isLoading,
    isRefreshing,
    error,
    errorLabel: copy.attentionRequired,
    lastLoadedAt,
    authenticated: authSession.authenticated,
    unauthenticatedLabel: copy.unauthenticated,
    liveLabel: copy.live,
    runningLabel: copy.refreshing,
    locale,
  })
  const lastSyncEpochSeconds = Number(syncState.last_sync_time ?? syncState.raw_opencode_messages_cursor ?? syncState.raw_opencode_sessions_cursor ?? Number.NaN)
  const diagnosticLagSeconds = backendDiagnostics?.sync?.lagSeconds ?? overview.syncLagSeconds
  const backendHealthLabel = backendStatus === "offline" ? copy.backendOffline : copy.backendOnline
  return (
    <main className="dashboard-shell" data-language={language}>
      <section className="dashboard-backdrop" />

      <header className="dashboard-header">
        <div className="dashboard-header__copy">
          <p className="dashboard-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="dashboard-subtitle">{copy.subtitle}</p>
        </div>

        <div className="dashboard-header__actions">
          <div className="dashboard-header__status-grid">
            <div className="status-panel__block dashboard-header__status-card">
              <span className="status-panel__label">{copy.authSession}</span>
              <strong>{authSession.authenticated ? copy.authenticated : copy.unauthenticated}</strong>
            </div>
            <BackendManagementPanel
              ariaLabel={copy.backendDiagnostics}
              backendHealthLabel={backendHealthLabel}
              authenticatedLabel={copy.authenticated}
              unauthenticatedLabel={copy.unauthenticated}
              isAuthenticated={authSession.authenticated}
              isBackendOnline={backendStatus !== "offline"}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              status={statusText}
              refreshLabel={copy.refresh}
              refreshingLabel={copy.refreshing}
              onRefresh={refresh}
              onAuthenticate={authenticateBackend}
              onStartBackend={startBackend}
              onRestartBackend={restartBackend}
              onCheckBackend={checkBackend}
              backendActionStatus={backendActionStatus}
              backendControlStatus={backendControlStatus}
              diagnostics={backendDiagnostics}
              updateStatus={updateStatus}
              lagSummary={formatBackendSyncSummary(diagnosticLagSeconds, copy)}
              locale={locale}
              labels={{
                backendOfflineUpdateDisabled: copy.backendOfflineUpdateDisabled,
                unauthenticatedUpdateDisabled: copy.unauthenticatedUpdateDisabled,
                connectingDashboard: copy.connectingDashboard,
                tokenAuthFailed: copy.tokenAuthFailed,
                tokenFileHelp: copy.tokenFileHelp,
                lastSuccessfulSync: copy.lastSuccessfulSync,
                lastUpdateAttempt: copy.lastUpdateAttempt,
                connectDashboard: copy.connectDashboard,
                dashboardToken: copy.dashboardToken,
                tokenFilePath: copy.tokenFilePath,
                localOnlyDescription: copy.localOnlyDescription,
                startingBackend: copy.startingBackend,
                restartingBackend: copy.restartingBackend,
                checkingBackend: copy.checkingBackend,
                backendControlFailed: copy.backendControlFailed,
                backendControlCompleted: copy.backendControlCompleted,
                backendControlHelp: copy.backendControlHelp,
                startBackend: copy.startBackend,
                restartBackend: copy.restartBackend,
                retryStatus: copy.retryStatus,
              }}
            />
          </div>
          <div className="dashboard-header__source-row">
            <SourceSelector
              selectedSource={selectedSource}
              onSourceChange={setSelectedSource}
              labels={{
                allSources: copy.allSources,
                sourceOpencode: copy.sourceOpencode,
                sourceHermes: copy.sourceHermes,
              }}
            />
            <LanguageToggle language={language} label={copy.switchLanguage} onToggle={toggleLanguage} />
          </div>
        </div>
      </header>

      <HeroCards
        overview={overview}
        trendPoints={series.points.map((point) => point.totalCostUsd ?? 0).slice(-8)}
        activeAlerts={activeAlerts}
        activeAlertItems={activeAlertItems}
        isLoading={isLoading}
        lastSyncEpochSeconds={Number.isFinite(lastSyncEpochSeconds) ? lastSyncEpochSeconds : null}
        locale={locale}
        labels={{
          lifetimeSpend: copy.lifetimeSpend,
          windowSpend: copy.windowSpend,
          activeAlerts: copy.activeAlerts,
          priceCoverage: copy.priceCoverage,
          syncLag: copy.syncLag,
          totalTokens: copy.totalTokens,
          never: copy.never,
          secondsShort: copy.secondsShort,
          minutesShort: copy.minutesShort,
          hoursShort: copy.hoursShort,
          daysShort: copy.daysShort,
          thirtyDayWindow: copy.thirtyDayWindow,
          synced: copy.synced,
          lastSync: copy.lastSync,
          trendStrip: copy.trendStrip,
          percentOfLifetime: copy.percentOfLifetime,
          investigateSignals: copy.investigateSignals,
          noWarnings: copy.noWarnings,
          selectedWindowBadge: formatWindowBadge(window, copy),
          severityCritical: language === "zh" ? "严重" : "Critical",
          severityWarning: language === "zh" ? "警告" : "Warning",
          severityInfo: language === "zh" ? "信息" : "Info",
          action: copy.action,
        }}
      />

      <div className="dashboard-main-grid">
        <div className="dashboard-main-grid__primary">
          <MainSeriesChart
            points={series.points}
            metadata={{
              rangeStart: series.rangeStart,
              rangeEnd: series.rangeEnd,
              windowLabel: series.windowLabel ?? formatWindowBadge(window, copy),
              bucketCount: series.bucketCount,
            }}
            availableMetrics={series.metrics}
            window={window}
            onWindowChange={setWindow}
            selectedWindowSummary={formatWindowSummary(window, granularityLabel, copy)}
            granularity={granularity}
            onGranularityChange={setGranularity}
            isLoading={isLoading}
            loadingLabel={copy.loading}
            locale={locale}
            metric={metric}
            onMetricChange={setMetric}
            priceCoverage={overview.priceCoverage}
            pricingRecords={pricingRecords}
            pricingCoverageGaps={overview.pricingCoverageGaps}
            labels={{
              series: copy.series,
              chartTitle: copy.chartTitle,
              chartSubtitle: copy.chartSubtitle,
              noSeries: copy.noSeries,
              cost: copy.cost,
              input: copy.input,
              output: copy.output,
              reasoning: copy.reasoning,
              cacheRead: copy.cacheRead,
              cacheWrite: copy.cacheWrite,
              metricLabel: copy.metricLabel,
              insightRail: copy.insightRail,
              latestBucket: copy.latestBucket,
              peakValue: copy.peakValue,
              selectedMetric: copy.selectedMetric,
              anomalyAlerts: copy.anomalyAlerts,
              topModelShare: copy.topModelShare,
              pricingIssues: copy.pricingIssues,
              // chart copy fields
              range: copy.range,
              buckets: copy.buckets,
              unit: copy.unit,
              xAxis: copy.xAxis,
              yAxis: copy.yAxis,
              seriesDetails: copy.seriesDetails,
              showing: copy.showing,
              of: copy.of,
              noActiveSpikes: copy.noActiveSpikes,
              noSpikeAlerts: copy.noSpikeAlerts,
              modelShareUnavailable: copy.modelShareUnavailable,
              noOpenIssues: copy.noOpenIssues,
              noPricingIssues: copy.noPricingIssues,
              firstSeen: copy.firstSeen,
              lastSeen: copy.lastSeen,
              reason: copy.reason,
              hint: copy.hint,
              unavailable: copy.unavailable,
              expand: copy.expand,
              collapse: copy.collapse,
              // unit/label fields
              usdUnit: copy.usdUnit,
              tokensUnit: copy.tokensUnit,
              zeroSelectedMetric: copy.zeroSelectedMetric,
              noActivity: copy.noActivity,
              windowEmpty: copy.windowEmpty,
              spikeSingular: copy.spikeSingular,
              spikePlural: copy.spikePlural,
              issueSingular: copy.issueSingular,
              issuePlural: copy.issuePlural,
              modelSingular: copy.modelSingular,
              // enum fields
              enumStale: copy.enumStale,
              enumActive: copy.enumActive,
              enumDisabled: copy.enumDisabled,
              emptyState: copy.emptyState,
              controls: {
                windowLabel: copy.windowLabel,
                selectedWindow: copy.selectedWindow,
                customWindow: copy.customWindow,
                startDate: copy.startDate,
                endDate: copy.endDate,
                invalidCustomWindow: copy.invalidCustomWindow,
                granularityLabel: copy.granularityLabel,
                metricLabel: copy.metricLabel,
                oneHour: copy.oneHour,
                twentyFourHours: copy.twentyFourHours,
                sevenDaysShort: copy.sevenDaysShort,
                thirtyDaysShort: copy.thirtyDaysShort,
                ninetyDaysShort: copy.ninetyDaysShort,
                allTime: copy.allTime,
                hourly: copy.hourly,
                daily: copy.daily,
                weekly: copy.weekly,
                monthly: copy.monthly,
                cost: copy.cost,
                input: copy.input,
                output: copy.output,
                reasoning: copy.reasoning,
                cacheRead: copy.cacheRead,
                cacheWrite: copy.cacheWrite,
              },
            }}
          />

          <SecondaryPanels
            overview={overview}
            points={series.points}
            pricingRecords={pricingRecords}
            labels={{
              secondaryTitle: copy.series,
              cacheEfficiency: copy.cacheEfficiency,
              pricingCoverage: copy.priceCoverage,
              freshness: copy.freshness,
              activePricing: copy.activePricing,
              effectiveCost: copy.effectiveCost,
              source: copy.pricingSources,
              // new dictionary fields
              unavailable: copy.unavailable,
              noActivity: copy.noActivity,
              expand: copy.expand,
              collapse: copy.collapse,
              effectiveCostFormula: copy.effectiveCostFormula,
              basedOnPricedTokens: copy.basedOnPricedTokens,
              pricingCoverageLabel: copy.pricingCoverageLabel,
              enumStale: copy.enumStale,
              enumActive: copy.enumActive,
              enumDisabled: copy.enumDisabled,
            }}
            locale={locale}
          />

          <LeaderboardTables
            costSessions={costLeaderboard}
            tokenSessions={tokenLeaderboard}
            pricingRecords={pricingRecords}
            observedPricingCoverage={observedPricingCoverage}
            points={series.points}
            locale={locale}
            onArchivePricing={archivePricing}
            onMarkPricingManual={markPricingManual}
            onSavePricing={savePricing}
            onCreatePricing={createPricing}
            priceCoverage={overview.priceCoverage}
            pricingCoverageGaps={overview.pricingCoverageGaps}
            labels={{
              expensiveSessions: copy.expensiveSessions,
              tokenSessions: copy.tokenSessions,
              pricingDrilldown: copy.pricingDrilldown,
              observedProviderCoverage: copy.observedProviderCoverage,
              windowBreakdown: copy.selectedWindow,
              pricingFreshness: copy.freshness,
              title: copy.analysisPanels,
              cost: copy.cost,
              tokens: copy.tokens,
              source: copy.source,
              input: copy.input,
              output: copy.output,
              reasoning: copy.reasoning,
              cacheRead: copy.cacheRead,
              edit: copy.edit,
              missingPricing: copy.missingPricing,
              archive: copy.archive,
              manual: copy.manual,
              save: copy.save,
              cacheWrite: copy.cacheWrite,
              confidence: copy.confidence,
              observed: copy.observed,
              effective: copy.effective,
              enabled: copy.enabled,
              superseded: copy.superseded,
              reasoningRule: copy.reasoningRule,
              yes: copy.yes,
              no: copy.no,
              // localCopy fields
              noSessions: copy.noSessions,
              sessions: copy.sessionsUnit,
              unavailable: copy.unavailable,
              records: copy.recordsUnit,
              gap: copy.gap,
              firstSeen: copy.firstSeen,
              lastSeen: copy.lastSeen,
              reason: copy.reason,
              hint: copy.hint,
              noGaps: copy.noGaps,
              noSessionsAvailable: copy.noSessionsAvailable,
              pricingRecordsUnavailable: copy.pricingRecordsUnavailable,
              current: copy.current,
              freshnessUnavailable: copy.freshnessUnavailable,
              noMissingPricing: copy.noMissingPricing,
              noObservedCoverage: copy.noObservedCoverage,
              pricedVia: copy.pricedVia,
              unpriced: copy.unpriced,
              expand: copy.expand,
              collapse: copy.collapse,
              models: copy.modelsUnit,
              messages: copy.messagesUnit,
              // formatEnum fields
              enumManual: copy.enumManual,
              enumOfficial: copy.enumOfficial,
              enumOpenRouter: copy.enumOpenRouter,
              enumWebSearch: copy.enumWebSearch,
              enumPerToken: copy.enumPerToken,
              enumIncludedInOutput: copy.enumIncludedInOutput,
              enumStale: copy.enumStale,
              enumActive: copy.enumActive,
              enumDisabled: copy.enumDisabled,
              enumPriced: copy.enumPriced,
              enumMissing: copy.enumMissing,
              // singular/plural
              modelSingular: copy.modelSingular,
            }}
          />
        </div>

      </div>
    </main>
  )
}
