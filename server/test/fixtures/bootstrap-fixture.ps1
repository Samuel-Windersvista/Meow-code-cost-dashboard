# Committed test fixture: spawns fixture-server.cjs as a background process.
# Reads OBSERVATORY_FIXTURE_PID_FILE from env for the stop subcommand.

param([string]$Mode = "start")

if ($Mode -eq "start") {
    $fixtureServer = Join-Path $PSScriptRoot "fixture-server.cjs"
    $null = Start-Process node -ArgumentList $fixtureServer -WindowStyle Hidden
    Start-Sleep -Milliseconds 1000
    exit 0
}

if ($Mode -eq "status") {
    exit 0
}

if ($Mode -eq "stop") {
    $pidPath = $env:OBSERVATORY_FIXTURE_PID_FILE
    if ($pidPath -and (Test-Path $pidPath)) {
        $pidToKill = Get-Content $pidPath
        Stop-Process -Id ([int]$pidToKill) -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

throw "unexpected mode $Mode"
