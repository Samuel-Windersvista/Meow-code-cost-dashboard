import fs from "node:fs"

import { syncRawOpencodeToAnalytics } from "./services/dashboard-analytics"

type SyncWorkerPayload = {
  rawDatabasePath: string
  analyticsDatabasePath: string
  sourceLabel: string
  now: number
  resultPath: string
  errorPath: string
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.stack || error.message : String(error)
}

function main() {
  const payloadPath = process.argv[2]
  if (!payloadPath) {
    throw new Error("missing_sync_worker_payload")
  }

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8")) as SyncWorkerPayload
  try {
    const result = syncRawOpencodeToAnalytics(payload.rawDatabasePath, payload.analyticsDatabasePath, payload.sourceLabel, payload.now)
    fs.writeFileSync(payload.resultPath, JSON.stringify(result), "utf8")
  } catch (error) {
    fs.writeFileSync(payload.errorPath, errorMessage(error), "utf8")
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error(errorMessage(error))
  process.exit(1)
}
