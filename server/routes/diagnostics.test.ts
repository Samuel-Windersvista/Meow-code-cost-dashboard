import assert from "node:assert/strict"
import fs from "node:fs"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import express from "express"

import { rawOpencodeMessagesCursorKey } from "../services/raw-opencode"
import { bootstrapAnalyticsDb, openAnalyticsDb } from "../storage/db"
import { sync_state } from "../storage/schema.sql"
import { diagnosticsRoutes } from "./diagnostics"

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

test("diagnostics lastSyncTime reads actual raw OpenCode cursor keys", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-diagnostics-"))
  const analyticsDbPath = path.join(root, "analytics.db")
  const token = "test-token"
  const cursorTime = 1_746_493_200

  bootstrapAnalyticsDb(analyticsDbPath)
  const db = openAnalyticsDb(analyticsDbPath)
  try {
    db.insert(sync_state).values({ key: rawOpencodeMessagesCursorKey("opencode"), value: String(cursorTime) }).run()
  } finally {
    db.sqlite.close()
  }

  const app = express()
  app.use(diagnosticsRoutes(analyticsDbPath, token))
  const server = app.listen(0, "127.0.0.1")

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    assert.equal(typeof address, "object")
    assert.ok(address)
    const { port } = address as AddressInfo

    const response = await fetch(`http://127.0.0.1:${port}/backend/diagnostics`, {
      headers: { "x-dashboard-token": token },
    })
    assert.equal(response.status, 200)

    const body = await response.json() as { sync?: { lastSyncTime?: number | null } }
    assert.equal(body.sync?.lastSyncTime, cursorTime)
  } finally {
    await closeServer(server)
  }
})
