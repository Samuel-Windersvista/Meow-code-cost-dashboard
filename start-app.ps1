$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildIndexPath = if ($env:OBSERVATORY_START_BUILD_INDEX) { $env:OBSERVATORY_START_BUILD_INDEX } else { Join-Path $projectRoot "dist\client\index.html" }
$bootstrapScript = if ($env:OBSERVATORY_START_BOOTSTRAP_SCRIPT) { $env:OBSERVATORY_START_BOOTSTRAP_SCRIPT } else { Join-Path $projectRoot "bootstrap.ps1" }
$skipOpenBrowser = $env:OBSERVATORY_START_SKIP_OPEN_BROWSER -eq "1"

# --- Resolve host / port for default health/app URLs ---
# The launcher-level OBSERVATORY_START_*_URL overrides always win, but when
# they are absent we derive the URLs from the same config precedence that
# bootstrap.ps1 uses: process env > .env > dashboard.config.json > defaults.
# This prevents the launcher from probing or opening a hardcoded
# 127.0.0.1:41777 when the actual server binds elsewhere.

# Allow tests to point at temporary config files via optional env vars.
$envFile = if ($env:OBSERVATORY_START_ENV_FILE) { $env:OBSERVATORY_START_ENV_FILE } else { Join-Path $projectRoot ".env" }
$dashboardConfigFile = if ($env:OBSERVATORY_START_DASHBOARD_CONFIG) { $env:OBSERVATORY_START_DASHBOARD_CONFIG } else { Join-Path $projectRoot "dashboard.config.json" }

function Read-KeyValueFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path $Path)) { return $values }
  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $separatorIndex = $trimmed.IndexOf("=")
    if ($separatorIndex -le 0) { continue }
    $key = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()
    if ($key) { $values[$key] = $value }
  }
  return $values
}

function Read-DashboardConfig([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  try { return Get-Content -Path $Path -Raw | ConvertFrom-Json } catch { return $null }
}

$envFileConfig = Read-KeyValueFile $envFile
$dashboardConfig = Read-DashboardConfig $dashboardConfigFile

$cfgHost = if ($env:HOST) {
  $env:HOST
} elseif ($envFileConfig.ContainsKey("HOST")) {
  $envFileConfig["HOST"]
} elseif ($dashboardConfig -and $dashboardConfig.host) {
  [string]$dashboardConfig.host
} else {
  "127.0.0.1"
}

$cfgPort = if ($env:PORT) {
  [int]$env:PORT
} elseif ($envFileConfig.ContainsKey("PORT")) {
  [int]$envFileConfig["PORT"]
} elseif ($dashboardConfig -and $dashboardConfig.port) {
  [int]$dashboardConfig.port
} else {
  41777
}

# Map bind-all addresses (0.0.0.0 / ::) to loopback equivalents suitable for
# health checks performed from the same machine.
$healthHost = if ($cfgHost -eq "0.0.0.0") { "127.0.0.1" } elseif ($cfgHost -eq "::") { "::1" } else { $cfgHost }

# Format host for URL (wrap IPv6 literals in brackets).
$httpHost = if ($healthHost.Contains(":")) { "[$healthHost]" } else { $healthHost }

$derivedHealthUrl = "http://${httpHost}:${cfgPort}/health"
$derivedAppUrl = "http://${httpHost}:${cfgPort}"

$healthUrl = if ($env:OBSERVATORY_START_HEALTH_URL) { $env:OBSERVATORY_START_HEALTH_URL } else { $derivedHealthUrl }
$appUrl = if ($env:OBSERVATORY_START_APP_URL) { $env:OBSERVATORY_START_APP_URL } else { $derivedAppUrl }

# Derive the human-readable health target from the configured URL so failure
# guidance always references the actual address instead of a hardcoded port.
$healthUri = [System.Uri]$healthUrl
$healthTarget = "$($healthUri.Host):$($healthUri.Port)"
$appTarget = "$($healthUri.Host):$($healthUri.Port)"

# Resolve a usable PowerShell executable for internal bootstrap invocation.
# Users are expected to have pwsh installed; fall back to powershell.exe only when pwsh is absent.
$pwshExe = $null
try {
  $pwshExe = (Get-Command pwsh -ErrorAction Stop).Source
} catch {
  try {
    $pwshExe = (Get-Command pwsh.exe -ErrorAction Stop).Source
  } catch {
    $pwshExe = (Get-Command powershell.exe -ErrorAction Stop).Source
  }
}

function Write-Step([string]$Message) {
  [Console]::Out.WriteLine($Message)
}

function Write-Failure([string]$Message) {
  [Console]::Error.WriteLine($Message)
}

function Test-BackendHealthy {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -ne 200) {
      return $false
    }

    $payload = $response.Content | ConvertFrom-Json -ErrorAction Stop
    return ($payload.ok -is [bool]) -and ($payload.ok -eq $true)
  } catch {
    return $false
  }
}

function Wait-BackendHealthy {
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-BackendHealthy) {
      return $true
    }
    Start-Sleep -Milliseconds 250
  }

  return $false
}

function Open-AppPage {
  if ($skipOpenBrowser) {
    return $true
  }

  try {
    Start-Process $appUrl | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Print-BrowserFallback {
  Write-Step "Service is running but the browser could not be opened automatically."
  Write-Step "Please open this URL manually:"
  Write-Step $appUrl
}

if (-not (Test-Path -LiteralPath $buildIndexPath)) {
  Write-Failure "No built front-end output found."
  Write-Failure "Please run the following commands first:"
  Write-Failure "  npm ci"
  Write-Failure "  npm run build"
  Write-Failure "Then run start-app.ps1 again."
  exit 1
}

if (Test-BackendHealthy) {
  Write-Step "[OK] Observatory already running"
  if (Open-AppPage) {
    Write-Step "[OK] Opening browser: $appUrl"
    exit 0
  }

  Print-BrowserFallback
  exit 0
}

$bootstrapOutput = (& $pwshExe -NoProfile -File $bootstrapScript "start" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  Write-Failure "Startup failed: the backend start command returned a non-zero exit code."
  if ($bootstrapOutput) {
    Write-Failure $bootstrapOutput
  }
  Write-Failure "Please check: .env / dashboard.config.json, OPENCODE_DB_PATH, $healthTarget, and the .run log files."
  exit 1
}

if (-not (Wait-BackendHealthy)) {
  Write-Failure "Startup failed: the backend did not become healthy within 30 seconds."
  if ($bootstrapOutput) {
    Write-Failure $bootstrapOutput
  }
  Write-Failure "Please check: .env / dashboard.config.json, OPENCODE_DB_PATH, $healthTarget, and the .run log files."
  exit 1
}

Write-Step "[OK] Backend ready"
Write-Step "[OK] Frontend served from dist/client"
if (Open-AppPage) {
  Write-Step "[OK] Opening browser: $appUrl"
  exit 0
}

Print-BrowserFallback
exit 0
