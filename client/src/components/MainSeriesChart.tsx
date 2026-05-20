import type { PricingCoverageGap, PricingRecordResponse, SeriesMetric, SeriesPoint } from "../api/client"
import type { DashboardWindow } from "../hooks/useDashboardState"
import { CollapsiblePanel } from "./CollapsiblePanel"
import { TimeControls } from "./TimeControls"

type ChartGranularity = "hourly" | "daily" | "weekly" | "monthly"

type ChartMetadata = {
  rangeStart?: string
  rangeEnd?: string
  windowLabel?: string
  bucketCount?: number
}

function formatUsd(value: number | null | undefined, locale?: Intl.LocalesArgument) {
  if (value == null) {
    return "--"
  }

  const fractionDigits = value === 0 ? 2 : value >= 100 ? 0 : value >= 1 ? 2 : 4

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatBucketLabel(point: SeriesPoint, granularity: ChartGranularity, locale?: Intl.LocalesArgument, showYear = false) {
  const date = new Date(point.bucketStart)
  if (Number.isNaN(date.getTime())) {
    return point.bucketStart
  }

  switch (granularity) {
    case "hourly":
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        year: showYear ? "numeric" : undefined,
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    case "monthly":
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
      }).format(date)
    case "weekly":
    case "daily":
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        year: showYear ? "numeric" : undefined,
        month: "short",
        day: "numeric",
      }).format(date)
  }
}

