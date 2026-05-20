import type { OverviewResponse } from "../api/client"
import type { DashboardAlertItem } from "../hooks/useDashboardState"

function formatUsd(value: number | null, locale: Intl.LocalesArgument) {
  if (value == null) {
    return "--"
  }

  const fractionDigits = value >= 100 ? 0 : value >= 1 ? 2 : 4

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

function formatCompactNumber(value: number, locale: Intl.LocalesArgument) {
  return new Intl.NumberFormat(locale, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

function formatCoverage(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatLag(value: number | null, labels: { never: string; secondsShort: string; minutesShort: string; hoursShort: string; daysShort: string }) {
  if (value == null) {
    return labels.never
  }

  if (value < 60) {
    return `${value}${labels.secondsShort}`
  }

  if (value < 3600) {
    return `${Math.round(value / 60)}${labels.minutesShort}`
  }

  if (value < 86400) {
    return `${Math.round(value / 3600)}${labels.hoursShort}`
  }

  return `${Math.round(value / 86400)}${labels.daysShort}`
}

function formatLastSync(value: number | null, neverLabel: string, locale: Intl.LocalesArgument) {
  if (value == null) {
    return neverLabel
  }

  return new Date(value * 1000).toLocaleString(locale)
}

function formatWindowSpendChip(value: string, labels: { selectedWindowBadge: string }) {
  return `${labels.selectedWindowBadge} ${value}`
}

export function calculateLifetimeShare(lifetimeSpendUsd: number | null, windowSpendUsd: number | null) {
  if (lifetimeSpendUsd == null || windowSpendUsd == null || lifetimeSpendUsd <= 0) {
    return null
  }

  return Math.round((windowSpendUsd / lifetimeSpendUsd) * 100)
}

function buildSparkline(values: number[]) {
  if (values.length === 0) {
    return ""
  }

  const maxValue = Math.max(...values, 0.000001)
  return values.map((value, index) => {
    const x = values.length === 1 ? 90 : (index / (values.length - 1)) * 180
    const y = 44 - ((value / maxValue) * 32)
    return `${x},${y}`
  }).join(" ")
}

export function HeroCards(props: {
  overview: OverviewResponse
  trendPoints: number[]
  activeAlerts: number
  activeAlertItems?: DashboardAlertItem[]
  labels: {
    lifetimeSpend: string
    windowSpend: string
    activeAlerts: string
    priceCoverage: string
    syncLag: string
    totalTokens: string
    never: string
    secondsShort: string
    minutesShort: string
    hoursShort: string
    daysShort: string
    thirtyDayWindow: string
    synced: string
    lastSync: string
    trendStrip: string
    percentOfLifetime: string
    investigateSignals: string
    noWarnings: string
    selectedWindowBadge: string
    severityCritical: string
    severityWarning: string
    severityInfo: string
    action: string
  }
  isLoading: boolean
  lastSyncEpochSeconds: number | null
  locale: Intl.LocalesArgument
}) {
  const { overview, labels, isLoading, activeAlerts, lastSyncEpochSeconds, locale } = props
  const alertItems = props.activeAlertItems ?? []
  const visibleAlertCount = props.activeAlertItems === undefined ? activeAlerts : alertItems.length
  const lifetimeShare = calculateLifetimeShare(overview.lifetimeSpendUsd, overview.windowSpendUsd)
  const sparkline = buildSparkline(props.trendPoints)

  return (
    <section className="hero-grid" aria-label={labels.lifetimeSpend}>
      <article className="hero-card hero-card--primary">
        <div className="hero-card__header">
          <span className="hero-card__label">{labels.lifetimeSpend}</span>
          <span className="hero-card__chip">$</span>
        </div>
        <strong className="hero-card__value">{isLoading ? "…" : formatUsd(overview.lifetimeSpendUsd, locale)}</strong>
        <div className="hero-card__chip-row">
          <span className="hero-card__chip hero-card__chip--warm">{formatWindowSpendChip(isLoading ? "…" : formatUsd(overview.windowSpendUsd, locale), labels)}</span>
          <span className="hero-card__chip">{lifetimeShare == null || isLoading ? "--" : `${lifetimeShare}${labels.percentOfLifetime}`}</span>
        </div>
        <div className="hero-card__meta">
          <span>{labels.totalTokens}</span>
          <strong>{isLoading ? "…" : formatCompactNumber(overview.lifetimeTokens, locale)}</strong>
        </div>
        <div className="hero-card__trend-strip" aria-label={labels.trendStrip}>
          {sparkline ? (
            <svg viewBox="0 0 180 48" className="hero-card__sparkline" role="img" aria-label={labels.trendStrip}>
              <polyline points={sparkline} fill="none" className="hero-card__sparkline-line" />
            </svg>
          ) : (
            <span>--</span>
          )}
        </div>
      </article>

      <article className="hero-card">
        <div className="hero-card__header">
          <span className="hero-card__label">{labels.activeAlerts}</span>
          <span className="hero-card__chip">{isLoading ? "…" : visibleAlertCount > 0 ? `${visibleAlertCount}` : "OK"}</span>
        </div>
        {isLoading ? (
          <strong className="hero-card__value">…</strong>
        ) : alertItems.length > 0 ? (
          <ul className="hero-card__alert-list" aria-label={labels.activeAlerts}>
            {alertItems.map((item) => (
              <li key={item.id} className="hero-card__alert-item">
                <strong>{item.title}</strong>
                <small>{({ critical: labels.severityCritical, warning: labels.severityWarning, info: labels.severityInfo }[item.severity] ?? item.severity)}</small>
                <span>{item.detail}</span>
                <span>{labels.action}: {item.action}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hero-card__caption">{labels.noWarnings}</p>
        )}
      </article>

      <article className="hero-card">
        <div className="hero-card__header">
          <span className="hero-card__label">{labels.priceCoverage}</span>
          <span className="hero-card__chip">%</span>
        </div>
        <strong className="hero-card__value">{isLoading ? "…" : formatCoverage(overview.priceCoverage)}</strong>
        <p className="hero-card__caption">{labels.synced}</p>
      </article>

    </section>
  )
}
