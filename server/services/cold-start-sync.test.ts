import assert from "node:assert/strict"
import fs from "node:fs"
import type { Server } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { startServer } from "../main"
import { bootstrapAnalyticsDb, openAnalyticsDb } from "../storage/db"
import { openPricingDb, openPricingReadonlyDb } from "../storage/pricing-db"
import { message_usage_fact, pricing_record, session_tree_edge, sync_state } from "../storage/schema.sql"
import { queueSyncRefresh, setSyncRefreshRunnerForTests } from "./dashboard-analytics"
import { queueColdStartAnalyticsRefresh, shouldQueueColdStartAnalyticsRefresh } from "./cold-start-sync"
import { createPricingRecordDraft } from "./pricing-registry"
import { rawOpencodeMessagesCursorKey } from "./raw-opencode"

function createPaths(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    root,
    analyticsDbPath: path.join(root, "analytics.db"),
    rawDbPath: path.join(root, "opencode.db"),
    pricingDbPath: path.join(root, "pricing.db"),
  }
}

function touch(filePath: string) {
  fs.writeFileSync(filePath, "")
}

function insertDurablePricingRecord(pricingDbPath: string) {
  const pricingDb = openPricingDb(pricingDbPath)
  try {
    pricingDb.insert(pricing_record).values(createPricingRecordDraft({
      id: "openai:gpt-5.4",
      canonicalVendor: "openai",
      canonicalModel: "gpt-5.4",
      vendorModelId: "gpt-5.4",
      currency: "USD",
      inputPrice: 2.5,
      outputPrice: 15,
      reasoningPrice: 15,
      cacheReadPrice: 0.25,
      cacheWritePrice: 0,
      sourceType: "official",
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      confidence: "high",
      isManualOverride: false,
      effectiveTime: 1_746_493_200,
      observedTime: 1_746_493_200,
      enabled: true,
    })).run()
  } finally {
    pricingDb.sqlite.close()
  }
}

function activePricingRecordCount(pricingDbPath: string) {
  const pricingDb = openPricingReadonlyDb(pricingDbPath)
  try {
    const row = pricingDb.sqlite.prepare(`
      select count(*) as total
      from pricing_record
      where enabled = 1 and superseded_time is null
    `).get() as { total: number }
    return row.total
  } finally {
    pricingDb.sqlite.close()
  }
}

function analyticsRowCounts(analyticsDbPath: string) {
  const analyticsDb = openAnalyticsDb(analyticsDbPath)
  try {
    return {
      usageRows: (analyticsDb.sqlite.prepare("select count(*) as total from message_usage_fact").get() as { total: number }).total,
      sessionRows: (analyticsDb.sqlite.prepare("select count(*) as total from session_tree_edge").get() as { total: number }).total,
    }
  } finally {
    analyticsDb.sqlite.close()
  }
}

async function waitForAssertion(assertion: () => void) {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  throw lastError
}

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

test("shouldQueueColdStartAnalyticsRefresh detects a pristine analytics cache with an existing raw OpenCode DB", () => {
  const { analyticsDbPath, rawDbPath } = createPaths("oco-cold-start-")
  bootstrapAnalyticsDb(analyticsDbPath)
  touch(rawDbPath)

  assert.equal(shouldQueueColdStartAnalyticsRefresh(analyticsDbPath, rawDbPath), true)
})

test("queueColdStartAnalyticsRefresh does not queue when a refresh was previously requested", () => {
  const { analyticsDbPath, rawDbPath } = createPaths("oco-cold-start-")
  bootstrapAnalyticsDb(analyticsDbPath)
  touch(rawDbPath)

  const db = openAnalyticsDb(analyticsDbPath)
  try {
    db.insert(sync_state).values({ key: "sync_requested_at", value: "1746493200" }).run()
  } finally {
    db.sqlite.close()
  }

  let queued = 0
  setSyncRefreshRunnerForTests(() => {
    queued += 1
    return { sessionsSynced: 0, messagesSynced: 0, syncedAt: 1_746_493_200 }
  })
  try {
    assert.equal(shouldQueueColdStartAnalyticsRefresh(analyticsDbPath, rawDbPath), false)
    assert.equal(queueColdStartAnalyticsRefresh(analyticsDbPath, rawDbPath), null)
    assert.equal(queued, 0)
  } finally {
    setSyncRefreshRunnerForTests(null)
  }
})

