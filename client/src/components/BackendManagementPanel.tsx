import { useState } from "react"
import { RefreshButton } from "./RefreshButton"
import { normalizeLocalhostAuthPayload, type BackendDiagnosticsResponse, type LocalhostAuthPayload, type RefreshResponse } from "../api/client"

function formatEpoch(value: number | null | undefined, locale: Intl.LocalesArgument) {
  if (value == null) {
    return null
  }

  return new Date(value * 1000).toLocaleString(locale, { timeZone: "UTC" })
}

function lifecycleFrom(diagnostics: BackendDiagnosticsResponse | null, updateStatus: RefreshResponse | null) {
  return diagnostics?.sync?.lifecycle ?? updateStatus?.lifecycle ?? (updateStatus?.status ? {
    status: updateStatus.status,
    requestedAt: updateStatus.requestedAt,
    startedAt: updateStatus.startedAt,
    completedAt: updateStatus.completedAt,
    sessionsSynced: updateStatus.sessionsSynced,
    messagesSynced: updateStatus.messagesSynced,
    durationMs: updateStatus.durationMs,
    error: updateStatus.error,
  } : null)
}

export function BackendManagementPanel(props: {
  ariaLabel: string
  backendHealthLabel: string
  authenticatedLabel: string
  unauthenticatedLabel: string
  isAuthenticated: boolean
  isBackendOnline: boolean
  isLoading: boolean
  isRefreshing: boolean
  status: string
  refreshLabel: string
  refreshingLabel: string
  onRefresh: () => void
  onAuthenticate: (payload: LocalhostAuthPayload) => void
  onStartBackend: () => void
  onRestartBackend: () => void
  onCheckBackend: () => void
  backendActionStatus?: null | "authenticating" | "authenticated" | "failed"
  backendControlStatus?: null | "checking" | "starting" | "restarting" | "started" | "restarted" | "failed"
  diagnostics: BackendDiagnosticsResponse | null
  updateStatus: RefreshResponse | null
  lagSummary: string
  locale: Intl.LocalesArgument
  labels: {
    backendOfflineUpdateDisabled: string
    unauthenticatedUpdateDisabled: string
    connectingDashboard: string
    tokenAuthFailed: string
    tokenFileHelp: string
    lastSuccessfulSync: string
    lastUpdateAttempt: string
    connectDashboard: string
    dashboardToken: string
    tokenFilePath: string
    localOnlyDescription: string
    startingBackend: string
    restartingBackend: string
    checkingBackend: string
    backendControlFailed: string
    backendControlCompleted: string
    backendControlHelp: string
    startBackend: string
    restartBackend: string
    retryStatus: string
  }
}) {
  const [token, setToken] = useState("")
  const [authFilePath, setAuthFilePath] = useState(".run/dashboard.token")
  const l = props.labels
  const visibleUpdateStatus = props.isBackendOnline ? props.updateStatus : null
  const lifecycle = lifecycleFrom(props.diagnostics, visibleUpdateStatus)
  const lastSuccessful = formatEpoch(props.diagnostics?.sync?.lastSuccessfulSyncTime ?? lifecycle?.lastSuccessfulSyncTime ?? props.diagnostics?.sync?.lastSyncTime, props.locale)
  const attemptTime = formatEpoch(lifecycle?.completedAt ?? lifecycle?.startedAt ?? lifecycle?.requestedAt ?? visibleUpdateStatus?.completedAt ?? visibleUpdateStatus?.requestedAt, props.locale)
  const updateDisabledReason = !props.isBackendOnline
    ? l.backendOfflineUpdateDisabled
    : !props.isAuthenticated
      ? l.unauthenticatedUpdateDisabled
      : null
  const actionCopy = props.backendActionStatus === "authenticating"
    ? l.connectingDashboard
    : props.backendActionStatus === "failed"
      ? l.tokenAuthFailed
      : l.tokenFileHelp
  const isControllingBackend = props.backendControlStatus === "checking" || props.backendControlStatus === "starting" || props.backendControlStatus === "restarting"
  const offlineControlCopy = props.backendControlStatus === "starting"
    ? l.startingBackend
    : props.backendControlStatus === "restarting"
      ? l.restartingBackend
      : props.backendControlStatus === "checking"
        ? l.checkingBackend
        : props.backendControlStatus === "failed"
          ? l.backendControlFailed
          : props.backendControlStatus === "started" || props.backendControlStatus === "restarted"
            ? l.backendControlCompleted
            : l.backendControlHelp

  return (
    <section className="status-panel__block dashboard-header__status-card backend-sync-panel" aria-label={props.ariaLabel}>
      <span className="status-panel__label">{props.ariaLabel}</span>
      <strong>{props.backendHealthLabel} · {props.isAuthenticated ? props.authenticatedLabel : props.unauthenticatedLabel}</strong>
      <p className="hero-card__caption">{props.lagSummary}</p>
      {lastSuccessful ? <p className="hero-card__caption">{l.lastSuccessfulSync}: {lastSuccessful}</p> : null}
      {attemptTime && lifecycle ? (
        <p className="hero-card__caption">{l.lastUpdateAttempt}: {lifecycle.status} · {attemptTime}</p>
      ) : null}
      {lifecycle?.error ? <p className="hero-card__caption backend-sync-panel__error">{lifecycle.error}</p> : null}
      {updateDisabledReason ? <p className="hero-card__caption">{updateDisabledReason}</p> : null}
      {!props.isBackendOnline ? (
        <div className="backend-auth-panel">
          <p className="hero-card__caption">{offlineControlCopy}</p>
          <div className="refresh-cluster">
            <button type="button" className="console-button console-button--ghost" onClick={props.onStartBackend} disabled={isControllingBackend}>{l.startBackend}</button>
            <button type="button" className="console-button console-button--ghost" onClick={props.onRestartBackend} disabled={isControllingBackend}>{l.restartBackend}</button>
            <button type="button" className="console-button console-button--ghost" onClick={props.onCheckBackend} disabled={isControllingBackend}>{l.retryStatus}</button>
          </div>
        </div>
      ) : null}
      {(!props.isAuthenticated || !props.isBackendOnline) ? (
        <div className="backend-auth-panel">
          <p className="hero-card__caption">{l.localOnlyDescription}</p>
          <label className="backend-auth-panel__field">
            <span>{l.dashboardToken}</span>
            <input value={token} onChange={(event) => setToken(event.currentTarget.value)} aria-label={l.dashboardToken} type="password" autoComplete="off" disabled={!props.isBackendOnline} />
          </label>
          <label className="backend-auth-panel__field">
            <span>{l.tokenFilePath}</span>
            <input value={authFilePath} onChange={(event) => setAuthFilePath(event.currentTarget.value)} aria-label={l.tokenFilePath} type="text" disabled={!props.isBackendOnline} />
          </label>
          <button
            type="button"
            className="console-button console-button--ghost"
            onClick={() => props.onAuthenticate(normalizeLocalhostAuthPayload({ token, authFilePath }))}
            disabled={!props.isBackendOnline || props.backendActionStatus === "authenticating"}
          >
            {l.connectDashboard}
          </button>
          <p className="hero-card__caption">{actionCopy}</p>
        </div>
      ) : null}
      <RefreshButton
        label={props.refreshLabel}
        refreshingLabel={props.refreshingLabel}
        isRefreshing={props.isRefreshing}
        isLoading={props.isLoading}
        isAuthenticated={props.isAuthenticated}
        isBackendOnline={props.isBackendOnline}
        onRefresh={props.onRefresh}
        status={updateDisabledReason ?? props.status}
      />
    </section>
  )
}
