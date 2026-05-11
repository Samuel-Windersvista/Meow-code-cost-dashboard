import assert from "node:assert/strict"
import { execFile, execSync } from "node:child_process"
import fs from "node:fs"
import type { Server } from "node:http"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const startAppScript = fileURLToPath(new URL("../start-app.ps1", import.meta.url))

// Committed test fixtures -- no dynamically-written executable scripts in temp dirs.
const bootstrapFixture = fileURLToPath(new URL("./test/fixtures/bootstrap-fixture.ps1", import.meta.url))
const failingBootstrapFixture = fileURLToPath(new URL("./test/fixtures/failing-bootstrap.ps1", import.meta.url))

function resolvePwsh(): string {
  try {
    return execSync("where pwsh 2>nul", { encoding: "utf8", shell: "cmd.exe" }).trim().split("\r\n")[0] || "powershell.exe"
  } catch {
    return "powershell.exe"
  }
}

const pwsh = resolvePwsh()

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function startHealthyServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.writeHead(200, { "content-type": "text/html" })
    res.end("<!doctype html><title>OpenCode Cost Observatory</title>")
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    server,
    appUrl: `http://127.0.0.1:${address.port}`,
    healthUrl: `http://127.0.0.1:${address.port}/health`,
  }
}

test("start-app.ps1 exits early when built client output is missing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-missing-"))

  await assert.rejects(
    execFileAsync(pwsh, ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: path.join(root, "dist", "client", "index.html"),
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
      },
    }),
    (error: { stderr?: string; stdout?: string }) => {
      assert.match(`${error.stderr ?? ""}${error.stdout ?? ""}`, /npm run build/)
      return true
    },
  )
})

test("start-app.ps1 starts the backend and reports success once health is ready", async () => {
  // Temp dir for data artifacts only (build index, PID file) -- no executable scripts.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-success-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")
  const pidFile = path.join(root, "fixture-server.pid")

  // Create the fake build output so the script passes the build-index check.
  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")

  // Pick a free port for the fixture server.
  const tempServer = http.createServer()
  await new Promise<void>((resolve) => tempServer.listen(0, "127.0.0.1", resolve))
  const port = (tempServer.address() as AddressInfo).port
  await closeServer(tempServer)

  const healthUrl = `http://127.0.0.1:${port}/health`
  const appUrl = `http://127.0.0.1:${port}`

  try {
    const result = await execFileAsync(pwsh, ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: bootstrapFixture,
        OBSERVATORY_START_HEALTH_URL: healthUrl,
        OBSERVATORY_START_APP_URL: appUrl,
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
        OBSERVATORY_FIXTURE_PORT: String(port),
        OBSERVATORY_FIXTURE_PID_FILE: pidFile,
      },
    })

    assert.match(result.stdout, /\[OK\] Backend ready/)
    assert.match(result.stdout, /\[OK\] Frontend served from dist\/client/)
    assert.match(result.stdout, /Opening browser/)
  } finally {
    // Cleanup: kill the fixture server process if still running.
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10)
        if (pid) {
          await execFileAsync("taskkill", ["/PID", String(pid), "/F"]).catch(() => {
            // Process may have already exited.
          })
        }
      } catch {
        // Best-effort cleanup.
      }
    }
  }
})

test("start-app.ps1 reuses an already healthy backend without running bootstrap", async () => {
  // Temp dir for data artifacts only (build index) -- no executable scripts.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-running-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")

  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")

  const healthy = await startHealthyServer()
  try {
    const result = await execFileAsync(pwsh, ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: failingBootstrapFixture,
        OBSERVATORY_START_HEALTH_URL: healthy.healthUrl,
        OBSERVATORY_START_APP_URL: healthy.appUrl,
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
      },
    })

    assert.match(result.stdout, /already running/i)
    assert.match(result.stdout, /Opening browser/)
  } finally {
    await closeServer(healthy.server)
  }
})