function formatIsoDate(value: string | undefined, locale?: Intl.LocalesArgument) {
  if (!value) {
    return "--"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function formatRangeIsoDate(value: string | undefined) {
  return value?.slice(0, 10) ?? "--"
}

function isUnixEpochRangeStart(value: string | undefined) {
  return value === "1970-01-01T00:00:00.000Z" || value === "1970-01-01"
}

function isChineseLocale(locale?: Intl.LocalesArgument) {
  return typeof locale === "string" && locale.startsWith("zh")
}

function granularityLabel(granularity: ChartGranularity, locale?: Intl.LocalesArgument) {
  if (isChineseLocale(locale)) {
    return {
      hourly: "每小时",
      daily: "每日",
      weekly: "每周",
      monthly: "每月",
    }[granularity]
  }

  return granularity.slice(0, 1).toUpperCase() + granularity.slice(1)
}

function buildPolyline(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x},${point.y}`).join(" ")
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function buildXAxisTickIndices(pointCount: number) {
  if (pointCount <= 0) {
    return []
  }

  const maxTickCount = pointCount > 5 ? 5 : Math.min(3, pointCount)
  const indices = new Set<number>()
  for (let tick = 0; tick < maxTickCount; tick += 1) {
    const ratio = maxTickCount === 1 ? 0 : tick / (maxTickCount - 1)
    indices.add(Math.round(ratio * (pointCount - 1)))
  }

  return Array.from(indices).sort((a, b) => a - b)
}

function buildXAxisTicks(
  pointCount: number,
  xForIndex: (index: number) => number,
  plot: { left: number; right: number },
) {
  const minSpacing = 72
  const estimatedLabelWidth = 64
  const candidateIndices = buildXAxisTickIndices(pointCount)
  const lastCandidateIndex = candidateIndices.at(-1)
  const labelXForPosition = (x: number, position: "first" | "middle" | "last") => {
    if (position === "first") {
      return clamp(x, plot.left, plot.right)
    }
    if (position === "last") {
      return clamp(x, plot.left, plot.right)
    }
    return clamp(x, plot.left + estimatedLabelWidth / 2, plot.right - estimatedLabelWidth / 2)
  }
  const lastCandidateX = lastCandidateIndex == null ? null : labelXForPosition(xForIndex(lastCandidateIndex), "last")
  const ticks: Array<{ index: number; x: number; textAnchor: "start" | "middle" | "end" }> = []

  for (const [candidatePosition, index] of candidateIndices.entries()) {
    const isFirstCandidate = candidatePosition === 0
    const isLastCandidate = index === lastCandidateIndex
    const position = isLastCandidate ? "last" : isFirstCandidate ? "first" : "middle"
    const x = labelXForPosition(xForIndex(index), position)
    const previousTick = ticks.at(-1)

    if (previousTick && x - previousTick.x < minSpacing) {
      continue
    }

    if (!isLastCandidate && lastCandidateX != null && lastCandidateX - x < minSpacing) {
      continue
    }

    ticks.push({
      index,
      x,
      textAnchor: position === "first" ? "start" : position === "last" ? "end" : "middle",
    })
  }

  return ticks
}

function getMetricValue(point: SeriesPoint, metric: SeriesMetric) {
  switch (metric) {
    case "cost":
      return point.totalCostUsd
    case "inputTokens":
      return point.inputTokens ?? 0
    case "outputTokens":
      return point.outputTokens ?? 0
    case "reasoningTokens":
      return point.reasoningTokens ?? 0
    case "cacheReadTokens":
      return point.cacheReadTokens ?? 0
    case "cacheWriteTokens":
      return point.cacheWriteTokens ?? 0
  }
}

function hasAnyBucketActivity(point: SeriesPoint) {
  return (point.inputTokens ?? 0) > 0
    || (point.outputTokens ?? 0) > 0
    || (point.reasoningTokens ?? 0) > 0
    || (point.cacheReadTokens ?? 0) > 0
    || (point.cacheWriteTokens ?? 0) > 0
    || (point.totalCostUsd ?? 0) > 0
}

function getBucketTokenActivity(point: SeriesPoint) {
  return (point.inputTokens ?? 0)
    + (point.outputTokens ?? 0)
    + (point.reasoningTokens ?? 0)
    + (point.cacheReadTokens ?? 0)
    + (point.cacheWriteTokens ?? 0)
}

function getBucketActivityHeat(activity: number, maxActivity: number) {
  if (activity <= 0 || maxActivity <= 0) {
    return undefined
  }

  const normalized = clamp(activity / maxActivity, 0, 1)
  const scaled = (Math.exp(2.6 * normalized) - 1) / (Math.exp(2.6) - 1)
  const alpha = 0.025 + scaled * (0.42 - 0.025)

  return {
    activityLevel: Math.max(1, Math.ceil(scaled * 5)),
    activityAlpha: alpha,
  }
}

function formatMetricValue(value: number | null, metric: SeriesMetric, locale?: Intl.LocalesArgument) {
  if (metric === "cost") {
    return formatUsd(value, locale)
  }

  if (value == null) {
    return "--"
  }

  return new Intl.NumberFormat(locale, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

function unitForMetric(metric: SeriesMetric, labels: Record<string, string>) {
  if (metric === "cost") {
    return labels.usdUnit
  }

  return labels.tokensUnit
}

function zeroValueNote(point: SeriesPoint, metricValue: number, labels: Record<string, string>) {
  if (metricValue !== 0) {
    return ""
  }

  if (hasAnyBucketActivity(point)) {
    return labels.zeroSelectedMetric
  }

  return labels.noActivity
}

function chartCopy(labels: Record<string, string>) {
  return {
    range: labels.range,
    buckets: labels.buckets,
    unit: labels.unit,
    xAxis: labels.xAxis,
    yAxis: labels.yAxis,
    details: labels.seriesDetails,
    showing: labels.showing,
    of: labels.of,
    noActiveSpikes: labels.noActiveSpikes,
    noSpikeAlerts: labels.noSpikeAlerts,
    unavailable: labels.unavailable,
    modelShareUnavailable: labels.modelShareUnavailable,
    noOpenIssues: labels.noOpenIssues,
    noPricingIssues: labels.noPricingIssues,
    firstSeen: labels.firstSeen,
    lastSeen: labels.lastSeen,
    reason: labels.reason,
    hint: labels.hint,
    expand: labels.expand,
    collapse: labels.collapse,
  }
}

function formatUnixTime(value: number | null | undefined, labels: Record<string, string>, locale?: Intl.LocalesArgument) {
  return value == null ? chartCopy(labels).unavailable : new Date(value * 1000).toLocaleString(locale)
}

function formatPercent(value: number | null | undefined, locale?: Intl.LocalesArgument) {
  if (value == null || Number.isNaN(value)) {
    return isChineseLocale(locale) ? "未知" : "unknown"
  }

  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: value < 0.995 && value > 0 ? 1 : 0,
  }).format(value)
}

function sumMetric(points: SeriesPoint[], metric: SeriesMetric) {
  return points.reduce((sum, point) => sum + (getMetricValue(point, metric) ?? 0), 0)
}

function buildSpikeDiagnostics(points: SeriesPoint[], metric: SeriesMetric, granularity: ChartGranularity, labels: Record<string, string>, locale?: Intl.LocalesArgument) {
  const values = points
    .map((point) => ({ point, value: getMetricValue(point, metric) ?? 0 }))
    .filter((entry) => entry.value > 0)
  const sortedValues = values.map((entry) => entry.value).sort((a, b) => a - b)
  const median = sortedValues.length === 0
    ? 0
    : sortedValues.length % 2 === 1
      ? sortedValues[Math.floor(sortedValues.length / 2)] ?? 0
      : ((sortedValues[sortedValues.length / 2 - 1] ?? 0) + (sortedValues[sortedValues.length / 2] ?? 0)) / 2
  const threshold = median > 0 ? median * 3 : Number.POSITIVE_INFINITY
  const spikes = values
    .filter((entry) => entry.value >= threshold && entry.value > median)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
  const spikeUnit = unitForMetric(metric, labels)
  const medianStr = formatMetricValue(median, metric, locale)

  return {
    count: spikes.length,
    summary: spikes.length > 0 ? `${spikes.length} ${spikes.length === 1 ? labels.spikeSingular : labels.spikePlural}` : labels.noActiveSpikes,
    description: spikes.length > 0
      ? isChineseLocale(locale)
        ? `检测到 ${spikes.length} 个桶高于基线 ${medianStr} 的 3 倍。`
        : `${spikes.length} buckets are above 3x the ${medianStr} baseline.`
      : isChineseLocale(locale)
        ? `${points.length} 个桶中未发现高于基线 3 倍的${spikeUnit}尖峰。`
        : points.length === 0 ? "No buckets exceed the selected-metric baseline." : `${points.length} buckets do not exceed 3x the selected-metric baseline.`,
    rows: spikes.map((entry) => `${formatBucketLabel(entry.point, granularity, locale, true)} · ${formatMetricValue(entry.value, metric, locale)}`),
  }
}

function addBucketDuration(start: Date, granularity: ChartGranularity) {
  const end = new Date(start)
  switch (granularity) {
    case "hourly":
      end.setUTCHours(end.getUTCHours() + 1)
      break
    case "daily":
      end.setUTCDate(end.getUTCDate() + 1)
      break
    case "weekly":
      end.setUTCDate(end.getUTCDate() + 7)
      break
    case "monthly":
      end.setUTCMonth(end.getUTCMonth() + 1)
      break
  }
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1)
  return end
}

function formatBucketRange(point: SeriesPoint, granularity: ChartGranularity, metadata: ChartMetadata | undefined) {
  const start = new Date(point.bucketStart)
  if (Number.isNaN(start.getTime())) {
    return point.bucketStart
  }

  const naturalEnd = addBucketDuration(start, granularity)
  const rangeStart = metadata?.rangeStart ? new Date(metadata.rangeStart) : null
  const rangeEnd = metadata?.rangeEnd ? new Date(metadata.rangeEnd) : null
  const clippedStart = rangeStart && !Number.isNaN(rangeStart.getTime()) && start.getTime() < rangeStart.getTime()
    ? rangeStart
    : start
  const end = rangeEnd && !Number.isNaN(rangeEnd.getTime()) && naturalEnd.getTime() > rangeEnd.getTime()
    ? rangeEnd
    : naturalEnd

  return `${clippedStart.toISOString()} → ${end.toISOString()}`
}

function bucketOverlapsRange(point: SeriesPoint, granularity: ChartGranularity, rangeStartMs: number, rangeEndMs: number) {
  const start = new Date(point.bucketStart)
  if (Number.isNaN(start.getTime())) {
    return true
  }

  const end = addBucketDuration(start, granularity)
  return end.getTime() >= rangeStartMs && start.getTime() <= rangeEndMs
}

export function MainSeriesChart(props: {
  points: SeriesPoint[]
  metadata?: ChartMetadata
  availableMetrics?: SeriesMetric[]
  window?: DashboardWindow
  onWindowChange?: (value: DashboardWindow) => void
  selectedWindowSummary?: string
  granularity: ChartGranularity
  onGranularityChange?: (value: ChartGranularity) => void
  isLoading?: boolean
  loadingLabel?: string
  locale?: Intl.LocalesArgument
  metric: SeriesMetric
  onMetricChange: (metric: SeriesMetric) => void
  priceCoverage?: number
  pricingRecords?: Array<Pick<PricingRecordResponse, "enabled" | "canonicalModel">>
  pricingCoverageGaps?: PricingCoverageGap[]
  labels: {
    series: string
    chartTitle: string
    chartSubtitle: string
    noSeries: string
    cost: string
    input: string
    output: string
    reasoning: string
    cacheRead: string
    cacheWrite?: string
    metricLabel: string
    insightRail: string
    latestBucket: string
    peakValue: string
    selectedMetric: string
    anomalyAlerts: string
    topModelShare: string
    pricingIssues: string
    // chart copy fields
    range: string
    buckets: string
    unit: string
    xAxis: string
    yAxis: string
    seriesDetails: string
    showing: string
    of: string
    noActiveSpikes: string
    noSpikeAlerts: string
    modelShareUnavailable: string
    noOpenIssues: string
    noPricingIssues: string
    firstSeen: string
    lastSeen: string
    reason: string
    hint: string
    unavailable: string
    expand: string
    collapse: string
    // unit/label fields
    usdUnit: string
    tokensUnit: string
    zeroSelectedMetric: string
    noActivity: string
    windowEmpty: string
    spikeSingular: string
    spikePlural: string
    issueSingular: string
    issuePlural: string
    modelSingular: string
    // enum fields
    enumStale: string
    enumActive: string
    enumDisabled: string
    emptyState: string
    controls?: {
      windowLabel: string
      selectedWindow: string
      customWindow: string
      startDate: string
      endDate: string
      invalidCustomWindow: string
      granularityLabel: string
      metricLabel: string
      oneHour: string
      twentyFourHours: string
      sevenDaysShort: string
      thirtyDaysShort: string
      ninetyDaysShort: string
      allTime: string
      hourly: string
      daily: string
      weekly: string
      monthly: string
      cost: string
      input: string
      output: string
      reasoning: string
      cacheRead: string
      cacheWrite?: string
    }
  }
}) {
  const { points, granularity, locale, metric } = props
  const availableMetrics = props.availableMetrics ?? ["cost", "inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"]
  const metadata = props.metadata
  const rangeStartMs = metadata?.rangeStart ? new Date(metadata.rangeStart).getTime() : Number.NEGATIVE_INFINITY
  const rangeEndMs = metadata?.rangeEnd ? new Date(metadata.rangeEnd).getTime() : Number.POSITIVE_INFINITY
  const chartPoints = [...points]
    .filter((point) => {
      return bucketOverlapsRange(point, granularity, rangeStartMs, rangeEndMs)
    })
    .sort((a, b) => new Date(a.bucketStart).getTime() - new Date(b.bucketStart).getTime())
  const displayMetadata = metadata?.windowLabel === "ALL" && isUnixEpochRangeStart(metadata.rangeStart) && chartPoints[0]?.bucketStart
    ? { ...metadata, rangeStart: chartPoints[0].bucketStart }
    : metadata
  const metricOptions: Array<{ value: SeriesMetric; label: string }> = [
    { value: "cost", label: props.labels.cost },
    { value: "inputTokens", label: props.labels.input },
    { value: "outputTokens", label: props.labels.output },
    { value: "reasoningTokens", label: props.labels.reasoning },
    { value: "cacheReadTokens", label: props.labels.cacheRead },
    { value: "cacheWriteTokens", label: props.labels.cacheWrite ?? (isChineseLocale(locale) ? "缓存写入" : "Cache write tokens") },
  ].filter((option): option is { value: SeriesMetric; label: string } => availableMetrics.includes(option.value as SeriesMetric))
  const metricValues = chartPoints.map((point) => getMetricValue(point, metric))
  const numericMetricValues = metricValues.filter((value): value is number => value != null)
  const maxMetricValue = Math.max(...numericMetricValues, metric === "cost" ? 0.000001 : 1)
  const latestPoint = chartPoints.at(-1) ?? null
  const peakValue = numericMetricValues.length > 0 ? Math.max(...numericMetricValues) : 0
  const barWidth = chartPoints.length <= 1 ? 28 : Math.max(4, Math.min(28, Math.floor(480 / chartPoints.length)))
  const selectedMetricLabel = metricOptions.find((option) => option.value === metric)?.label ?? props.labels.selectedMetric
  const windowLabel = metadata?.windowLabel ?? props.labels.chartSubtitle
  const labels = props.labels as unknown as Record<string, string>
  const copy = chartCopy(labels)
  const chartTitle = `${selectedMetricLabel} · ${windowLabel} · ${granularityLabel(granularity, locale)}`
  const unitLabel = unitForMetric(metric, labels)
  const bucketCount = metadata?.bucketCount ?? chartPoints.length
  const rangeLabel = `${copy.range}: ${formatRangeIsoDate(displayMetadata?.rangeStart)} → ${formatRangeIsoDate(displayMetadata?.rangeEnd)}`
  const showYear = Boolean(displayMetadata?.rangeStart || displayMetadata?.rangeEnd)
  const yAxisTicks = [1, 2 / 3, 1 / 3, 0].map((ratio) => ratio * maxMetricValue)
  const plot = { left: 56, right: 600, top: 24, bottom: 156 }
  const xRange = { left: plot.left + barWidth / 2, right: plot.right - barWidth / 2 }
  const explicitRangeStartMs = displayMetadata?.rangeStart ? new Date(displayMetadata.rangeStart).getTime() : Number.NaN
  const explicitRangeEndMs = displayMetadata?.rangeEnd ? new Date(displayMetadata.rangeEnd).getTime() : Number.NaN
  const firstBucketStartMs = chartPoints[0]?.bucketStart ? new Date(chartPoints[0].bucketStart).getTime() : Number.NaN
  const lastBucketStartMs = chartPoints.at(-1)?.bucketStart ? new Date(chartPoints.at(-1)?.bucketStart ?? "").getTime() : Number.NaN
  const timeScaleStartMs = Number.isFinite(explicitRangeStartMs) ? explicitRangeStartMs : firstBucketStartMs
  const timeScaleEndMs = Number.isFinite(explicitRangeEndMs) ? explicitRangeEndMs : lastBucketStartMs
  const xForPoint = (point: SeriesPoint, index: number) => {
    const startMs = new Date(point.bucketStart).getTime()
    const bucketEndMs = addBucketDuration(new Date(point.bucketStart), granularity).getTime()
    const midpointMs = Number.isFinite(startMs) && Number.isFinite(bucketEndMs) ? (startMs + bucketEndMs) / 2 : Number.NaN
    const scaledMs = Number.isFinite(midpointMs) ? midpointMs : startMs

    if (!Number.isFinite(scaledMs) || !Number.isFinite(timeScaleStartMs) || !Number.isFinite(timeScaleEndMs) || timeScaleEndMs <= timeScaleStartMs) {
      return chartPoints.length === 1 ? (plot.left + plot.right) / 2 : xRange.left + ((index / (chartPoints.length - 1)) * (xRange.right - xRange.left))
    }

    const ratio = Math.min(1, Math.max(0, (scaledMs - timeScaleStartMs) / (timeScaleEndMs - timeScaleStartMs)))
    return xRange.left + (ratio * (xRange.right - xRange.left))
  }
  const yForValue = (value: number) => plot.bottom - ((value / maxMetricValue) * (plot.bottom - plot.top))
  const footerPoints = chartPoints
  const spikeDiagnostics = buildSpikeDiagnostics(chartPoints, metric, granularity, labels, locale)
  const selectedTotal = sumMetric(chartPoints, metric)
  const tokenTotal = chartPoints.reduce((sum, point) => sum
    + getBucketTokenActivity(point), 0)
  const maxBucketTokenActivity = Math.max(0, ...chartPoints.map(getBucketTokenActivity))
  const activePricingRecords = (props.pricingRecords ?? []).filter((record) => record.enabled).length
  const coverage = props.priceCoverage
  const pricingGaps = props.pricingCoverageGaps ?? []
  const pricingIssueCount = pricingGaps.length > 0
    ? pricingGaps.length
    : (coverage != null && coverage < 0.999 ? 1 : 0) + (props.pricingRecords && activePricingRecords === 0 ? 1 : 0)
  const pricingSummary = props.pricingRecords?.length === 0
    ? pricingGaps.length > 0
      ? `${pricingGaps.length} ${pricingGaps.length === 1 ? labels.modelSingular : labels.modelsUnit}`
      : copy.noOpenIssues
    : isChineseLocale(locale)
      ? `覆盖 ${formatPercent(coverage, locale)} · ${pricingIssueCount} ${labels.issuePlural}`
      : `Coverage ${formatPercent(coverage, locale)} · ${pricingIssueCount} ${pricingIssueCount === 1 ? labels.issueSingular : labels.issuePlural}`
  const pricingDescription = isChineseLocale(locale)
    ? pricingIssueCount > 0
      ? `全历史价格覆盖率为 ${formatPercent(coverage, locale)}，有 ${activePricingRecords} 条启用定价记录；请补齐缺失模型价格或刷新定价注册表。`
      : `全历史价格覆盖率为 ${formatPercent(coverage, locale)}，${activePricingRecords} 条启用定价记录可用于成本计算。`
    : pricingIssueCount > 0
      ? `Lifetime price coverage is ${formatPercent(coverage, locale)} with ${activePricingRecords} enabled pricing records; add missing model prices or refresh the registry.`
      : `Lifetime price coverage is ${formatPercent(coverage, locale)} with ${activePricingRecords} enabled pricing records available for costing.`
  const windowOverviewSummary = `${chartPoints.length === 0 ? labels.windowEmpty : `${chartPoints.length} ${copy.buckets}`} · ${formatMetricValue(selectedTotal, metric, locale)} ${unitLabel}`
  const windowOverviewDescription = isChineseLocale(locale)
    ? `所选窗口包含 ${chartPoints.length} 个${granularityLabel(granularity, locale)}桶，累计 ${formatMetricValue(selectedTotal, metric, locale)} ${unitLabel}，总令牌活动 ${new Intl.NumberFormat(locale).format(tokenTotal)}。`
    : `Selected window includes ${chartPoints.length} ${granularityLabel(granularity, locale).toLowerCase()} buckets totaling ${formatMetricValue(selectedTotal, metric, locale)} ${unitLabel}, with ${new Intl.NumberFormat(locale).format(tokenTotal)} total token activity.`

  const loadingLabel = props.loadingLabel ?? labels.loading ?? (isChineseLocale(locale) ? "加载中" : "Loading")

  const seriesPolyline = buildPolyline(chartPoints.map((point, index) => ({
    x: xForPoint(point, index),
    y: yForValue(getMetricValue(point, metric) ?? 0),
  })))
  const xAxisTicks = buildXAxisTicks(chartPoints.length, (index) => {
    const point = chartPoints[index]
    return point ? xForPoint(point, index) : plot.left
  }, plot)

  return (
    <section className="chart-panel" aria-label={props.labels.chartTitle} aria-busy={props.isLoading || undefined}>
      <header className="chart-panel__header">
        <div>
          <p className="chart-panel__eyebrow">{props.labels.series}</p>
          <h2>{props.isLoading && props.selectedWindowSummary ? `${selectedMetricLabel} · ${props.selectedWindowSummary}` : chartTitle}</h2>
        </div>
        <p className="chart-panel__subtitle">{rangeLabel} · {bucketCount} {copy.buckets} · {copy.unit}: {unitLabel}</p>
      </header>

      {props.window && props.onWindowChange && props.onGranularityChange && props.labels.controls ? (
        <div className="chart-panel__toolbar">
          <TimeControls
            window={props.window}
            granularity={granularity}
            metric={metric}
            selectedWindowSummary={props.selectedWindowSummary ?? chartTitle}
            onWindowChange={props.onWindowChange}
            onGranularityChange={props.onGranularityChange}
            onMetricChange={props.onMetricChange}
            labels={props.labels.controls}
          />
        </div>
      ) : null}

      <div className="chart-panel__metric-row">
        <span className="control-group__title">{props.labels.metricLabel}</span>
        <div className="control-group__buttons">
          {metricOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`pill-button${metric === option.value ? " pill-button--active" : ""}`}
              aria-pressed={metric === option.value}
              onClick={() => props.onMetricChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-panel__layout">
        <div>
          {props.isLoading ? (
            <div className="chart-frame chart-frame--empty" role="status" aria-live="polite">
              <div className="chart-panel__empty">{loadingLabel}</div>
            </div>
          ) : chartPoints.length === 0 ? (
            <div className="chart-frame chart-frame--empty">
              <div className="chart-panel__legend">
                <span><i className="legend-swatch legend-swatch--cost" />{selectedMetricLabel}</span>
                <span className="chart-panel__axis-label">{copy.xAxis}</span>
                <span className="chart-panel__axis-label">{`${copy.yAxis}: ${unitLabel}`}</span>
              </div>
              <svg viewBox="0 0 600 180" className="chart-svg" role="img" aria-label={`${props.labels.noSeries}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}>
                <desc>{`${props.labels.noSeries}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}</desc>
                {[0, 1, 2, 3].map((line) => (
                  <g key={line}>
                    <line x1="56" x2="600" y1={24 + line * 40} y2={24 + line * 40} className="chart-grid-line" />
                    <text x="48" y={28 + line * 40} textAnchor="end" className="chart-y-tick-label">
                      {formatMetricValue(0, metric, locale)}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="chart-panel__empty">{props.labels.noSeries}</div>
            </div>
          ) : (
            <>
              <div className="chart-panel__legend">
                <span><i className="legend-swatch legend-swatch--cost" />{selectedMetricLabel}</span>
                <span className="chart-panel__axis-label">{copy.xAxis}</span>
                <span className="chart-panel__axis-label">{`${copy.yAxis}: ${unitLabel}`}</span>
              </div>

              <div className="chart-frame">
                <svg viewBox="0 0 600 180" className="chart-svg" role="img" aria-label={`${chartTitle}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}>
                  <desc>{`${chartTitle}. ${rangeLabel}. ${copy.yAxis}: ${unitLabel}. ${copy.xAxis}.`}</desc>
                  {[0, 1, 2, 3].map((line) => (
                    <g key={line}>
                      <line
                        x1="56"
                        x2="600"
                        y1={24 + line * 40}
                        y2={24 + line * 40}
                        className="chart-grid-line"
                      />
                      <text x="48" y={28 + line * 40} textAnchor="end" className="chart-y-tick-label">
                        {formatMetricValue(yAxisTicks[line] ?? 0, metric, locale)}
                      </text>
                    </g>
                  ))}
                  {chartPoints.map((point, index) => {
                    const x = xForPoint(point, index)
                    const metricValue = getMetricValue(point, metric)
                    if (metricValue == null) {
                      return null
                    }
                    const metricHeight = plot.bottom - yForValue(metricValue)
                    const zeroNote = zeroValueNote(point, metricValue, labels)
                    return (
                      <rect
                        key={point.bucketStart}
                        x={x - barWidth / 2}
                        y={plot.bottom - metricHeight}
                        width={barWidth}
                        height={Math.max(4, metricHeight)}
                        rx="8"
                        className={`chart-token-bar${metricValue === 0 ? " chart-token-bar--zero" : ""}`}
                      >
                        <title>{`${formatBucketRange(point, granularity, displayMetadata)} · ${formatMetricValue(metricValue, metric, locale)}${zeroNote ? ` · ${zeroNote}` : ""}`}</title>
                      </rect>
                    )
                  })}
                  <polyline className="chart-spend-line" fill="none" points={seriesPolyline} />
                  <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} className="chart-x-axis-line" />
                  {xAxisTicks.map((tick) => {
                    const point = chartPoints[tick.index]
                    if (!point) {
                      return null
                    }
                    return (
                      <g key={`x-tick-${point.bucketStart}`}>
                        <line x1={tick.x} x2={tick.x} y1={plot.bottom} y2={plot.bottom + 5} className="chart-x-axis-line" />
                        <text
                          x={tick.x}
                          y={plot.bottom + 18}
                          textAnchor={tick.textAnchor}
                          className={`chart-x-tick-label${tick.textAnchor === "middle" ? " chart-x-tick-label--optional" : ""}`}
                        >
                          {formatBucketLabel(point, granularity, locale, showYear)}
                        </text>
                      </g>
                    )
                  })}
                </svg>

                <CollapsiblePanel
                  title={copy.details}
                  summary={`${footerPoints.length} ${copy.of} ${chartPoints.length} ${copy.buckets}`}
                  defaultOpen
                  className="chart-details-panel"
                  labels={{ expand: copy.expand, collapse: copy.collapse }}
                >
                  <div className="chart-footer chart-footer--scroll-window" role="region" tabIndex={0} aria-label="Series Explorer details">
                    {footerPoints.map((point) => {
                      const metricValue = getMetricValue(point, metric) ?? null
                      const zeroNote = metricValue == null ? "" : zeroValueNote(point, metricValue, labels)
                      const bucketTokenActivity = getBucketTokenActivity(point)
                      const activityHeat = getBucketActivityHeat(bucketTokenActivity, maxBucketTokenActivity)
                      return (
                        <div
                          key={point.bucketStart}
                          className={`chart-footer__point${metricValue === 0 ? " chart-footer__point--zero" : ""}`}
                          data-activity-level={activityHeat?.activityLevel}
                          style={activityHeat == null ? undefined : { backgroundColor: `rgba(124, 224, 255, ${activityHeat.activityAlpha})` }}
                          aria-label={`${formatBucketRange(point, granularity, displayMetadata)} · ${formatMetricValue(metricValue, metric, locale)}${zeroNote ? ` · ${zeroNote}` : ""}`}
                        >
                          <span data-testid="chart-bucket-label">{formatBucketLabel(point, granularity, locale, showYear)}</span>
                          <strong>{formatMetricValue(metricValue, metric, locale)}</strong>
                          {zeroNote ? <small>{zeroNote}</small> : null}
                        </div>
                      )
                    })}
                  </div>
                </CollapsiblePanel>
              </div>
            </>
          )}
        </div>

        <aside className="insight-rail" aria-label={props.labels.insightRail}>
          {props.isLoading ? (
            <div className="status-panel__block">
              <span className="status-panel__label">{props.labels.insightRail}</span>
              <strong>{loadingLabel}</strong>
            </div>
          ) : <>
          <CollapsiblePanel title={props.labels.anomalyAlerts} summary={spikeDiagnostics.summary} defaultOpen className="status-panel__block" labels={{ expand: copy.expand, collapse: copy.collapse }}>
            <p className="hero-card__caption">{spikeDiagnostics.description}</p>
            {spikeDiagnostics.rows.length > 0 ? (
              <ul className="status-panel__list" aria-label={labels.anomalyAlerts}>
                {spikeDiagnostics.rows.map((row) => <li key={row}>{row}</li>)}
              </ul>
            ) : null}
          </CollapsiblePanel>
          <CollapsiblePanel title={props.labels.topModelShare} summary={windowOverviewSummary} defaultOpen className="status-panel__block" labels={{ expand: copy.expand, collapse: copy.collapse }}>
            <p className="hero-card__caption">{windowOverviewDescription}</p>
          </CollapsiblePanel>
          <CollapsiblePanel title={props.labels.pricingIssues} summary={pricingSummary} defaultOpen className="status-panel__block" labels={{ expand: copy.expand, collapse: copy.collapse }}>
            <p className="hero-card__caption">{pricingDescription}</p>
            {pricingGaps.length > 0 ? (
              <ul className="status-panel__list" aria-label={labels.pricingIssues}>
                {pricingGaps.map((gap) => (
                  <li key={`${gap.providerId}/${gap.modelId}`}>
                    <strong>{gap.providerId} / {gap.modelId}</strong>
                    <span>{new Intl.NumberFormat(locale).format(gap.totalTokens)} {labels.tokensUnit} · {new Intl.NumberFormat(locale).format(gap.messageCount)} {labels.messagesUnit}</span>
                    <dl className="status-panel__meta">
                      <div><dt>{copy.firstSeen}</dt><dd>{formatUnixTime(gap.firstSeen, labels, locale)}</dd></div>
                      <div><dt>{copy.lastSeen}</dt><dd>{formatUnixTime(gap.lastSeen, labels, locale)}</dd></div>
                      <div><dt>{copy.reason}</dt><dd>{gap.reason}</dd></div>
                      <div><dt>{copy.hint}</dt><dd>{isChineseLocale(locale) && gap.reason === "no_matching_pricing_record" ? `为 ${gap.providerId} / ${gap.modelId} 添加启用且 source URL 有效的定价记录。` : gap.hint}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>
            ) : null}
          </CollapsiblePanel>
          </>}
        </aside>
      </div>
    </section>
  )
}
