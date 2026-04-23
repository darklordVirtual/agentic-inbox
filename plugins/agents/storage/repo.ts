/**
 * Repository — agent CRUD + usage tracking + rate limiting.
 */

import type { Agent, AgentUsageRecord, SenderReport, AgentGuardrails, TriggerPolicy } from "../types";
import { DEFAULT_GUARDRAILS } from "../types";

/** Alias for the SQL row type accepted by SqlStorage.exec<T>. */
type SqlRow = Record<string, SqlStorageValue>;

// ── Agents ────────────────────────────────────────────────────────

export function dbToAgent(row: SqlRow): Agent {
	return {
		id: row.id as string,
		name: row.name as string,
		role: row.role as Agent["role"],
		enabled: Number(row.enabled) === 1,
		providerId: row.provider_id as string,
		modelId: row.model_id as string,
		systemPrompt: (row.system_prompt as string | null) ?? null,
		trigger: JSON.parse((row.trigger_json as string | null) ?? '{"events":["email_received"]}') as TriggerPolicy,
		guardrails: { ...DEFAULT_GUARDRAILS, ...JSON.parse((row.guardrails_json as string | null) ?? "{}") } as AgentGuardrails,
		createdAt: row.created_at as string,
		updatedAt: row.updated_at as string,
	};
}

export function listAgents(sql: SqlStorage): Agent[] {
	const rows = [...sql.exec<SqlRow>("SELECT * FROM ag_agents ORDER BY created_at")];
	return rows.map(dbToAgent);
}

export function getAgent(sql: SqlStorage, id: string): Agent | null {
	const rows = [...sql.exec<SqlRow>("SELECT * FROM ag_agents WHERE id = ?", id)];
	return rows.length > 0 ? dbToAgent(rows[0]) : null;
}

export function createAgent(sql: SqlStorage, agent: Agent): void {
	sql.exec(
		`INSERT INTO ag_agents (id, name, role, enabled, provider_id, model_id, system_prompt, trigger_json, guardrails_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		agent.id,
		agent.name,
		agent.role,
		agent.enabled ? 1 : 0,
		agent.providerId,
		agent.modelId,
		agent.systemPrompt,
		JSON.stringify(agent.trigger),
		JSON.stringify(agent.guardrails),
		agent.createdAt,
		agent.updatedAt,
	);
}

export function updateAgent(sql: SqlStorage, id: string, patch: Partial<Agent>): Agent | null {
	const existing = getAgent(sql, id);
	if (!existing) return null;
	const merged: Agent = {
		...existing,
		...patch,
		trigger: patch.trigger ? { ...existing.trigger, ...patch.trigger } : existing.trigger,
		guardrails: patch.guardrails ? { ...existing.guardrails, ...patch.guardrails } : existing.guardrails,
		updatedAt: new Date().toISOString(),
	};
	sql.exec(
		`UPDATE ag_agents SET name=?, role=?, enabled=?, provider_id=?, model_id=?, system_prompt=?, trigger_json=?, guardrails_json=?, updated_at=? WHERE id=?`,
		merged.name,
		merged.role,
		merged.enabled ? 1 : 0,
		merged.providerId,
		merged.modelId,
		merged.systemPrompt,
		JSON.stringify(merged.trigger),
		JSON.stringify(merged.guardrails),
		merged.updatedAt,
		id,
	);
	return merged;
}

export function deleteAgent(sql: SqlStorage, id: string): boolean {
	const rows = [...sql.exec<SqlRow>("SELECT id FROM ag_agents WHERE id = ?", id)];
	if (rows.length === 0) return false;
	sql.exec("DELETE FROM ag_agents WHERE id = ?", id);
	return true;
}

// ── Usage tracking ────────────────────────────────────────────────

export function recordUsage(sql: SqlStorage, usage: AgentUsageRecord): void {
	sql.exec(
		`INSERT INTO ag_usage (id, agent_id, email_id, tokens_in, tokens_out, cost_usd, action, timestamp)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		usage.id,
		usage.agentId,
		usage.emailId,
		usage.tokensIn,
		usage.tokensOut,
		usage.costUsd,
		usage.action,
		usage.timestamp,
	);
}