test("start-app.ps1 derives default health/app URLs from configured PORT when no explicit URL overrides are set", async () => {
  // This test exercises the bugfix where start-app.ps1 hardcoded
  // http://127.0.0.1:41777 as the default health/app URLs. With the
  // fix, it should derive those URLs from the HOST/PORT env vars that
  // bootstrap.ps1 also reads, so a non-default port works correctly
  // without requiring the launcher-specific OBSERVATORY_START_*_URL
  // overrides.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-port-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")

  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")

  const healthy = await startHealthyServer()
  const port = (healthy.server.address() as AddressInfo).port
  // Ensure we are on a non-default port (41777 is the hardcoded default).
  assert.notStrictEqual(port, 41777, "test server must be on a non-default port")

  try {
    const result = await execFileAsync(pwsh, ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        // Use PORT env var like bootstrap.ps1 reads it — NOT the launcher-only
        // OBSERVATORY_START_HEALTH_URL / OBSERVATORY_START_APP_URL overrides.
        PORT: String(port),
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: failingBootstrapFixture,
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
        // DELIBERATELY omit OBSERVATORY_START_HEALTH_URL and OBSERVATORY_START_APP_URL.
      },
    })

    // The script should detect the already-running backend via the derived
    // health URL and report success without invoking bootstrap.
    assert.match(result.stdout, /already running/i)
    assert.match(result.stdout, /Opening browser/)
    // The output should reference the correct non-default port.
    assert.match(result.stdout, new RegExp(String(port)))
  } finally {
    await closeServer(healthy.server)
  }
})

test("start-app.ps1 derives default host/port from .env when no process env or explicit URL overrides are set", async () => {
  // Regression: start-app.ps1 must resolve host/port from .env with the
  // same precedence as bootstrap.ps1 (process env > .env > dashboard.config.json > defaults).
  // This test verifies the .env fallback when no HOST/PORT env vars are set.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-env-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")

  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")

  const healthy = await startHealthyServer()
  const port = (healthy.server.address() as AddressInfo).port
  assert.notStrictEqual(port, 41777, "test server must be on a non-default port")

  // Create .env with PORT only — no process-env HOST/PORT.
  const envFilePath = path.join(root, ".env")
  fs.writeFileSync(envFilePath, `PORT=${port}\n`)

  try {
    const result = await execFileAsync(pwsh, ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: failingBootstrapFixture,
        OBSERVATORY_START_ENV_FILE: envFilePath,
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
        // DELIBERATELY omit PORT/HOST env vars and URL overrides.
      },
    })

    assert.match(result.stdout, /already running/i)
  } finally {
    await closeServer(healthy.server)
  }
})

test("start-app.ps1 derives default host/port from dashboard.config.json when no process env, .env, or explicit URL overrides are set", async () => {
  // Regression: start-app.ps1 must resolve host/port from dashboard.config.json
  // as the lowest-precedence config source, matching bootstrap.ps1 behavior.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-dashboard-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")

  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")

  const healthy = await startHealthyServer()
  const port = (healthy.server.address() as AddressInfo).port
  assert.notStrictEqual(port, 41777, "test server must be on a non-default port")

  // Create dashboard.config.json with port — no .env, no process-env HOST/PORT.
  const configPath = path.join(root, "dashboard.config.json")
  fs.writeFileSync(configPath, JSON.stringify({ port }))

  try {
    const result = await execFileAsync(pwsh, ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: failingBootstrapFixture,
        OBSERVATORY_START_DASHBOARD_CONFIG: configPath,
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
        // DELIBERATELY omit PORT/HOST env vars, .env file, and URL overrides.
      },
    })

    assert.match(result.stdout, /already running/i)
  } finally {
    await closeServer(healthy.server)
  }
})

test("start-app.ps1 always respects explicit OBSERVATORY_START_HEALTH_URL / OBSERVATORY_START_APP_URL overrides even when config files exist", async () => {
  // Guard: explicit launcher-level URL overrides must win over ALL other
  // config sources (process env, .env, dashboard.config.json).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-override-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")

  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")

  const healthy = await startHealthyServer()
  const port = (healthy.server.address() as AddressInfo).port
  assert.notStrictEqual(port, 41777, "test server must be on a non-default port")

  // Set up config files pointing to a WRONG port, so the test proves
  // the explicit override is what wins, not the config files.
  const wrongPort = port === 41778 ? 41779 : 41778

  const envFilePath = path.join(root, ".env")
  fs.writeFileSync(envFilePath, `PORT=${wrongPort}\n`)

  const configPath = path.join(root, "dashboard.config.json")
  fs.writeFileSync(configPath, JSON.stringify({ port: wrongPort }))

  try {
    const result = await execFileAsync(pwsh, ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: failingBootstrapFixture,
        OBSERVATORY_START_ENV_FILE: envFilePath,
        OBSERVATORY_START_DASHBOARD_CONFIG: configPath,
        OBSERVATORY_START_HEALTH_URL: healthy.healthUrl,
        OBSERVATORY_START_APP_URL: healthy.appUrl,
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
        // DELIBERATELY omit PORT/HOST env vars — config files point elsewhere.
      },
    })

    assert.match(result.stdout, /already running/i)
  } finally {
    await closeServer(healthy.server)
  }
})
