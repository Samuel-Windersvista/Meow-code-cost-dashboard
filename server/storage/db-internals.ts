import fs from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"

export type SqliteDatabase = InstanceType<typeof Database>

const normalizedLegacySourceUrl = "runtime-bootstrap"
const pricingSourceTypeNormalizationSql = `case
  when lower(trim(source_type)) in ('manual', 'official', 'openrouter', 'websearch') then lower(trim(source_type))
  else 'manual'
end`
const pricingSourceUrlNormalizationSql = `coalesce(nullif(trim(source_url), ''), '${normalizedLegacySourceUrl}')`
const reasoningBillingRuleRepairPredicateSql = `reasoning_billing_rule_json is null
  or trim(reasoning_billing_rule_json) = ''
  or json_valid(reasoning_billing_rule_json) = 0
  or lower(trim(coalesce(json_extract(reasoning_billing_rule_json, '$.provenance.sourceType'), ''))) not in ('manual', 'official', 'openrouter', 'websearch')
  or trim(coalesce(json_extract(reasoning_billing_rule_json, '$.provenance.sourceUrl'), '')) = ''`

export function ensureParentDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

export function configure(sqlite: SqliteDatabase, mode: "readwrite" | "readonly") {
  if (mode === "readwrite") {
    sqlite.pragma("journal_mode = WAL")
  }
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("busy_timeout = 5000")
}

type TableInfoRow = {
  name: string
  sql?: string | null
}

function hasTable(sqlite: SqliteDatabase, tableName: string) {
  const row = sqlite.prepare("select name from sqlite_master where type = 'table' and name = ?").get(tableName) as TableInfoRow | undefined
  return row?.name === tableName
}

