import { sql } from "drizzle-orm"
import { check, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const message_usage_fact = sqliteTable("message_usage_fact", {
  message_id: text().primaryKey(),
  source_label: text().notNull().default("opencode"),
  session_id: text().notNull(),
  project_id: text().notNull(),
  parent_message_id: text(),
  provider_id: text().notNull(),
  model_id: text().notNull(),
  time_created: integer().notNull(),
  input_tokens: integer().notNull(),
  output_tokens: integer().notNull(),
  reasoning_tokens: integer().notNull(),
  cache_read_tokens: integer().notNull(),
  cache_write_tokens: integer().notNull(),
  total_tokens: integer().notNull(),
})

export const session_tree_edge = sqliteTable("session_tree_edge", {
  session_id: text().primaryKey(),
  source_label: text().notNull().default("opencode"),
  parent_session_id: text(),
  project_id: text().notNull(),
  directory: text().notNull(),
  title: text().notNull(),
  time_created: integer().notNull(),
})

export const sync_state = sqliteTable("sync_state", {
  key: text().primaryKey(),
  value: text().notNull(),
})

export const pricing_record = sqliteTable(
  "pricing_record",
  {
    id: text().primaryKey(),
    canonical_vendor: text().notNull(),
    canonical_model: text().notNull(),
    vendor_model_id: text().notNull(),
    currency: text().notNull(),
    input_price: real().notNull(),
    output_price: real().notNull(),
    reasoning_price: real().notNull(),
    reasoning_billing_rule_json: text().notNull(),
    cache_read_price: real().notNull(),
    cache_write_price: real().notNull(),
    source_type: text().notNull(),
    source_url: text().notNull(),
    confidence: text().notNull(),
    is_manual_override: integer().notNull(),
    effective_time: integer().notNull(),
    observed_time: integer(),
    superseded_time: integer(),
    enabled: integer().notNull(),
  },
  (table) => [
    check("pricing_record_currency_usd", sql`${table.currency} = 'USD'`),
    check(
      "pricing_record_source_type_valid",
      sql`(${table.source_type} = 'manual' or ${table.source_type} = 'official' or ${table.source_type} = 'openrouter' or ${table.source_type} = 'websearch')`,
    ),
    check("pricing_record_source_url_non_blank", sql`length(trim(${table.source_url})) > 0`),
    check(
      "pricing_record_manual_override_coherent",
      sql`(${table.source_type} = 'manual' and ${table.is_manual_override} = 1) or (${table.source_type} <> 'manual' and ${table.is_manual_override} = 0)`,
    ),
  ],
)

export const pricing_source_event = sqliteTable(
  "pricing_source_event",
  {
    id: text().primaryKey(),
    pricing_record_id: text().notNull(),
    source_type: text().notNull(),
    source_url: text().notNull(),
    observed_time: integer().notNull(),
    payload_json: text(),
  },
  (table) => [
    check(
      "pricing_source_event_source_type_valid",
      sql`(${table.source_type} = 'manual' or ${table.source_type} = 'official' or ${table.source_type} = 'openrouter' or ${table.source_type} = 'websearch')`,
    ),
    check("pricing_source_event_source_url_non_blank", sql`length(trim(${table.source_url})) > 0`),
  ],
)

export const analyticsBootstrapSql = `
create table if not exists sync_state (
  key text primary key,
  value text not null
);

create table if not exists session_tree_edge (
  session_id text primary key,
  source_label text not null default 'opencode',
  parent_session_id text,
  project_id text not null,
  directory text not null,
  title text not null,
  time_created integer not null
);

create table if not exists message_usage_fact (
  message_id text primary key,
  source_label text not null default 'opencode',
  session_id text not null,
  project_id text not null,
  parent_message_id text,
  provider_id text not null,
  model_id text not null,
  time_created integer not null,
  input_tokens integer not null,
  output_tokens integer not null,
  reasoning_tokens integer not null,
  cache_read_tokens integer not null,
  cache_write_tokens integer not null,
  total_tokens integer not null
);
`

export const pricingBootstrapSql = `
create table if not exists pricing_record (
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
  constraint pricing_record_source_type_valid check(source_type = 'manual' or source_type = 'official' or source_type = 'openrouter' or source_type = 'websearch'),
  constraint pricing_record_source_url_non_blank check(length(trim(source_url)) > 0),
  constraint pricing_record_manual_override_coherent check((source_type = 'manual' and is_manual_override = 1) or (source_type <> 'manual' and is_manual_override = 0))
);

create table if not exists pricing_source_event (
  id text primary key,
  pricing_record_id text not null,
  source_type text not null,
  source_url text not null,
  observed_time integer not null,
  payload_json text,
  constraint pricing_source_event_source_type_valid check(source_type = 'manual' or source_type = 'official' or source_type = 'openrouter' or source_type = 'websearch'),
  constraint pricing_source_event_source_url_non_blank check(length(trim(source_url)) > 0)
);
`
