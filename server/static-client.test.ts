import assert from "node:assert/strict"
import fs from "node:fs"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { createServer } from "./main"
import { mountPublicBuiltClient } from "./static-client"

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

test("mountPublicBuiltClient serves the built homepage and assets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-static-client-"))
  const builtClientDir = path.join(root, "dist", "client")
  fs.mkdirSync(path.join(builtClientDir, "assets"), { recursive: true })
  fs.writeFileSync(path.join(builtClientDir, "index.html"), "<!doctype html><title>OpenCode Cost Observatory</title>")
  fs.writeFileSync(path.join(builtClientDir, "assets", "app.js"), "console.log('ready')")

  const app = express()
  assert.equal(mountPublicBuiltClient(app, builtClientDir), true)

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

test("mountPublicBuiltClient returns false when the built homepage is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-static-client-missing-"))
  const builtClientDir = path.join(root, "dist", "client")
  fs.mkdirSync(builtClientDir, { recursive: true })

  const app = express()
  assert.equal(mountPublicBuiltClient(app, builtClientDir), false)
})

test("createServer with builtClientDir mounts public routes before auth wall", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-integration-"))

  // Set up mock built client
  const builtClientDir = path.join(root, "dist", "client")
  fs.mkdirSync(path.join(builtClientDir, "assets"), { recursive: true })
  fs.writeFileSync(path.join(builtClientDir, "index.html"), "<!doctype html><title>OpenCode Cost Observatory</title>")
  fs.writeFileSync(path.join(builtClientDir, "assets", "app.js"), "console.log('ready')")

  // Set up temp DB paths
  const analyticsDbPath = path.join(root, "analytics.db")
  const pricingDbPath = path.join(root, "pricing.db")
  const opencodeDbPath = path.join(root, "opencode.db")
  fs.writeFileSync(opencodeDbPath, "") // touch the raw DB file

  const app = createServer({
    port: 0,
    host: "127.0.0.1",
    dataSources: [{ label: "opencode", path: opencodeDbPath, enabled: true }],
    analyticsDbPath,
    pricingDbPath,
    dashboardToken: "test-token",
  }, { builtClientDir })

  const server = app.listen(0, "127.0.0.1")
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    // Public: built client homepage (mounted before requireDashboardToken)
    const htmlRes = await fetch(`${baseUrl}/`)
    assert.equal(htmlRes.status, 200)
    assert.match(await htmlRes.text(), /OpenCode Cost Observatory/)

    // Public: static asset
    const assetRes = await fetch(`${baseUrl}/assets/app.js`)
    assert.equal(assetRes.status, 200)
    assert.equal(await assetRes.text(), "console.log('ready')")

    // Public: health endpoint (registered before the mount too)
    const healthRes = await fetch(`${baseUrl}/health`)
    assert.equal(healthRes.status, 200)
    const healthBody = await healthRes.json() as { ok: boolean }
    assert.equal(healthBody.ok, true)

    // Public: auth session (registered before requireDashboardToken)
    const authRes = await fetch(`${baseUrl}/auth/session`)
    assert.equal(authRes.status, 200)

    // Protected: overview route (behind requireDashboardToken)
    const overviewRes = await fetch(`${baseUrl}/overview/lifetime`)
    assert.equal(overviewRes.status, 401)

    // Protected: API overview route (behind requireDashboardToken)
    const apiOverviewRes = await fetch(`${baseUrl}/api/overview/lifetime`)
    assert.equal(apiOverviewRes.status, 401)
  } finally {
    await closeServer(server)
  }
})
