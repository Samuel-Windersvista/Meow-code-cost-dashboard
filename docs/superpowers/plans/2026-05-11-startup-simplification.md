# 启动方式简化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为仓库增加“日常使用模式”的一键启动路径：用户首次 `build` 后，只需运行 `start-app.ps1`，即可通过 `http://127.0.0.1:41777` 打开由后端托管的前端首页。

**Architecture:** 保留现有开发模式（后端 41777 + Vite 41778）不变，同时新增一个使用模式。使用模式下，后端在存在 `dist/client` 构建产物时直接托管首页与静态资源；根目录的 `start-app.ps1` 负责检查构建产物、启动后端、等待健康检查通过、并打开浏览器。

**Tech Stack:** TypeScript, Express 4, Node.js test runner, tsx, PowerShell 7, Vite build output

---

## 文件结构与职责

- `server/static-client.ts`
  - 新建。封装“是否存在前端构建产物”“把构建后的前端挂到 Express”的逻辑，避免 `server/main.ts` 膨胀。

- `server/static-client.test.ts`
  - 新建。验证静态首页与静态资源都能从构建目录正常提供；缺失 `index.html` 时不会错误挂载。

- `server/main.ts`
  - 修改。把新 helper 接入现有启动流程，并在启动日志中区分“使用模式（后端提供首页）”和“开发模式（Vite 单独提供前端）”。

- `start-app.ps1`
  - 新建。面向最终用户的一键启动脚本；只负责构建产物检查、后端拉起、健康检查等待、浏览器打开与错误提示。

- `server/start-app.test.ts`
  - 新建。通过 Node 测试调用 PowerShell 脚本，覆盖缺失构建产物、正常启动、后端已在运行这三类关键路径。

- `README.md`
  - 修改。把“日常使用路径”提升为主入口，保留“开发调试路径”为次级入口。

不需要修改 `package.json`、`vite.config.ts`、`scripts/opencode-usage.ps1`。当前需求不要求新增 npm script，也不要求改造 `opencode --usage` 集成。

### Task 1: 让后端在使用模式下直接托管构建后的前端

**Files:**
- Create: `server/static-client.ts`
- Create: `server/static-client.test.ts`
- Modify: `server/main.ts`

- [ ] **Step 1: 先写失败测试，锁定静态首页与静态资源行为**

在 `server/static-client.test.ts` 中写入以下测试文件：

```ts
import assert from "node:assert/strict"
import fs from "node:fs"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { mountBuiltClient } from "./static-client"

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

test("mountBuiltClient serves the built homepage and assets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-static-client-"))
  const builtClientDir = path.join(root, "dist", "client")
  fs.mkdirSync(path.join(builtClientDir, "assets"), { recursive: true })
  fs.writeFileSync(path.join(builtClientDir, "index.html"), "<!doctype html><title>OpenCode Cost Observatory</title>")
  fs.writeFileSync(path.join(builtClientDir, "assets", "app.js"), "console.log('ready')")

  const app = express()
  assert.equal(mountBuiltClient(app, builtClientDir), true)

  const server = app.listen(0, "127.0.0.1")
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address() as AddressInfo

    const htmlResponse = await fetch(`http://127.0.0.1:${address.port}/`)
    assert.equal(htmlResponse.status, 200)
    assert.match(await htmlResponse.text(), /OpenCode Cost Observatory/)

    const assetResponse = await fetch(`http://127.0.0.1:${address.port}/assets/app.js`)
    assert.equal(assetResponse.status, 200)
    assert.equal(await assetResponse.text(), "console.log('ready')")
  } finally {
    await closeServer(server)
  }
})

test("mountBuiltClient returns false when the built homepage is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-static-client-missing-"))
  const builtClientDir = path.join(root, "dist", "client")
  fs.mkdirSync(builtClientDir, { recursive: true })

  const app = express()
  assert.equal(mountBuiltClient(app, builtClientDir), false)
})
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run:

```powershell
node --import tsx --test "server/static-client.test.ts"
```

Expected:
- 退出码非 0
- 失败信息包含 `Cannot find module './static-client'` 或 `mountBuiltClient is not defined`

- [ ] **Step 3: 写最小实现，新增静态前端挂载 helper**

