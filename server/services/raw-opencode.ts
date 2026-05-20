import BetterSqlite3 from "better-sqlite3"

type RawMessage = {
  id: string
  session_id: string
  time_created: number
  data: string
}

type RawPart = {
  id: string
  message_id: string
  session_id?: string | null
  data?: string | null
  time_created?: number | null
}

type RawProject = {
  id: string
  name?: string | null
  worktree?: string | null
  time_created?: number | null
}

type RawSession = {
  id: string
  parent_id: string | null
  directory: string | null
  title: string | null
  time_created: number
  project_id?: string | null
}

type RawAssistantMessage = {
  role?: unknown
  parentID?: unknown
  modelID?: unknown
  providerID?: unknown
  tokens?: {
    input?: unknown
    output?: unknown
    reasoning?: unknown
    total?: unknown
    cache?: {
      read?: unknown
      write?: unknown
    }
  }
}

type SqliteDatabase = InstanceType<typeof BetterSqlite3>

type AnalyticsDb = {
  sqlite: SqliteDatabase
}

export function rawOpencodeMessagesCursorKey(sourceLabel: string) {
  return `raw_opencode_messages:${sourceLabel}`
}
export function rawOpencodeSessionsCursorKey(sourceLabel: string) {
  return `raw_opencode_sessions:${sourceLabel}`
}

const DEFAULT_MESSAGE_BATCH_SIZE = 500
const MAX_MESSAGE_BATCH_SIZE = 5_000

type MessageCursor = {
  timeCreated: number
  id: string
}

type ReadAssistantMessagesOptions = {
  after?: MessageCursor
  limit?: number
  sessionId?: string
}

type PartCursor = {
  timeCreated: number
  id: string
}

type ReadPartsOptions = {
  after?: PartCursor
  limit?: number
  sessionId?: string
}

function toNumber(value: unknown) {
  const count = Number(value ?? 0)
  return Number.isFinite(count) ? count : 0
}

function normalizeBatchSize(limit?: number) {
  const requested = Math.trunc(limit ?? DEFAULT_MESSAGE_BATCH_SIZE)
  if (!Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_MESSAGE_BATCH_SIZE
  }
  return Math.min(requested, MAX_MESSAGE_BATCH_SIZE)
}

function hasTable(sqlite: SqliteDatabase, tableName: string) {
  const row = sqlite.prepare("select name from sqlite_master where type = 'table' and name = ?").get(tableName) as { name?: string } | undefined
  return row?.name === tableName
}

function getColumnNames(sqlite: SqliteDatabase, tableName: string) {
  const rows = sqlite.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function parseAssistantPayload(payload: string): RawAssistantMessage | null {
  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as RawAssistantMessage
  }
  catch {
    return null
  }
}

function parsePartPayload(payload: string | null | undefined) {
  if (typeof payload !== "string") {
    return null
  }

  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as { type?: unknown }
  }
  catch {
    return null
  }
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function deriveProjectId(session: RawSession) {
  return toOptionalString(session.project_id) ?? toOptionalString(session.directory) ?? session.id
}

function deriveDirectory(session: RawSession) {
  return toOptionalString(session.directory) ?? deriveProjectId(session)
}

function deriveTitle(session: RawSession) {
  return toOptionalString(session.title) ?? session.id
}

export function normalizeAssistantMessage(row: RawMessage) {
  const data = parseAssistantPayload(row.data)
  if (!data || data.role !== "assistant") {
    return null
  }

  return {
    messageId: row.id,
    sessionId: row.session_id,
    createdAt: row.time_created,
    parentMessageId: typeof data.parentID === "string" ? data.parentID : null,
    providerId: typeof data.providerID === "string" ? data.providerID : "unknown",
    modelId: typeof data.modelID === "string" ? data.modelID : "unknown",
    inputTokens: toNumber(data.tokens?.input),
    outputTokens: toNumber(data.tokens?.output),
    reasoningTokens: toNumber(data.tokens?.reasoning),
    cacheReadTokens: toNumber(data.tokens?.cache?.read),
    cacheWriteTokens: toNumber(data.tokens?.cache?.write),
    totalTokens: toNumber(data.tokens?.total),
  }
}

export function* iterateAssistantMessagesFromRawDb(sqlite: SqliteDatabase, options?: Omit<ReadAssistantMessagesOptions, "limit">) {
  if (!hasTable(sqlite, "message")) {
    return
  }

  const clauses: string[] = []
  const params: Array<number | string> = []

  if (options?.sessionId) {
    clauses.push("session_id = ?")
    params.push(options.sessionId)
  }

  if (options?.after) {
    clauses.push("(time_created > ? or (time_created = ? and id > ?))")
    params.push(options.after.timeCreated, options.after.timeCreated, options.after.id)
  }

  clauses.push("(data like '%\"role\":\"assistant\"%' or data like '%\"role\": \"assistant\"%')")
  const whereClause = clauses.length > 0 ? `where ${clauses.join(" and ")}` : ""
  const statement = sqlite.prepare(`
    select id, session_id, time_created, data
    from message
    ${whereClause}
    order by time_created asc, id asc
  `) as unknown as { iterate: (...params: Array<number | string>) => Iterable<RawMessage> }
  const rows = statement.iterate(...params)

  for (const row of rows) {
    const normalized = normalizeAssistantMessage(row)
    if (normalized) {
      yield normalized
    }
  }
}

