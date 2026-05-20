import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultDashboardConfigPath = path.join(projectRoot, "dashboard.config.json")
const defaultEnvFilePath = path.join(projectRoot, ".env")

type LoadConfigOptions = {
  dashboardConfigPath?: string
  envFilePath?: string
}

export type DataSourceConfig = {
  label: string
  path: string
  enabled: boolean
}

const dataSourceSchema = z.object({
  label: z.string().trim().min(1),
  path: z.string().trim().min(1),
  enabled: z.boolean(),
})

const fileConfigSchema = z.object({
  port: z.number().int().positive().max(65535).optional(),
  host: z.string().trim().min(1).optional(),
  opencodeDbPath: z.string().trim().min(1).optional(),
  dataSources: z.array(dataSourceSchema).optional(),
  analyticsDbPath: z.string().trim().min(1).optional(),
  pricingDbPath: z.string().trim().min(1).optional(),
  dashboardToken: z.string().trim().min(1).optional(),
  dashboardTokenFile: z.string().trim().min(1).optional(),
})

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(41777),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  DATASOURCES: z.string().trim().min(1).optional(),
  OPENCODE_DB_PATH: z.string().trim().min(1).default(path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")),
  ANALYTICS_DB_PATH: z.string().trim().min(1).default("./.run/analytics.db"),
  PRICING_DB_PATH: z.string().trim().min(1).default(path.join(os.homedir(), ".local", "share", "opencode-cost-observatory", "pricing.db")),
  DASHBOARD_TOKEN: z.string().trim().min(1).optional(),
  DASHBOARD_TOKEN_FILE: z.string().trim().min(1).optional(),
})

export type AppConfig = {
  port: number
  host: string
  dataSources: DataSourceConfig[]
  analyticsDbPath: string
  pricingDbPath: string
  dashboardToken: string
  dashboardTokenFilePath?: string
}

function resolveProjectPath(target: string) {
  return path.isAbsolute(target) ? target : path.resolve(projectRoot, target)
}

function loadDashboardFileConfig(configPath = defaultDashboardConfigPath) {
  if (!fs.existsSync(configPath)) {
    return {}
  }

  const raw = fs.readFileSync(configPath, "utf8")
  const parsed = JSON.parse(raw) as unknown
  return fileConfigSchema.parse(parsed)
}

function loadDotEnvConfig(envFilePath = defaultEnvFilePath) {
  if (!fs.existsSync(envFilePath)) {
    return {}
  }

  const parsed: Record<string, string> = {}
  const lines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (key) {
      parsed[key] = value
    }
  }

  return parsed
}

export function readDashboardTokenFile(tokenFilePath: string) {
  const raw = fs.readFileSync(tokenFilePath, "utf8").trim()

  if (!raw) {
    throw new Error(`Dashboard token file is empty: ${tokenFilePath}`)
  }

  if (raw.startsWith("{")) {
    const parsed = z.object({ token: z.string().trim().min(1) }).parse(JSON.parse(raw) as unknown)
    return parsed.token
  }

  return raw
}

export function loadConfig(
  input: Record<string, string | undefined> = process.env,
  options: LoadConfigOptions = {},
): AppConfig {
  const fileConfig = loadDashboardFileConfig(options.dashboardConfigPath ?? defaultDashboardConfigPath)
  const envFileConfig = loadDotEnvConfig(options.envFilePath ?? defaultEnvFilePath)
  const env = envSchema.parse({
    PORT: input.PORT ?? envFileConfig.PORT ?? fileConfig.port,
    HOST: input.HOST ?? envFileConfig.HOST ?? fileConfig.host,
    DATASOURCES: input.DATASOURCES ?? envFileConfig.DATASOURCES ?? undefined,
    OPENCODE_DB_PATH: input.OPENCODE_DB_PATH ?? envFileConfig.OPENCODE_DB_PATH ?? fileConfig.opencodeDbPath,
    ANALYTICS_DB_PATH: input.ANALYTICS_DB_PATH ?? envFileConfig.ANALYTICS_DB_PATH ?? fileConfig.analyticsDbPath,
    PRICING_DB_PATH: input.PRICING_DB_PATH ?? envFileConfig.PRICING_DB_PATH ?? fileConfig.pricingDbPath,
    DASHBOARD_TOKEN: input.DASHBOARD_TOKEN ?? envFileConfig.DASHBOARD_TOKEN ?? fileConfig.dashboardToken,
    DASHBOARD_TOKEN_FILE: input.DASHBOARD_TOKEN_FILE ?? envFileConfig.DASHBOARD_TOKEN_FILE ?? fileConfig.dashboardTokenFile,
  })

  // Resolve data sources with priority:
  //   1. DATASOURCES from process env (already merged above)
  //   2. dataSources from dashboard.config.json (fileConfig)
  //   3. Fallback: single source from OPENCODE_DB_PATH chain
  const dataSources: DataSourceConfig[] = (() => {
    if (env.DATASOURCES) {
      return z.array(dataSourceSchema).parse(JSON.parse(env.DATASOURCES))
    }
    if (fileConfig.dataSources && fileConfig.dataSources.length > 0) {
      return fileConfig.dataSources as DataSourceConfig[]
    }
    return [{ label: "opencode", path: resolveProjectPath(env.OPENCODE_DB_PATH), enabled: true }]
  })()

  const dashboardTokenFilePath = env.DASHBOARD_TOKEN_FILE ? resolveProjectPath(env.DASHBOARD_TOKEN_FILE) : undefined
  const dashboardToken = env.DASHBOARD_TOKEN
    ?? (dashboardTokenFilePath ? readDashboardTokenFile(dashboardTokenFilePath) : undefined)

  if (!dashboardToken) {
    throw new Error("DASHBOARD_TOKEN or DASHBOARD_TOKEN_FILE is required")
  }

  return {
    port: env.PORT,
    host: env.HOST,
    dataSources,
    analyticsDbPath: resolveProjectPath(env.ANALYTICS_DB_PATH),
    pricingDbPath: resolveProjectPath(env.PRICING_DB_PATH),
    dashboardToken,
    dashboardTokenFilePath,
  }
}

export function getDefaultDataSourcePath(config: AppConfig): string | undefined {
  const enabled = config.dataSources.filter((ds) => ds.enabled)
  return enabled.length > 0 ? enabled[0].path : undefined
}