创建 `server/static-client.ts`：

```ts
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import express, { type Express } from "express"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export function resolveBuiltClientDir(root = projectRoot) {
  return path.join(root, "dist", "client")
}

export function hasBuiltClient(buildDir = resolveBuiltClientDir()) {
  return fs.existsSync(path.join(buildDir, "index.html"))
}

export function mountBuiltClient(app: Express, buildDir = resolveBuiltClientDir()) {
  const indexPath = path.join(buildDir, "index.html")
  if (!fs.existsSync(indexPath)) {
    return false
  }

  app.use(express.static(buildDir, { index: false }))
  app.get("/", (_req, res) => {
    res.sendFile(indexPath)
  })

  return true
}
```

- [ ] **Step 4: 把 helper 接到 `server/main.ts`，并区分使用模式/开发模式日志**

将 `server/main.ts` 修改为下面这个结构（保留原文件未展示的 import/尾部不变）：

```ts
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import { authRoutes, requireDashboardToken } from "./auth"
import { AppConfig, loadConfig } from "./config"
import { diagnosticsRoutes } from "./routes/diagnostics"
import { healthRoutes } from "./routes/health"
import { leaderboardsRoutes } from "./routes/leaderboards"
import { overviewRoutes } from "./routes/overview"
import { pricingRoutes } from "./routes/pricing"
import { seriesRoutes } from "./routes/series"
import { syncRoutes } from "./routes/sync"
import { queueColdStartAnalyticsRefresh } from "./services/cold-start-sync"
import { ensurePricingRegistryReady } from "./services/pricing-recovery"
import { bootstrapAnalyticsDb } from "./storage/db"
import { hasBuiltClient, mountBuiltClient, resolveBuiltClientDir } from "./static-client"

type CreateServerOptions = {
  builtClientDir?: string
}

function formatHttpHost(host: string) {
  return host.includes(":") ? `[${host}]` : host
}

export function createServer(_config: AppConfig = loadConfig(), options: CreateServerOptions = {}) {
  bootstrapAnalyticsDb(_config.analyticsDbPath)
  ensurePricingRegistryReady(_config.analyticsDbPath, _config.pricingDbPath)

  const builtClientDir = options.builtClientDir ?? resolveBuiltClientDir()
  const app = express()
  app.disable("x-powered-by")
  app.use(express.json())
  app.use(healthRoutes())
  app.use(authRoutes(_config.dashboardToken, { localAuthFilePath: _config.dashboardTokenFilePath }))
  app.use("/api", authRoutes(_config.dashboardToken, { localAuthFilePath: _config.dashboardTokenFilePath }))
  app.use(diagnosticsRoutes(_config.analyticsDbPath, _config.dashboardToken))
  app.use("/api", diagnosticsRoutes(_config.analyticsDbPath, _config.dashboardToken))
  mountBuiltClient(app, builtClientDir)
  app.use(requireDashboardToken(_config.dashboardToken))
  app.use(overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use(syncRoutes(_config.analyticsDbPath, _config.opencodeDbPath))
  app.use("/api", overviewRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", seriesRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", leaderboardsRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", pricingRoutes(_config.analyticsDbPath, _config.pricingDbPath))
  app.use("/api", syncRoutes(_config.analyticsDbPath, _config.opencodeDbPath))
  return app
}

export async function startServer(config: AppConfig = loadConfig(), options: CreateServerOptions = {}) {
  const builtClientDir = options.builtClientDir ?? resolveBuiltClientDir()
  const app = createServer(config, { builtClientDir })

  return await new Promise<import("node:http").Server>((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(`observatory backend listening on http://${formatHttpHost(config.host)}:${config.port}`)
      if (hasBuiltClient(builtClientDir)) {
        console.log(`usage mode homepage available at http://${formatHttpHost(config.host)}:${config.port}`)
      } else {
        console.log("vite client is separate; run npm run dev for the browser scaffold")
      }
      try {
        queueColdStartAnalyticsRefresh(config.analyticsDbPath, config.opencodeDbPath)
      } catch (error) {
        console.warn("cold-start analytics refresh was not queued", error)
      }
      resolve(server)
    })

    server.once("error", reject)
  })
}
```

- [ ] **Step 5: 再跑测试，确认静态托管行为通过**

Run:

```powershell
node --import tsx --test "server/static-client.test.ts"
```

Expected:
- 退出码为 0
- 2 个测试全部通过

- [ ] **Step 6: 提交这一批后端改动**

```powershell
git add server/static-client.ts server/static-client.test.ts server/main.ts
git commit -m "feat: serve built client from backend"
```

### Task 2: 增加面向日常使用的一键启动脚本

**Files:**
- Create: `start-app.ps1`
- Create: `server/start-app.test.ts`

- [ ] **Step 1: 先写失败测试，锁定启动脚本的三条关键路径**

创建 `server/start-app.test.ts`：

```ts
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
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
    execFileAsync("pwsh", ["-NoProfile", "-File", startAppScript], {
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-success-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")
  const fakeBootstrapPath = path.join(root, "fake-bootstrap.ps1")

  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")
  fs.writeFileSync(fakeBootstrapPath, [
    'param([string]$Mode = "start")',
    'if ($Mode -eq "start") { "4242"; exit 0 }',
    'if ($Mode -eq "status") { "4242"; exit 0 }',
    'if ($Mode -eq "stop") { "stopped"; exit 0 }',
    'throw "unexpected mode"',
  ].join("\n"))

  const healthy = await startHealthyServer()
  try {
    const result = await execFileAsync("pwsh", ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: fakeBootstrapPath,
        OBSERVATORY_START_HEALTH_URL: healthy.healthUrl,
        OBSERVATORY_START_APP_URL: healthy.appUrl,
        OBSERVATORY_START_SKIP_OPEN_BROWSER: "1",
      },
    })

    assert.match(result.stdout, /\[OK\] Backend ready/)
    assert.match(result.stdout, /\[OK\] Frontend served from dist\/client/)
    assert.match(result.stdout, /Opening browser/)
  } finally {
    await closeServer(healthy.server)
  }
})

