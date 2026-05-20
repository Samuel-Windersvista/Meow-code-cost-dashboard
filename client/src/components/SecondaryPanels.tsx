import type { OverviewResponse, PricingRecordResponse, SeriesPoint } from "../api/client"
import { CollapsiblePanel } from "./CollapsiblePanel"

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatStatus(value: string, labels: Record<string, string>) {
  if (value === "stale") return labels.enumStale
  if (value === "active") return labels.enumActive
  if (value === "disabled") return labels.enumDisabled
  return value
}

export function SecondaryPanels(props: {
  overview: OverviewResponse
  points: SeriesPoint[]
  pricingRecords?: PricingRecordResponse[]
  locale?: Intl.LocalesArgument
  labels: {
    secondaryTitle: string
    cacheEfficiency: string
    pricingCoverage: string
    freshness: string
    activePricing: string
    effectiveCost: string
    source: string
    // new dictionary fields
    unavailable: string
    noActivity: string
    expand: string
    collapse: string
    effectiveCostFormula: string
    basedOnPricedTokens: string
    pricingCoverageLabel: string
    enumStale: string
    enumActive: string
    enumDisabled: string
  }
}) {
  const latest = props.points.at(-1)
  const cacheShare = latest && latest.cacheReadTokens != null
    ? latest.cacheReadTokens / Math.max(1, (latest.inputTokens ?? 0) + (latest.outputTokens ?? 0) + (latest.reasoningTokens ?? 0) + latest.cacheReadTokens + (latest.cacheWriteTokens ?? 0))
    : 0
  const pricingRows = (props.pricingRecords ?? []).filter((record) => record.enabled)
  const activePricing = pricingRows.filter((record) => record.enabled).length
  const freshness = pricingRows.reduce<number | null>((current, record) => {
    const value = record.observedTime ?? record.effectiveTime
    if (current == null) {
      return value
    }
    return Math.max(current, value)
  }, null)
  const effectiveCostTokens = props.overview.pricedTokens != null && props.overview.pricedTokens > 0 && props.overview.pricedTokens < props.overview.lifetimeTokens
    ? props.overview.pricedTokens
    : props.overview.lifetimeTokens
  const isPartialCoverage = props.overview.pricedTokens != null && props.overview.pricedTokens > 0 && props.overview.pricedTokens < props.overview.lifetimeTokens
  const effectiveCost = props.overview.lifetimeSpendUsd != null && effectiveCostTokens > 0
    ? (props.overview.lifetimeSpendUsd / effectiveCostTokens) * 1_000_000
    : null
  const l = props.labels
  const effectiveCostLabel = effectiveCost == null
    ? l.unavailable
    : new Intl.NumberFormat(props.locale, { style: "currency", currency: "USD", minimumFractionDigits: effectiveCost >= 100 ? 0 : 2, maximumFractionDigits: effectiveCost >= 100 ? 0 : 2 }).format(effectiveCost)
  const sourceBreakdown = pricingRows.reduce<Record<string, number>>((acc, record) => {
    acc[record.sourceType] = (acc[record.sourceType] ?? 0) + 1
    return acc
  }, {})

  return (
    <section className="secondary-panels" aria-label={props.labels.secondaryTitle}>
      <article className="secondary-panel">
        <span className="status-panel__label">{props.labels.cacheEfficiency}</span>
        <strong>{formatPercent(cacheShare)}</strong>
      </article>
      <article className="secondary-panel">
        <span className="status-panel__label">{props.labels.pricingCoverage}</span>
        <strong>{formatPercent(props.overview.priceCoverage)}</strong>
        <p className="hero-card__caption">{props.labels.activePricing}: {activePricing}</p>
        <p className="hero-card__caption">{props.labels.freshness}: {freshness == null ? l.unavailable : new Date(freshness * 1000).toLocaleString(props.locale)}</p>
      </article>
      <CollapsiblePanel title={props.labels.effectiveCost} summary={effectiveCostLabel} defaultOpen className="secondary-panel" labels={{ expand: l.expand, collapse: l.collapse }}>
        <strong>{effectiveCostLabel}</strong>
        <p className="hero-card__caption">{l.effectiveCostFormula}</p>
        {isPartialCoverage ? <p className="hero-card__caption">{l.basedOnPricedTokens} · {formatPercent(props.overview.priceCoverage)} {l.pricingCoverageLabel}</p> : null}
        <p className="hero-card__caption">{props.labels.source}: {Object.entries(sourceBreakdown).map(([key, value]) => `${formatStatus(key, props.labels)} ${value}`).join(", ") || l.unavailable}</p>
      </CollapsiblePanel>
    </section>
  )
}