export function getUsageSummary(sql: SqlStorage, agentId: string, sinceDays = 7): {
	totalRuns: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalCostUsd: number;
} {
	const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
	const rows = [...sql.exec<SqlRow>(
		`SELECT COUNT(*) as runs, SUM(tokens_in) as tin, SUM(tokens_out) as tout, SUM(cost_usd) as cost
		 FROM ag_usage WHERE agent_id = ? AND timestamp >= ?`,
		agentId,
		since,
	)];
	const r = rows[0] ?? {};
	return {
		totalRuns:       Number(r.runs  ?? 0),
		totalTokensIn:   Number(r.tin   ?? 0),
		totalTokensOut:  Number(r.tout  ?? 0),
		totalCostUsd:    Number(r.cost  ?? 0),
	};
}

/** Sum of tokens used across ALL agents today (for budget enforcement). */
export function getDailyTokensUsed(sql: SqlStorage, agentId: string): number {
	const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	const rows = [...sql.exec<SqlRow>(
		`SELECT SUM(tokens_in + tokens_out) as total FROM ag_usage WHERE agent_id = ? AND timestamp >= ?`,
		agentId,
		today,
	)];
	return Number(rows[0]?.total ?? 0);
}

// ── Rate limiting ─────────────────────────────────────────────────

/**
 * Check and increment rate bucket for hourly limit.
 * Returns true if allowed, false if rate limit exceeded.
 */
export function checkAndIncrementRate(sql: SqlStorage, agentId: string, maxPerHour: number): boolean {
	const now = new Date();
	const windowStart = new Date(now);
	windowStart.setMinutes(0, 0, 0);
	const windowKey = `${agentId}:${windowStart.toISOString()}`;

	const existing = [...sql.exec<SqlRow>(
		"SELECT count FROM ag_rate_buckets WHERE id = ?",
		windowKey,
	)];

	if (existing.length === 0) {
		sql.exec(
			"INSERT INTO ag_rate_buckets (id, agent_id, window_start, count) VALUES (?, ?, ?, 1)",
			windowKey, agentId, windowStart.toISOString(),
		);
		// Also clean up old buckets (>48h)
		const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
		sql.exec("DELETE FROM ag_rate_buckets WHERE window_start < ?", cutoff);
		return true;
	}

	const count = Number(existing[0].count ?? 0);
	if (count >= maxPerHour) return false;

	sql.exec("UPDATE ag_rate_buckets SET count = count + 1 WHERE id = ?", windowKey);
	return true;
}

// ── Sender reports ────────────────────────────────────────────────

export function getSenderReport(sql: SqlStorage, emailAddress: string): SenderReport | null {
	const rows = [...sql.exec<SqlRow>(
		"SELECT * FROM ag_reports WHERE email_address = ?",
		emailAddress,
	)];
	if (rows.length === 0) return null;
	const r = rows[0];
	return {
		id: r.id as string,
		emailAddress: r.email_address as string,
		summary: r.summary as string,
		data: JSON.parse((r.data_json as string | null) ?? "{}"),
		lastSeenAt: (r.last_seen_at as string | null) ?? undefined,
		emailCount: (r.email_count as number | null) ?? undefined,
		createdAt: r.created_at as string,
		updatedAt: r.updated_at as string,
	};
}

export function upsertSenderReport(sql: SqlStorage, report: SenderReport): void {
	sql.exec(
		`INSERT INTO ag_reports (id, email_address, summary, data_json, last_seen_at, email_count, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(email_address) DO UPDATE SET
		   summary=excluded.summary, data_json=excluded.data_json,
		   last_seen_at=excluded.last_seen_at, email_count=excluded.email_count,
		   updated_at=excluded.updated_at`,
		report.id,
		report.emailAddress,
		report.summary,
		JSON.stringify(report.data),
		report.lastSeenAt ?? null,
		report.emailCount ?? null,
		report.createdAt,
		report.updatedAt,
	);
}

export function listSenderReports(sql: SqlStorage, limit = 50): SenderReport[] {
	const rows = [...sql.exec<SqlRow>(
		"SELECT * FROM ag_reports ORDER BY updated_at DESC LIMIT ?",
		limit,
	)];
	return rows.map((r) => ({
		id: r.id as string,
		emailAddress: r.email_address as string,
		summary: r.summary as string,
		data: JSON.parse((r.data_json as string | null) ?? "{}"),
		lastSeenAt: (r.last_seen_at as string | null) ?? undefined,
		emailCount: (r.email_count as number | null) ?? undefined,
		createdAt: r.created_at as string,
		updatedAt: r.updated_at as string,
	}));
}

