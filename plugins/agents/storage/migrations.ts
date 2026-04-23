import type { Migration } from "../../../workers/durableObject/migrations";

export const agentsMigrations: Migration[] = [
	{
		name: "1_agents_plugin_init",
		sql: `
			CREATE TABLE IF NOT EXISTS ag_agents (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				role TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				provider_id TEXT NOT NULL DEFAULT 'cloudflare',
				model_id TEXT NOT NULL DEFAULT '@cf/moonshotai/kimi-k2.5',
				system_prompt TEXT,
				trigger_json TEXT NOT NULL DEFAULT '{"events":["email_received"]}',
				guardrails_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS ag_usage (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				email_id TEXT,
				tokens_in INTEGER NOT NULL DEFAULT 0,
				tokens_out INTEGER NOT NULL DEFAULT 0,
				cost_usd REAL NOT NULL DEFAULT 0,
				action TEXT NOT NULL,
				timestamp TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX IF NOT EXISTS ag_usage_agent_idx ON ag_usage (agent_id, timestamp);
			CREATE INDEX IF NOT EXISTS ag_usage_ts_idx   ON ag_usage (timestamp);

			CREATE TABLE IF NOT EXISTS ag_reports (
				id TEXT PRIMARY KEY,
				email_address TEXT NOT NULL UNIQUE,
				summary TEXT NOT NULL DEFAULT '',
				data_json TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX IF NOT EXISTS ag_reports_email_idx ON ag_reports (email_address);

			CREATE TABLE IF NOT EXISTS ag_rate_buckets (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				window_start TEXT NOT NULL,
				count INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX IF NOT EXISTS ag_rate_agent_idx ON ag_rate_buckets (agent_id, window_start);
		`,
	},
];
