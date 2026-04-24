/**
 * REST API for the Agents plugin.
 * Mounted at: /api/plugins/agents/
 * All routes require a mailbox context (stub + sql).
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { MailboxContext } from "../../../workers/lib/mailbox";
import {
	listAgents,
	getAgent,
	createAgent,
	updateAgent,
	deleteAgent,
	getUsageSummary,
	getSenderReport,
	listSenderReports,
} from "../storage/repo";
import type { Agent, CreateAgentRequest, UpdateAgentRequest, TriggerPolicy } from "../types";
import { DEFAULT_GUARDRAILS } from "../types";
import { ROLE_DESCRIPTIONS, ROLE_DEFAULT_TRIGGERS } from "../domain/roles";

const VALID_ROLES = [
	"router", "responder", "researcher", "summarizer",
	"spam_guard", "marketing", "support", "scheduler", "custom",
] as const;

const CreateAgentSchema = z.object({
	name: z.string().min(1).max(80),
	role: z.enum(VALID_ROLES),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	enabled: z.boolean().optional(),
	systemPrompt: z.string().max(8000).nullable().optional(),
	trigger: z.object({
		events: z.array(z.enum(["email_received", "email_opened", "scheduled", "manual"])),
		senderFilter: z.array(z.string()).optional(),
		subjectKeywords: z.array(z.string()).optional(),
	}).optional(),
	guardrails: z.object({
		maxEmailsPerHour: z.number().int().min(1).max(1000).optional(),
		dailyTokenBudget: z.number().int().min(1).optional(),
	}).optional(),
});

async function getSql(c: Context<MailboxContext>): Promise<SqlStorage> {
	const stub = c.var.mailboxStub;
	return stub.getSql();
}

export function registerAgentsRoutes(app: Hono<MailboxContext>): void {
	// ── Agent CRUD ────────────────────────────────────────────────

	// GET /api/plugins/agents/ — list all agents  
	app.get("/", async (c) => {
		const sql = await getSql(c);
		const agents = listAgents(sql);
		// Attach role metadata
		const agents_with_meta = agents.map((a) => ({
			...a,
			roleMeta: ROLE_DESCRIPTIONS[a.role],
		}));
		return c.json({ agents: agents_with_meta });
	});

	// GET /api/plugins/agents/roles — list all available roles
	app.get("/roles", (c) => {
		const roles = Object.entries(ROLE_DESCRIPTIONS).map(([id, meta]) => ({
			id,
			...meta,
			defaultTriggers: ROLE_DEFAULT_TRIGGERS[id as keyof typeof ROLE_DEFAULT_TRIGGERS],
		}));
		return c.json({ roles });
	});

	// ── Sender reports (must be before /:agentId to avoid shadowing) ────

	// GET /api/plugins/agents/reports — list recent sender reports
	app.get("/reports", async (c) => {
		const limit = Number(c.req.query("limit") ?? 20);
		const sql = await getSql(c);
		const reports = listSenderReports(sql, limit);
		return c.json({ reports });
	});

	// GET /api/plugins/agents/reports/:emailAddress
	app.get("/reports/:emailAddress", async (c) => {
		const emailAddress = decodeURIComponent(c.req.param("emailAddress"));
		const sql = await getSql(c);
		const report = getSenderReport(sql, emailAddress);
		if (!report) return c.json({ error: "No report found for this sender" }, 404);
		return c.json({ report });
	});

	// GET /api/plugins/agents/:agentId
	app.get("/:agentId", async (c) => {
		const agentId = c.req.param("agentId");
		const sql = await getSql(c);
		const agent = getAgent(sql, agentId);
		if (!agent) return c.json({ error: "Agent not found" }, 404);
		return c.json({ agent });
	});

	// POST /api/plugins/agents/ — create agent
	app.post("/", async (c) => {
		const raw = await c.req.json();
		const parsed = CreateAgentSchema.safeParse(raw);
		if (!parsed.success) {
			return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
		}
		const body = parsed.data;
		const sql = await getSql(c);
		const now = new Date().toISOString();
		const agent: Agent = {
			id: crypto.randomUUID(),
			name: body.name,
			role: body.role,
			enabled: body.enabled ?? true,
			providerId: body.providerId,
			modelId: body.modelId,
			systemPrompt: body.systemPrompt ?? null,
			trigger: (body.trigger ?? {
				events: ROLE_DEFAULT_TRIGGERS[body.role],
				senderFilter: [],
				subjectKeywords: [],
			}) as TriggerPolicy,
			guardrails: { ...DEFAULT_GUARDRAILS, ...(body.guardrails ?? {}) },
			createdAt: now,
			updatedAt: now,
		};
		createAgent(sql, agent);
		return c.json({ agent }, 201);
	});

	// PUT /api/plugins/agents/:agentId — update agent
	app.put("/:agentId", async (c) => {
		const agentId = c.req.param("agentId");
		const body = await c.req.json<UpdateAgentRequest>();
		const sql = await getSql(c);
		const updated = updateAgent(sql, agentId, body as Partial<Agent>);
		if (!updated) return c.json({ error: "Agent not found" }, 404);
		return c.json({ agent: updated });
	});

	// DELETE /api/plugins/agents/:agentId
	app.delete("/:agentId", async (c) => {
		const agentId = c.req.param("agentId");
		const sql = await getSql(c);
		const deleted = deleteAgent(sql, agentId);
		if (!deleted) return c.json({ error: "Agent not found" }, 404);
		return c.json({ ok: true });
	});

	// ── Usage stats ───────────────────────────────────────────────

	// GET /api/plugins/agents/:agentId/usage?days=7
	app.get("/:agentId/usage", async (c) => {
		const agentId = c.req.param("agentId");
		const days = Number(c.req.query("days") ?? 7);
		const sql = await getSql(c);
		const summary = getUsageSummary(sql, agentId, days);
		return c.json({ summary });
	});

}
