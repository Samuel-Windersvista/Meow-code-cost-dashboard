import { useState } from "react"

import type { CreatePricingRecordPayload, LeaderboardSession, ObservedPricingCoverageRow, PricingCoverageGap, PricingRecordResponse } from "../api/client"
import { deriveManualPricingIdentity } from "../lib/pricingIdentity"
import { CollapsiblePanel } from "./CollapsiblePanel"

function formatUsd(value: number | null, locale?: Intl.LocalesArgument) {
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

function formatEnum(value: string, labels: Record<string, string>) {
  const map: Record<string, string> = {
    manual: labels.enumManual,
    official: labels.enumOfficial,
    openrouter: labels.enumOpenRouter,
    websearch: labels.enumWebSearch,
    per_token: labels.enumPerToken,
    included_in_output: labels.enumIncludedInOutput,
    stale: labels.enumStale,
    active: labels.enumActive,
    disabled: labels.enumDisabled,
    priced: labels.enumPriced,
    missing: labels.enumMissing,
  }
  return map[value] ?? value
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null
  } catch {
    return null
  }
}

export function LeaderboardTables(props: {
  costSessions?: LeaderboardSession[]
  tokenSessions?: LeaderboardSession[]
  pricingRecords?: PricingRecordResponse[]
  observedPricingCoverage?: ObservedPricingCoverageRow[]
  pricingCoverageGaps?: PricingCoverageGap[]
  points?: Array<{ inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; bucketStart: string }>
  locale?: Intl.LocalesArgument
  onArchivePricing?: (id: string) => void
  onMarkPricingManual?: (record: PricingRecordResponse) => void
  onSavePricing?: (record: PricingRecordResponse, patch: Partial<PricingRecordResponse>) => void
  onCreatePricing?: (payload: CreatePricingRecordPayload) => void
  priceCoverage?: number
  labels: {
    expensiveSessions: string
    tokenSessions: string
    pricingDrilldown: string
    observedProviderCoverage: string
    windowBreakdown: string
    pricingFreshness: string
    title: string
    cost: string
    tokens: string
    source: string
    input: string
    output: string
    reasoning: string
    cacheRead: string
    edit: string
    missingPricing: string
    archive: string
    manual: string
    save: string
    cacheWrite: string
    confidence: string
    observed: string
    effective: string
    enabled: string
    superseded: string
    reasoningRule: string
    yes: string
    no: string
    // localCopy fields
    noSessions: string
    sessions: string
    unavailable: string
    records: string
    gap: string
    firstSeen: string
    lastSeen: string
    reason: string
    hint: string
    noGaps: string
    noSessionsAvailable: string
    pricingRecordsUnavailable: string
    current: string
    freshnessUnavailable: string
    noMissingPricing: string
    noObservedCoverage: string
    pricedVia: string
    unpriced: string
    expand: string
    collapse: string
    models: string
    messages: string
    // formatEnum fields
    enumManual: string
    enumOfficial: string
    enumOpenRouter: string
    enumWebSearch: string
    enumPerToken: string
    enumIncludedInOutput: string
    enumStale: string
    enumActive: string
    enumDisabled: string
    enumPriced: string
    enumMissing: string
    // singular/plural
    modelSingular: string
  }
}) {
  const [drafts, setDrafts] = useState<Record<string, { inputPrice: string; outputPrice: string; reasoningPrice: string; cacheReadPrice: string; cacheWritePrice: string; sourceUrl: string }>>({})
  const [gapDrafts, setGapDrafts] = useState<Record<string, { inputPrice: string; outputPrice: string; reasoningPrice: string; cacheReadPrice: string; cacheWritePrice: string; sourceUrl: string }>>({})
  const costSessions = props.costSessions ?? []
  const tokenSessions = props.tokenSessions ?? []
  const pricingRows = props.pricingRecords ?? []
  const observedPricingCoverage = props.observedPricingCoverage ?? []
  const editablePricingRows = pricingRows.filter((record) => record.enabled === true && record.supersededTime == null)
  const pricingCoverageGaps = props.pricingCoverageGaps ?? []
  const l = props.labels
  const missingPricingSessions = costSessions.filter((session) => session.totalCostUsd == null)
  const missingPricingGap = props.priceCoverage == null ? 0 : Math.max(0, 1 - props.priceCoverage)
  const missingModelUnit = pricingCoverageGaps.length === 1 ? l.modelSingular : l.models
  const costSummary = costSessions.length === 0 ? l.noSessions : `${costSessions.length} ${l.sessions} · ${formatUsd(costSessions.reduce((sum, session) => sum + (session.totalCostUsd ?? 0), 0), props.locale)}`
  const tokenSummary = tokenSessions.length === 0 ? l.noSessions : `${tokenSessions.length} ${l.sessions} · ${tokenSessions.reduce((sum, session) => sum + session.totalTokens, 0).toLocaleString(props.locale)} ${l.tokens}`
  const pricingSummary = pricingRows.length === 0 ? l.unavailable : `${pricingRows.length} ${l.records}`
  const observedCoverageSummary = observedPricingCoverage.length === 0 ? l.unavailable : `${observedPricingCoverage.length} ${l.records}`
  const freshnessSummary = pricingRows.length === 0 ? l.unavailable : `${pricingRows.length} ${l.records} · ${Math.round(missingPricingGap * 100)}% ${l.gap}`
  const missingSummary = pricingCoverageGaps.length > 0
    ? `${pricingCoverageGaps.length} ${missingModelUnit} · ${Math.round(missingPricingGap * 100)}% ${l.gap}`
    : missingPricingSessions.length === 0 ? l.noGaps : `${missingPricingSessions.length} ${l.sessions} · ${Math.round(missingPricingGap * 100)}% ${l.gap}`

  function getDraft(record: PricingRecordResponse) {
    return drafts[record.id] ?? {
      inputPrice: String(record.inputPrice),
      outputPrice: String(record.outputPrice),
      reasoningPrice: String(record.reasoningPrice),
      cacheReadPrice: String(record.cacheReadPrice),
      cacheWritePrice: String(record.cacheWritePrice),
      sourceUrl: record.sourceUrl ?? "",
    }
  }

  function pricingFieldLabel(record: PricingRecordResponse, field: string) {
    return `${field} for ${record.canonicalVendor} ${record.canonicalModel}`
  }

  function gapKey(gap: PricingCoverageGap) {
    return `${gap.providerId}/${gap.modelId}`
  }

  function getGapDraft(gap: PricingCoverageGap) {
    return gapDrafts[gapKey(gap)] ?? {
      inputPrice: "",
      outputPrice: "",
      reasoningPrice: "",
      cacheReadPrice: "",
      cacheWritePrice: "",
      sourceUrl: "",
    }
  }

  function missingPricingFieldLabel(gap: PricingCoverageGap, field: string) {
    return `${field} for missing ${gap.providerId} ${gap.modelId}`
  }

  function setGapDraftField(gap: PricingCoverageGap, field: "inputPrice" | "outputPrice" | "reasoningPrice" | "cacheReadPrice" | "cacheWritePrice" | "sourceUrl", value: string) {
    setGapDrafts((current) => {
      const key = gapKey(gap)
      return { ...current, [key]: { ...(current[key] ?? getGapDraft(gap)), [field]: value } }
    })
  }

  function submitGapPricing(gap: PricingCoverageGap) {
    const draft = getGapDraft(gap)
    if (![draft.inputPrice, draft.outputPrice, draft.reasoningPrice, draft.cacheReadPrice, draft.cacheWritePrice].every((value) => value.trim() !== "")) {
      return
    }

    const inputPrice = Number(draft.inputPrice)
    const outputPrice = Number(draft.outputPrice)
    const reasoningPrice = Number(draft.reasoningPrice)
    const cacheReadPrice = Number(draft.cacheReadPrice)
    const cacheWritePrice = Number(draft.cacheWritePrice)
    if (![inputPrice, outputPrice, reasoningPrice, cacheReadPrice, cacheWritePrice].every(Number.isFinite)) {
      return
    }

    const sourceUrl = draft.sourceUrl.trim()
    const safeSourceUrl = safeHttpUrl(sourceUrl)
    if (!safeSourceUrl) {
      return
    }

    const pricingIdentity = deriveManualPricingIdentity({ providerId: gap.providerId, modelId: gap.modelId })

    props.onCreatePricing?.({
      id: pricingIdentity.id,
      canonicalVendor: pricingIdentity.canonicalVendor,
      canonicalModel: pricingIdentity.canonicalModel,
      vendorModelId: pricingIdentity.vendorModelId,
      currency: "USD",
      inputPrice,
      outputPrice,
      reasoningPrice,
      cacheReadPrice,
      cacheWritePrice,
      sourceType: "manual",
      sourceUrl: safeSourceUrl,
      confidence: "medium",
      isManualOverride: true,
      effectiveTime: gap.firstSeen,
      reasoningBillingRule: {
        kind: "per_token",
        provenance: {
          sourceType: "manual",
          sourceUrl: safeSourceUrl,
        },
      },
    })
  }

  function formatTime(value: number | null | undefined) {
    return value ? new Date(value * 1000).toLocaleString(props.locale) : l.unavailable
  }

  return (
    <section className="leaderboard-grid" aria-label={props.labels.title}>
      <CollapsiblePanel title={props.labels.expensiveSessions} summary={costSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: l.expand, collapse: l.collapse }}>
        <table>
          <tbody>
            {costSessions.length === 0 ? <tr><td colSpan={2}>{l.noSessionsAvailable}</td></tr> : costSessions.slice(0, 5).map((session) => (
              <tr key={session.sessionId}>
                <td>{session.title}</td>
                <td>{formatUsd(session.totalCostUsd, props.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel title={props.labels.tokenSessions} summary={tokenSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: l.expand, collapse: l.collapse }}>
        <table>
          <tbody>
            {tokenSessions.length === 0 ? <tr><td colSpan={2}>{l.noSessionsAvailable}</td></tr> : tokenSessions.slice(0, 5).map((session) => (
              <tr key={session.sessionId}>
                <td>{session.title}</td>
                <td>{session.totalTokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel title={props.labels.pricingDrilldown} summary={pricingSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: l.expand, collapse: l.collapse }}>
        {editablePricingRows.length === 0 ? (
          <p className="pricing-card-empty">{l.pricingRecordsUnavailable}</p>
        ) : (
          <div className="pricing-card-grid">
            {editablePricingRows.map((record) => {
              const draft = getDraft(record)
              const priceFields = [
                [props.labels.input, record.inputPrice],
                [props.labels.output, record.outputPrice],
                [props.labels.reasoning, record.reasoningPrice],
                [props.labels.cacheRead, record.cacheReadPrice],
                [props.labels.cacheWrite, record.cacheWritePrice],
              ] as const

              return (
                <article className="pricing-card" key={record.id} aria-label={`Pricing record for ${record.canonicalVendor} ${record.canonicalModel}`}>
                  <div className="pricing-card__header">
                    <div className="pricing-card__identity">
                      <strong className="pricing-card__model">{record.canonicalVendor} / {record.canonicalModel}</strong>
                      <span className="pricing-card__vendor-id">{record.vendorModelId}</span>
                    </div>
                    <div className="pricing-card__badges" aria-label={`${props.labels.source} and ${props.labels.confidence}`}>
                      <span>{formatEnum(record.sourceType, props.labels)}</span>
                      <span>{record.confidence}</span>
                    </div>
                  </div>

                  <div className="pricing-card__source">
                    <span>{props.labels.source}</span>
                    {safeHttpUrl(record.sourceUrl) ? <a href={safeHttpUrl(record.sourceUrl)!}>{record.sourceUrl}</a> : <span>{l.unavailable}</span>}
                  </div>

                  <dl className="pricing-card__price-grid">
                    {priceFields.map(([label, value]) => (
                      <div className="pricing-card__price-chip" key={label}>
                        <dt>{label}</dt>
                        <dd>{formatUsd(value, props.locale)}</dd>
                      </div>
                    ))}
                  </dl>

                  <dl className="pricing-card__meta">
                    <div><dt>{props.labels.observed}</dt><dd>{formatTime(record.observedTime)}</dd></div>
                    <div><dt>{props.labels.effective}</dt><dd>{formatTime(record.effectiveTime)}</dd></div>
                    <div><dt>{props.labels.superseded}</dt><dd>{record.supersededTime ? formatTime(record.supersededTime) : l.current}</dd></div>
                    <div><dt>{props.labels.manual}</dt><dd>{record.isManualOverride ? props.labels.yes : props.labels.no}</dd></div>
                    <div><dt>{props.labels.enabled}</dt><dd>{record.enabled ? props.labels.yes : props.labels.no}</dd></div>
                    <div><dt>{props.labels.reasoningRule}</dt><dd>{formatEnum(record.reasoningBillingRule.kind, props.labels)}</dd></div>
                  </dl>

                  <div className="pricing-card__edit-grid" aria-label={`${props.labels.edit}: ${record.canonicalVendor} ${record.canonicalModel}`}>
                    <label><span>{props.labels.input}</span><input className="control-placeholder__input" value={draft.inputPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), inputPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Input price")} /></label>
                    <label><span>{props.labels.output}</span><input className="control-placeholder__input" value={draft.outputPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), outputPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Output price")} /></label>
                    <label><span>{props.labels.reasoning}</span><input className="control-placeholder__input" value={draft.reasoningPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), reasoningPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Reasoning price")} /></label>
                    <label><span>{props.labels.cacheRead}</span><input className="control-placeholder__input" value={draft.cacheReadPrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), cacheReadPrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Cache read price")} /></label>
                    <label><span>{props.labels.cacheWrite}</span><input className="control-placeholder__input" value={draft.cacheWritePrice} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), cacheWritePrice: event.target.value } }))} aria-label={pricingFieldLabel(record, "Cache write price")} /></label>
                    <label className="pricing-card__source-edit"><span>{props.labels.source}</span><input className="control-placeholder__input" value={draft.sourceUrl} onChange={(event) => setDrafts((current) => ({ ...current, [record.id]: { ...getDraft(record), sourceUrl: event.target.value } }))} aria-label={pricingFieldLabel(record, "Source URL")} /></label>
                  </div>

                  <div className="pricing-card__actions">
                    <button type="button" className="pill-button" onClick={() => {
                      const latestDraft = getDraft(record)
                      if (![latestDraft.inputPrice, latestDraft.outputPrice, latestDraft.reasoningPrice, latestDraft.cacheReadPrice, latestDraft.cacheWritePrice].every((value) => value.trim() !== "")) {
                        return
                      }
                      const inputPrice = Number(latestDraft.inputPrice)
                      const outputPrice = Number(latestDraft.outputPrice)
                      const reasoningPrice = Number(latestDraft.reasoningPrice)
                      const cacheReadPrice = Number(latestDraft.cacheReadPrice)
                      const cacheWritePrice = Number(latestDraft.cacheWritePrice)
                      if (![inputPrice, outputPrice, reasoningPrice, cacheReadPrice, cacheWritePrice].every(Number.isFinite)) {
                        return
                      }
                      const sourceUrl = safeHttpUrl(latestDraft.sourceUrl.trim())
                      if (!sourceUrl) {
                        return
                      }
                      void props.onSavePricing?.(record, { inputPrice, outputPrice, reasoningPrice, cacheReadPrice, cacheWritePrice, sourceUrl })
                    }}>{props.labels.save}</button>
                    {record.enabled ? (
                      <>
                        <button type="button" className="pill-button" onClick={() => props.onMarkPricingManual?.(record)}>{props.labels.manual}</button>
                        <button type="button" className="pill-button" onClick={() => props.onArchivePricing?.(record.id)}>{props.labels.archive}</button>
                      </>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </CollapsiblePanel>
      <CollapsiblePanel title={props.labels.observedProviderCoverage} summary={observedCoverageSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: l.expand, collapse: l.collapse }}>
        {observedPricingCoverage.length === 0 ? (
          <p className="pricing-card-empty">{l.noObservedCoverage}</p>
        ) : (
          <div className="pricing-card-grid">
            {observedPricingCoverage.map((row) => {
              const sourceUrl = safeHttpUrl(row.sourceUrl)

              return (
                <article className="pricing-card" key={`${row.observedProviderId}/${row.observedModelId}`} aria-label={`Observed pricing coverage for ${row.observedProviderId} ${row.observedModelId}`}>
                  <div className="pricing-card__header">
                    <div className="pricing-card__identity">
                      <strong className="pricing-card__model">{row.observedProviderId} / {row.observedModelId}</strong>
                      <span className="pricing-card__vendor-id">
                        {row.canonicalVendor && row.canonicalModel ? `${l.pricedVia} ${row.canonicalVendor} / ${row.canonicalModel}` : l.unpriced}
                      </span>
                    </div>
                    <div className="pricing-card__badges" aria-label={`${props.labels.source} and ${props.labels.confidence}`}>
                      <span>{formatEnum(row.resolutionStatus, props.labels)}</span>
                      <span>{row.confidence ?? l.unavailable}</span>
                    </div>
                  </div>

                  <div className="pricing-card__source">
                    <span>{props.labels.source}</span>
                    <span>{row.sourceType ? formatEnum(row.sourceType, props.labels) : l.unavailable}</span>
                    {sourceUrl ? <a href={sourceUrl}>{row.sourceUrl}</a> : null}
                  </div>

                  <dl className="pricing-card__meta">
                    <div><dt>{l.messages}</dt><dd>{row.messageCount.toLocaleString(props.locale)}</dd></div>
                    <div><dt>{l.tokens}</dt><dd>{row.totalTokens.toLocaleString(props.locale)}</dd></div>
                    <div><dt>{l.firstSeen}</dt><dd>{formatTime(row.firstSeen)}</dd></div>
                    <div><dt>{l.lastSeen}</dt><dd>{formatTime(row.lastSeen)}</dd></div>
                  </dl>
                </article>
              )
            })}
          </div>
        )}
      </CollapsiblePanel>
      <CollapsiblePanel title={props.labels.pricingFreshness} summary={freshnessSummary} defaultOpen scrollBody className="leaderboard-panel" labels={{ expand: l.expand, collapse: l.collapse }}>
        <table>
          <tbody>
            {pricingRows.length === 0 ? <tr><td colSpan={2}>{l.freshnessUnavailable}</td></tr> : pricingRows.map((record) => (
              <tr key={`${record.id}-fresh`}>
                <td>{record.canonicalVendor} / {record.canonicalModel}</td>
                <td>{new Date((record.observedTime ?? record.effectiveTime) * 1000).toLocaleString(props.locale)}</td>
              </tr>
            ))}
            <tr>
              <td>{props.labels.missingPricing}</td>
              <td>{Math.round(missingPricingGap * 100)}%</td>
            </tr>
          </tbody>
        </table>
      </CollapsiblePanel>
      <CollapsiblePanel key={pricingCoverageGaps.length > 0 ? "missing-pricing-with-gaps" : "missing-pricing-no-gaps"} title={props.labels.missingPricing} summary={missingSummary} defaultOpen={pricingCoverageGaps.length > 0} className="leaderboard-panel" labels={{ expand: l.expand, collapse: l.collapse }}>
        <table>
          <tbody>
            {pricingCoverageGaps.length > 0 ? pricingCoverageGaps.map((gap) => {
              const draft = getGapDraft(gap)
              return (
                <tr key={`${gap.providerId}/${gap.modelId}-gap`}>
                  <td>{gap.providerId} / {gap.modelId}</td>
                  <td>
                    <div>{gap.totalTokens.toLocaleString(props.locale)} {l.tokens} · {gap.messageCount.toLocaleString(props.locale)} {l.messages}</div>
                    <dl className="pricing-gap-meta">
                      <div><dt>{l.firstSeen}</dt><dd>{formatTime(gap.firstSeen)}</dd></div>
                      <div><dt>{l.lastSeen}</dt><dd>{formatTime(gap.lastSeen)}</dd></div>
                      <div><dt>{l.reason}</dt><dd>{gap.reason}</dd></div>
                      <div><dt>{l.hint}</dt><dd>{gap.hint}</dd></div>
                    </dl>
                    <div className="pricing-card__edit-grid" aria-label={`${props.labels.missingPricing}: ${gap.providerId} ${gap.modelId}`}>
                      <label><span>{props.labels.input}</span><input className="control-placeholder__input" value={draft.inputPrice} onChange={(event) => setGapDraftField(gap, "inputPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Input price")} /></label>
                      <label><span>{props.labels.output}</span><input className="control-placeholder__input" value={draft.outputPrice} onChange={(event) => setGapDraftField(gap, "outputPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Output price")} /></label>
                      <label><span>{props.labels.reasoning}</span><input className="control-placeholder__input" value={draft.reasoningPrice} onChange={(event) => setGapDraftField(gap, "reasoningPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Reasoning price")} /></label>
                      <label><span>{props.labels.cacheRead}</span><input className="control-placeholder__input" value={draft.cacheReadPrice} onChange={(event) => setGapDraftField(gap, "cacheReadPrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Cache read price")} /></label>
                      <label><span>{props.labels.cacheWrite}</span><input className="control-placeholder__input" value={draft.cacheWritePrice} onChange={(event) => setGapDraftField(gap, "cacheWritePrice", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Cache write price")} /></label>
                      <label className="pricing-card__source-edit"><span>{props.labels.source}</span><input className="control-placeholder__input" value={draft.sourceUrl} onChange={(event) => setGapDraftField(gap, "sourceUrl", event.target.value)} aria-label={missingPricingFieldLabel(gap, "Source URL")} /></label>
                    </div>
                    <div className="pricing-card__actions">
                      <button type="button" className="pill-button" onClick={() => submitGapPricing(gap)} aria-label={`Create pricing for ${gap.providerId} ${gap.modelId}`}>{props.labels.save}</button>
                    </div>
                  </td>
                </tr>
              )
            }) : missingPricingSessions.length === 0 ? <tr><td colSpan={2}>{l.noMissingPricing}</td></tr> : missingPricingSessions.map((session) => (
              <tr key={`${session.sessionId}-gap`}>
                <td>{session.title}</td>
                <td>{props.labels.missingPricing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsiblePanel>
    </section>
  )
}