test("shouldQueueColdStartAnalyticsRefresh treats prior completed status as sync evidence", () => {
  const { analyticsDbPath, rawDbPath } = createPaths("oco-cold-start-")
  bootstrapAnalyticsDb(analyticsDbPath)
  touch(rawDbPath)

  const db = openAnalyticsDb(analyticsDbPath)
  try {
    db.insert(sync_state).values({ key: "last_refresh_status", value: "completed" }).run()
  } finally {
    db.sqlite.close()
  }

  assert.equal(shouldQueueColdStartAnalyticsRefresh(analyticsDbPath, rawDbPath), false)
})

test("shouldQueueColdStartAnalyticsRefresh treats actual raw OpenCode cursor keys as sync evidence", () => {
  const { analyticsDbPath, rawDbPath } = createPaths("oco-cold-start-")
  bootstrapAnalyticsDb(analyticsDbPath)
  touch(rawDbPath)

  const db = openAnalyticsDb(analyticsDbPath)
  try {
    db.insert(sync_state).values({ key: rawOpencodeMessagesCursorKey("opencode"), value: "1746493200" }).run()
  } finally {
    db.sqlite.close()
  }

  assert.equal(shouldQueueColdStartAnalyticsRefresh(analyticsDbPath, rawDbPath), false)
})

test("startServer queues one cold-start refresh after the backend is listening", async () => {
  const { analyticsDbPath, rawDbPath, pricingDbPath } = createPaths("oco-cold-start-")
  touch(rawDbPath)
  let queued = 0
  let server: Server | undefined

  setSyncRefreshRunnerForTests(() => {
    assert.equal(server?.listening, true)
    queued += 1
    return { sessionsSynced: 0, messagesSynced: 0, syncedAt: 1_746_493_200 }
  })

  try {
    server = await startServer({
      port: 0,
      host: "127.0.0.1",
      dataSources: [{ label: "opencode", path: rawDbPath, enabled: true }],
      analyticsDbPath,
      pricingDbPath,
      dashboardToken: "test-token",
    })

    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(queued, 1)
  } finally {
    setSyncRefreshRunnerForTests(null)
    if (server) {
      await closeServer(server)
    }
  }
})

test("startServer rebuilds a missing analytics cache without replacing durable pricing", async () => {
  const { analyticsDbPath, rawDbPath, pricingDbPath } = createPaths("oco-cold-start-durable-")
  touch(rawDbPath)
  insertDurablePricingRecord(pricingDbPath)
  let queued = 0
  let server: Server | undefined

  setSyncRefreshRunnerForTests((_rawDatabasePath, analyticsDatabasePath) => {
    queued += 1
    assert.equal(activePricingRecordCount(pricingDbPath), 1)

    const analyticsDb = openAnalyticsDb(analyticsDatabasePath)
    try {
      analyticsDb.insert(session_tree_edge).values({
        session_id: "session-1",
        parent_session_id: null,
        project_id: "project-1",
        directory: "D:/BB84.ai",
        title: "Task 6 regression",
        time_created: 1_746_493_200,
      }).run()
      analyticsDb.insert(message_usage_fact).values({
        message_id: "message-1",
        session_id: "session-1",
        project_id: "project-1",
        parent_message_id: null,
        provider_id: "openai",
        model_id: "gpt-5.4",
        time_created: 1_746_493_200,
        input_tokens: 100,
        output_tokens: 50,
        reasoning_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        total_tokens: 150,
      }).run()
    } finally {
      analyticsDb.sqlite.close()
    }

    return { sessionsSynced: 1, messagesSynced: 1, syncedAt: 1_746_493_200 }
  })

  try {
    server = await startServer({
      port: 0,
      host: "127.0.0.1",
      dataSources: [{ label: "opencode", path: rawDbPath, enabled: true }],
      analyticsDbPath,
      pricingDbPath,
      dashboardToken: "test-token",
    })

    await waitForAssertion(() => {
      assert.equal(queued, 1)
      assert.deepEqual(analyticsRowCounts(analyticsDbPath), { usageRows: 1, sessionRows: 1 })
      assert.equal(activePricingRecordCount(pricingDbPath), 1)
    })
  } finally {
    setSyncRefreshRunnerForTests(null)
    if (server) {
      await closeServer(server)
    }
  }
})

test("shouldQueueColdStartAnalyticsRefresh skips when another sync job is already active", () => {
  const { analyticsDbPath, rawDbPath } = createPaths("oco-cold-start-")
  bootstrapAnalyticsDb(analyticsDbPath)
  touch(rawDbPath)

  setSyncRefreshRunnerForTests(() => new Promise(() => {}))
  try {
    queueSyncRefresh(analyticsDbPath, rawDbPath, "opencode", 1_746_493_200)
    assert.equal(shouldQueueColdStartAnalyticsRefresh(analyticsDbPath, rawDbPath), false)
  } finally {
    setSyncRefreshRunnerForTests(null)
  }
})