export function readAssistantMessagesFromRawDb(sqlite: SqliteDatabase, options?: ReadAssistantMessagesOptions) {
  const limit = normalizeBatchSize(options?.limit)
  const results: Array<NonNullable<ReturnType<typeof normalizeAssistantMessage>>> = []

  for (const message of iterateAssistantMessagesFromRawDb(sqlite, {
    after: options?.after,
    sessionId: options?.sessionId,
  })) {
    results.push(message)
    if (results.length >= limit) {
      break
    }
  }

  return results
}

export function readSessionsFromRawDb(sqlite: SqliteDatabase) {
  if (!hasTable(sqlite, "session")) {
    return []
  }

  const columns = getColumnNames(sqlite, "session")
  const projectColumn = columns.has("project_id") ? ", project_id" : ""
  const rows = sqlite.prepare(`
    select id, parent_id, directory, title, time_created${projectColumn}
    from session
    order by time_created asc, id asc
  `).all() as RawSession[]

  return rows.map((row) => ({
    sessionId: row.id,
    parentSessionId: toOptionalString(row.parent_id),
    directory: deriveDirectory(row),
    title: deriveTitle(row),
    projectId: deriveProjectId(row),
    createdAt: row.time_created,
  }))
}

export function readPartsFromRawDb(sqlite: SqliteDatabase, options?: ReadPartsOptions) {
  if (!hasTable(sqlite, "part")) {
    return []
  }

  const columns = getColumnNames(sqlite, "part")
  const hasSessionIdColumn = columns.has("session_id")
  const sessionIdColumn = hasSessionIdColumn ? ", session_id" : ""
  const dataColumn = columns.has("data") ? ", data" : ""
  const timeCreatedColumn = columns.has("time_created") ? ", time_created" : ""

  if (options?.sessionId && !hasSessionIdColumn) {
    return []
  }

  const clauses: string[] = []
  const params: Array<number | string> = []

  if (options?.sessionId) {
    clauses.push("session_id = ?")
    params.push(options.sessionId)
  }

  const limit = normalizeBatchSize(options?.limit)
  const results: Array<{
    partId: string
    messageId: string
    sessionId: string | null
    type: string | null
    data: string | null
    createdAt: number
  }> = []
  let cursor = options?.after ?? null

  while (results.length < limit) {
    const pageClauses = [...clauses]
    const pageParams = [...params]

    if (cursor && columns.has("time_created")) {
      pageClauses.push("(time_created > ? or (time_created = ? and id > ?))")
      pageParams.push(cursor.timeCreated, cursor.timeCreated, cursor.id)
    }
    else if (cursor) {
      pageClauses.push("id > ?")
      pageParams.push(cursor.id)
    }

    const whereClause = pageClauses.length > 0 ? `where ${pageClauses.join(" and ")}` : ""
    const rows = sqlite.prepare(`
      select id, message_id${sessionIdColumn}${dataColumn}${timeCreatedColumn}
      from part
      ${whereClause}
      order by ${columns.has("time_created") ? "time_created asc, " : ""}id asc
      limit ?
    `).all(...pageParams, limit - results.length) as RawPart[]

    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      const payload = parsePartPayload(row.data)
      results.push({
        partId: row.id,
        messageId: row.message_id,
        sessionId: toOptionalString(row.session_id),
        type: typeof payload?.type === "string" && payload.type.length > 0 ? payload.type : null,
        data: typeof row.data === "string" ? row.data : null,
        createdAt: toNumber(row.time_created),
      })
    }

    const lastRow = rows.at(-1)
    if (!lastRow) {
      break
    }

    cursor = {
      timeCreated: toNumber(lastRow.time_created),
      id: lastRow.id,
    }
  }

  return results
}

export function readProjectsFromRawDb(sqlite: SqliteDatabase) {
  if (!hasTable(sqlite, "project")) {
    return []
  }

  const columns = getColumnNames(sqlite, "project")
  const nameColumn = columns.has("name") ? ", name" : ""
  const worktreeColumn = columns.has("worktree") ? ", worktree" : ""
  const timeCreatedColumn = columns.has("time_created") ? ", time_created" : ""
  const rows = sqlite.prepare(`
    select id${nameColumn}${worktreeColumn}${timeCreatedColumn}
    from project
    order by ${columns.has("time_created") ? "time_created asc, " : ""}id asc
  `).all() as RawProject[]

  return rows.map((row) => ({
    projectId: row.id,
    title: toOptionalString(row.name) ?? row.id,
    path: toOptionalString(row.worktree) ?? row.id,
    createdAt: toNumber(row.time_created),
  }))
}

export function readCursorValue(db: AnalyticsDb, key: string) {
  const row = db.sqlite.prepare("select value from sync_state where key = ?").get(key) as { value?: string } | undefined
  return typeof row?.value === "string" ? row.value : null
}

export function writeCursorValue(db: AnalyticsDb, key: string, value: string) {
  db.sqlite.prepare(`
    insert into sync_state (key, value)
    values (?, ?)
    on conflict(key) do update set value = excluded.value
  `).run(key, value)
}