test("start-app.ps1 reuses an already healthy backend without running bootstrap", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-start-app-running-"))
  const buildIndexPath = path.join(root, "dist", "client", "index.html")
  const failingBootstrapPath = path.join(root, "failing-bootstrap.ps1")

  fs.mkdirSync(path.dirname(buildIndexPath), { recursive: true })
  fs.writeFileSync(buildIndexPath, "<!doctype html><title>OpenCode Cost Observatory</title>")
  fs.writeFileSync(failingBootstrapPath, 'throw "bootstrap should not be invoked"')

  const healthy = await startHealthyServer()
  try {
    const result = await execFileAsync("pwsh", ["-NoProfile", "-File", startAppScript], {
      env: {
        ...process.env,
        OBSERVATORY_START_BUILD_INDEX: buildIndexPath,
        OBSERVATORY_START_BOOTSTRAP_SCRIPT: failingBootstrapPath,
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
```

- [ ] **Step 2: 运行测试，确认脚本行为还没实现时会失败**

Run:

```powershell
node --import tsx --test "server/start-app.test.ts"
```

Expected:
- 退出码非 0
- 失败信息包含 `Cannot find path ... start-app.ps1`

- [ ] **Step 3: 写 `start-app.ps1` 的最小可用实现**

创建 `start-app.ps1`：

```powershell
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildIndexPath = if ($env:OBSERVATORY_START_BUILD_INDEX) { $env:OBSERVATORY_START_BUILD_INDEX } else { Join-Path $projectRoot "dist\client\index.html" }
$bootstrapScript = if ($env:OBSERVATORY_START_BOOTSTRAP_SCRIPT) { $env:OBSERVATORY_START_BOOTSTRAP_SCRIPT } else { Join-Path $projectRoot "bootstrap.ps1" }
$healthUrl = if ($env:OBSERVATORY_START_HEALTH_URL) { $env:OBSERVATORY_START_HEALTH_URL } else { "http://127.0.0.1:41777/health" }
$appUrl = if ($env:OBSERVATORY_START_APP_URL) { $env:OBSERVATORY_START_APP_URL } else { "http://127.0.0.1:41777" }
$skipOpenBrowser = $env:OBSERVATORY_START_SKIP_OPEN_BROWSER -eq "1"

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
  Write-Step "服务已启动，但未能自动打开浏览器。"
  Write-Step "请手动访问："
  Write-Step $appUrl
}

if (-not (Test-Path -LiteralPath $buildIndexPath)) {
  Write-Failure "未发现前端构建产物。"
  Write-Failure "请先执行："
  Write-Failure "  npm ci"
  Write-Failure "  npm run build"
  Write-Failure "然后重新运行 start-app.ps1"
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

$bootstrapOutput = (& "pwsh" "-NoProfile" "-File" $bootstrapScript "start" 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  Write-Failure "启动失败：后端启动命令返回非零退出码。"
  if ($bootstrapOutput) {
    Write-Failure $bootstrapOutput
  }
  Write-Failure "请检查：.env / dashboard.config.json、OPENCODE_DB_PATH、41777 端口、以及 .run 日志文件。"
  exit 1
}

if (-not (Wait-BackendHealthy)) {
  Write-Failure "启动失败：后端未能在 30 秒内就绪。"
  if ($bootstrapOutput) {
    Write-Failure $bootstrapOutput
  }
  Write-Failure "请检查：.env / dashboard.config.json、OPENCODE_DB_PATH、41777 端口、以及 .run 日志文件。"
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
```

- [ ] **Step 4: 再跑脚本测试，确认一键启动脚本关键路径通过**

Run:

```powershell
node --import tsx --test "server/start-app.test.ts"
```

Expected:
- 退出码为 0
- 3 个测试全部通过

- [ ] **Step 5: 提交启动脚本相关改动**

```powershell
git add start-app.ps1 server/start-app.test.ts
git commit -m "feat: add one-click usage launcher"
```

### Task 3: 更新 README，并做整体验证

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 把 README 改成“日常使用优先，开发调试次之”**

将 README 中的启动说明改成下面的结构（保留上方配置说明不变）：

```md
## Daily use

Build the frontend once, then start the app with a single script:

```powershell
npm ci
npm run build
pwsh -File .\start-app.ps1
```

The default homepage URL in daily-use mode is `http://127.0.0.1:41777`.

## Development

For development, keep the backend and frontend separate:

```powershell
pwsh -File .\bootstrap.ps1 start
npm run dev
```

The frontend dev server remains `http://127.0.0.1:41778`.

## Check backend status

```powershell
pwsh -File .\bootstrap.ps1 status
```

## Stop backend

```powershell
pwsh -File .\bootstrap.ps1 stop
```
```

说明：README 保持英文，符合仓库当前文档风格；但文档结构要把“日常使用”放在“开发模式”之前。

- [ ] **Step 2: 运行构建，确认使用模式依赖的前端产物能生成**

Run:

```powershell
npm run build
```

Expected:
- 退出码为 0
- `dist/client/index.html` 存在

- [ ] **Step 3: 运行类型检查与本次新增测试，确认整条链路成立**

Run:

```powershell
npm run check
node --import tsx --test "server/static-client.test.ts" "server/start-app.test.ts" "server/routes/diagnostics.test.ts"
```

Expected:
- `npm run check` 退出码为 0
- 所有选定测试通过

- [ ] **Step 4: 提交文档与最终验证结果**

```powershell
git add README.md
git commit -m "docs: document one-click startup flow"
```

## 计划自检

### Spec coverage

- “后端成为使用模式唯一入口” → Task 1
- “新增 `start-app.ps1` 一键启动” → Task 2
- “缺少 build / 浏览器失败 / 已在运行等错误路径” → Task 2
- “README 调整为日常使用优先” → Task 3
- “开发模式继续保留” → Task 1 + Task 3

没有遗漏的 spec 条目。

### Placeholder scan

- 未发现占位符标记
- 无“适当处理错误”这类空泛措辞；每个关键错误路径都有明确代码与提示文案
- 每个代码步骤都给出了实际代码块

### Type consistency

- `mountBuiltClient`、`hasBuiltClient`、`resolveBuiltClientDir` 在 Task 1 内命名一致
- `OBSERVATORY_START_*` 环境变量在 Task 2 的测试与脚本中命名一致
- `start-app.ps1` 的成功/失败路径与测试断言文案一致