function getColumnNames(sqlite: SqliteDatabase, tableName: string) {
  const rows = sqlite.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function getTableSql(sqlite: SqliteDatabase, tableName: string) {
  const row = sqlite.prepare("select sql from sqlite_master where type = 'table' and name = ?").get(tableName) as TableInfoRow | undefined
  return row?.sql ?? null
}

function hasUsdOnlyPricingConstraint(tableSql: string) {
  return /currency\s*=\s*'USD'/i.test(tableSql)
}

function hasManualOverrideCoherenceConstraint(tableSql: string) {
  return /manual_override_coherent/i.test(tableSql)
    || /source_type\s*=\s*'manual'.*is_manual_override\s*=\s*1/i.test(tableSql)
      && /source_type\s*<>\s*'manual'.*is_manual_override\s*=\s*0/i.test(tableSql)
}

function hasValidPricingSourceTypeConstraint(tableSql: string) {
  return /source_type_valid/i.test(tableSql)
    || /source_type\s*=\s*'manual'/i.test(tableSql)
      && /source_type\s*=\s*'official'/i.test(tableSql)
      && /source_type\s*=\s*'openrouter'/i.test(tableSql)
      && /source_type\s*=\s*'websearch'/i.test(tableSql)
}

function hasNonBlankPricingSourceUrlConstraint(tableSql: string) {
  return /source_url_non_blank/i.test(tableSql)
    || /length\s*\(\s*trim\s*\(\s*source_url\s*\)\s*\)\s*>\s*0/i.test(tableSql)
}

export function migrateAnalyticsSchema(sqlite: SqliteDatabase) {
  const analyticsTables = [
    { name: "message_usage_fact", column: "source_label" },
    { name: "session_tree_edge", column: "source_label" },
  ]
  for (const { name, column } of analyticsTables) {
    if (!hasTable(sqlite, name)) continue
    const columns = getColumnNames(sqlite, name)
    if (!columns.has(column)) {
      sqlite.exec(`alter table ${name} add column ${column} text not null default 'opencode'`)
    }
  }
}

export function normalizeLegacySyncState(sqlite: SqliteDatabase) {
  if (!hasTable(sqlite, "sync_state")) {
    return
  }

  const columns = getColumnNames(sqlite, "sync_state")
  if (columns.has("value") || !columns.has("updated_at")) {
    return
  }

  sqlite.exec(`
    begin;
    create table __opencode_cost_observatory_sync_state_migrated (
      key text primary key,
      value text not null
    );
    insert into __opencode_cost_observatory_sync_state_migrated (key, value)
    select key, cast(updated_at as text)
    from sync_state;
    drop table sync_state;
    alter table __opencode_cost_observatory_sync_state_migrated rename to sync_state;
    commit;
  `)
}

export function normalizeLegacyPricingRecord(sqlite: SqliteDatabase) {
  if (!hasTable(sqlite, "pricing_record")) {
    return
  }

  const columns = getColumnNames(sqlite, "pricing_record")
  const tableSql = getTableSql(sqlite, "pricing_record") ?? ""
  const needsRebuild = !columns.has("reasoning_billing_rule_json")
    || !hasUsdOnlyPricingConstraint(tableSql)
    || !hasValidPricingSourceTypeConstraint(tableSql)
    || !hasNonBlankPricingSourceUrlConstraint(tableSql)
    || !hasManualOverrideCoherenceConstraint(tableSql)

  if (needsRebuild) {
    const reasoningBillingRuleExpression = columns.has("reasoning_billing_rule_json")
      ? `case
          when ${reasoningBillingRuleRepairPredicateSql} then json_object(
            'kind', 'per_token',
            'provenance', json_object(
              'sourceType', ${pricingSourceTypeNormalizationSql},
              'sourceUrl', ${pricingSourceUrlNormalizationSql}
            )
          )
          else reasoning_billing_rule_json
        end`
      : `json_object(
          'kind', 'per_token',
          'provenance', json_object(
            'sourceType', ${pricingSourceTypeNormalizationSql},
            'sourceUrl', ${pricingSourceUrlNormalizationSql}
          )
        )`

    sqlite.exec(`
      begin;
      create table __opencode_cost_observatory_pricing_record_migrated (
        id text primary key,
        canonical_vendor text not null,
        canonical_model text not null,
        vendor_model_id text not null,
        currency text not null check(currency = 'USD'),
        input_price real not null,
        output_price real not null,
        reasoning_price real not null,
        reasoning_billing_rule_json text not null,
        cache_read_price real not null,
        cache_write_price real not null,
        source_type text not null,
        source_url text not null,
        confidence text not null,
        is_manual_override integer not null,
        effective_time integer not null,
        observed_time integer,
        superseded_time integer,
        enabled integer not null,
        constraint pricing_record_source_type_valid check(
          source_type = 'manual'
          or source_type = 'official'
          or source_type = 'openrouter'
          or source_type = 'websearch'
        ),
        constraint pricing_record_source_url_non_blank check(length(trim(source_url)) > 0),
        constraint pricing_record_manual_override_coherent check(
          (source_type = 'manual' and is_manual_override = 1)
          or (source_type <> 'manual' and is_manual_override = 0)
        )
      );
      insert into __opencode_cost_observatory_pricing_record_migrated (
        id, canonical_vendor, canonical_model, vendor_model_id, currency,
        input_price, output_price, reasoning_price, reasoning_billing_rule_json, cache_read_price, cache_write_price,
        source_type, source_url, confidence, is_manual_override, effective_time,
        observed_time, superseded_time, enabled
      )
      select
        id,
        canonical_vendor,
        canonical_model,
        vendor_model_id,
        'USD',
        input_price,
        output_price,
        reasoning_price,
        ${reasoningBillingRuleExpression},
        cache_read_price,
        cache_write_price,
        ${pricingSourceTypeNormalizationSql},
        ${pricingSourceUrlNormalizationSql},
        confidence,
        case when ${pricingSourceTypeNormalizationSql} = 'manual' then 1 else 0 end,
        effective_time,
        observed_time,
        superseded_time,
        enabled
      from pricing_record
      where upper(trim(currency)) = 'USD';
      drop table pricing_record;
      alter table __opencode_cost_observatory_pricing_record_migrated rename to pricing_record;
      commit;
    `)
    return
  }

  sqlite.exec(`
    update pricing_record
    set currency = 'USD'
    where upper(trim(currency)) = 'USD' and currency <> 'USD';
  `)

  sqlite.exec(`
    delete from pricing_record
    where upper(trim(currency)) <> 'USD';
  `)

  sqlite.exec(`
    update pricing_record
    set source_type = ${pricingSourceTypeNormalizationSql}
    where source_type <> ${pricingSourceTypeNormalizationSql};
  `)

  sqlite.exec(`
    update pricing_record
    set source_url = ${pricingSourceUrlNormalizationSql}
    where source_url <> ${pricingSourceUrlNormalizationSql};
  `)

  sqlite.exec(`
    update pricing_record
    set is_manual_override = case when source_type = 'manual' then 1 else 0 end
    where is_manual_override <> case when source_type = 'manual' then 1 else 0 end;
  `)

  sqlite.exec(`
    update pricing_record
    set reasoning_billing_rule_json = json_object(
      'kind', 'per_token',
      'provenance', json_object(
        'sourceType', ${pricingSourceTypeNormalizationSql},
        'sourceUrl', ${pricingSourceUrlNormalizationSql}
      )
    )
    where ${reasoningBillingRuleRepairPredicateSql};
  `)
}
