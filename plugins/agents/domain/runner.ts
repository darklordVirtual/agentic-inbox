/**
 * Agent runner — executes one agent against an incoming email event.
 *
 * Role dispatch:
 *   spam_guard  → lightweight classification (block / allow)
 *   router      → intent analysis, routes to next agent type
 *   researcher  → builds sender identity report
 *   responder / support / marketing / scheduler / custom → drafts (or sends) reply
 *   summarizer  → generates thread summary and stores it in brain
 */

import { generateText } from "ai";
import type { Agent, AgentUsageRecord, SenderReport } from "../types";
import { ROLE_PROMPTS } from "./roles";
import { checkGuardrails, incrementRate } from "./guardrails";
import { recordUsage, upsertSenderReport, getSenderReport } from "../storage/repo";
import { createLanguageModel, getProviderKey, getModel } from "../../../workers/lib/providers";
import { estimateCost } from "./guardrails";
import { isPromptInjection, stripModelArtifacts } from "../../../workers/lib/ai";
import { isNoReplyAddress } from "../../../workers/lib/tools";
import type { Env } from "../../../workers/types";
import type { OnEmailReceivedPayload } from "../../../workers/plugins/types";
import { getMailboxStub, buildQuotedReplyBlock, textToHtml } from "../../../workers/lib/email-helpers";
import { sendEmail } from "../../../workers/email-sender";

// ── Result types ──────────────────────────────────────────────────

export type AgentRunResult =
	| { outcome: "skipped"; reason: string }
	| { outcome: "spam_blocked"; confidence: number; reason: string }
	| { outcome: "drafted"; draftId: string }
	| { outcome: "sent"; messageId: string }
	| { outcome: "summarized"; summary: string }
	| { outcome: "researched"; emailAddress: string }
	| { outcome: "routed"; intent: string; suggestedAgent: string }
	| { outcome: "error"; message: string };

// ── Main dispatch ─────────────────────────────────────────────────

export async function runAgent(
	agent: Agent,
	payload: OnEmailReceivedPayload,
	mailboxId: string,
	sql: SqlStorage,
	env: Cloudflare.Env,
	routerContext?: { intent: string; suggestedAgent: string },
): Promise<AgentRunResult> {
	// ── 1. Trigger filter ─────────────────────────────────────────
	if (!matchesTrigger(agent, payload)) {
		return { outcome: "skipped", reason: "Trigger filter did not match" };
	}

	// ── 2. Prompt injection check ─────────────────────────────────
	const isInjection = await isPromptInjection(env.AI, payload.body);
	if (isInjection) {
		return { outcome: "skipped", reason: "Prompt injection detected — agent skipped for safety" };
	}

	// ── 3. Guardrails ─────────────────────────────────────────────
	const guardResult = await checkGuardrails(sql, agent.id, agent.guardrails, payload.sender, agent.role);
	if (!guardResult.allowed) {
		return { outcome: "skipped", reason: guardResult.reason ?? "Guardrail check failed" };
	}

	// ── 4. Language model ─────────────────────────────────────────
	let apiKey: string | null = null;
	if (agent.providerId !== "cloudflare") {
		apiKey = await getProviderKey(env as unknown as Env, mailboxId, agent.providerId);
	}
	const model = createLanguageModel(agent.providerId, agent.modelId, apiKey, env as unknown as Env);
	const modelDef = getModel(agent.providerId, agent.modelId);

	// ── 5. Role dispatch ──────────────────────────────────────────
	let result: AgentRunResult;
	try {
		switch (agent.role) {
			case "spam_guard":
				result = await runSpamGuard(agent, payload, model, sql, env, mailboxId, modelDef);
				break;
			case "router":
				result = await runRouter(agent, payload, model, sql, env, mailboxId, modelDef);
				break;
			case "researcher":
				result = await runResearcher(agent, payload, model, sql, env, mailboxId, modelDef);
				break;
			case "summarizer":
				result = await runSummarizer(agent, payload, model, sql, env, mailboxId, modelDef);
				break;
			case "responder":
			case "support":
			case "marketing":
			case "scheduler":
			case "custom":
				result = await runResponder(agent, payload, model, sql, env, mailboxId, modelDef, routerContext);
				break;
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { outcome: "error", message: msg };
	}

	// Increment rate only after a successful (non-error) run
	if (result!.outcome !== "error") {
		incrementRate(sql, agent.id);
	}
	return result!;
}

// ── Trigger matching ──────────────────────────────────────────────

function matchesTrigger(agent: Agent, payload: OnEmailReceivedPayload): boolean {
	// Sender filter (glob: *@domain.com or exact address)
	if (agent.trigger.senderFilter && agent.trigger.senderFilter.length > 0) {
		const matched = agent.trigger.senderFilter.some((pattern) =>
			matchGlob(pattern, payload.sender),
		);
		if (!matched) return false;
	}

	// Subject keyword filter
	if (agent.trigger.subjectKeywords && agent.trigger.subjectKeywords.length > 0) {
		const subjectLower = payload.subject.toLowerCase();
		const matched = agent.trigger.subjectKeywords.some((kw) =>
			subjectLower.includes(kw.toLowerCase()),
		);
		if (!matched) return false;
	}

	return true;
}

function matchGlob(pattern: string, value: string): boolean {
	if (pattern.startsWith("*@")) {
		const domain = pattern.slice(2).toLowerCase();
		return value.toLowerCase().endsWith(`@${domain}`);
	}
	return pattern.toLowerCase() === value.toLowerCase();
}

// ── Usage helper ──────────────────────────────────────────────────

function logUsage(
	sql: SqlStorage,
	agent: Agent,
	emailId: string,
	tokensIn: number,
	tokensOut: number,
	action: AgentUsageRecord["action"],
	modelDef?: ReturnType<typeof getModel>,
): void {
	const cost = estimateCost(tokensIn, tokensOut, modelDef?.costPer1MInput, modelDef?.costPer1MOutput);
	const record: AgentUsageRecord = {
		id: crypto.randomUUID(),
		agentId: agent.id,
		emailId,
		tokensIn,
		tokensOut,
		costUsd: cost,
		action,
		timestamp: new Date().toISOString(),
	};
	recordUsage(sql, record);
}

// ── Spam Guard ────────────────────────────────────────────────────

async function runSpamGuard(
	agent: Agent,
	payload: OnEmailReceivedPayload,
	model: ReturnType<typeof createLanguageModel>,
	sql: SqlStorage,
	_env: Cloudflare.Env,
	_mailboxId: string,
	modelDef?: ReturnType<typeof getModel>,
): Promise<AgentRunResult> {
	const systemPrompt = agent.systemPrompt ?? ROLE_PROMPTS.spam_guard;
	const userContent = `From: ${payload.sender}\nSubject: ${payload.subject}\n\n${(payload.body ?? "").slice(0, 3000)}`;

	const { text, usage } = await generateText({
		model,
		system: systemPrompt,
		prompt: userContent,
		maxOutputTokens: 200,
		temperature: 0,
	});

	logUsage(sql, agent, payload.emailId, usage.inputTokens ?? 0, usage.outputTokens ?? 0, "classified", modelDef);

	const cleaned = stripModelArtifacts(text.trim());
	try {
		const parsed = JSON.parse(cleaned) as { classification: string; confidence: number; signals: string[]; block: boolean };
		if (parsed.block) {
			return {
				outcome: "spam_blocked",
				confidence: parsed.confidence ?? 0,
				reason: parsed.signals?.join("; ") ?? "Classified as spam",
			};
		}
		return { outcome: "skipped", reason: `Spam guard passed: ${parsed.classification}` };
	} catch {
		// Non-JSON response — consider it passing
		return { outcome: "skipped", reason: "Spam guard completed (unstructured response)" };
	}
}

// ── Router ────────────────────────────────────────────────────────

async function runRouter(
	agent: Agent,
	payload: OnEmailReceivedPayload,
	model: ReturnType<typeof createLanguageModel>,
	sql: SqlStorage,
	_env: Cloudflare.Env,
	_mailboxId: string,
	modelDef?: ReturnType<typeof getModel>,
): Promise<AgentRunResult> {
	const systemPrompt = agent.systemPrompt ?? ROLE_PROMPTS.router;
	const userContent = `From: ${payload.sender}\nSubject: ${payload.subject}\n\n${(payload.body ?? "").slice(0, 4000)}`;

	const { text, usage } = await generateText({
		model,
		system: systemPrompt,
		prompt: userContent,
		maxOutputTokens: 300,
		temperature: 0,
	});

	logUsage(sql, agent, payload.emailId, usage.inputTokens ?? 0, usage.outputTokens ?? 0, "classified", modelDef);

	const cleaned = stripModelArtifacts(text.trim());
	try {
		const parsed = JSON.parse(cleaned) as { intent: string; suggestedAgent: string };
		return {
			outcome: "routed",
			intent: parsed.intent ?? "unknown",
			suggestedAgent: parsed.suggestedAgent ?? "human",
		};
	} catch {
		return { outcome: "routed", intent: "unknown", suggestedAgent: "human" };
	}
}

// ── Researcher ────────────────────────────────────────────────────

async function runResearcher(
	agent: Agent,
	payload: OnEmailReceivedPayload,
	model: ReturnType<typeof createLanguageModel>,
	sql: SqlStorage,
	env: Cloudflare.Env,
	mailboxId: string,
	modelDef?: ReturnType<typeof getModel>,
): Promise<AgentRunResult> {
	const existingReport = getSenderReport(sql, payload.sender);
	const stub = getMailboxStub(env as unknown as Env, mailboxId);

	// Search for prior emails from this sender
	const history = await (stub as unknown as { searchEmails: (o: Record<string, unknown>) => Promise<unknown> })
		.searchEmails({ query: `from:${payload.sender}`, folder: "inbox" })
		.catch(() => null);

	const historyText = history ? JSON.stringify(history).slice(0, 2000) : "No prior history found.";
	const existingContext = existingReport
		? `Existing profile (update with new info):\n${existingReport.summary}\n${JSON.stringify(existingReport.data)}`
		: "No existing profile.";

	const systemPrompt = agent.systemPrompt ?? ROLE_PROMPTS.researcher;
	const userContent = `New email received:
From: ${payload.sender}
Subject: ${payload.subject}
Date: ${payload.date}
Body: ${(payload.body ?? "").slice(0, 2000)}

${existingContext}

Prior email history (last results):
${historyText}

Build a concise identity report as JSON:
{
  "summary": "one paragraph about this sender",
  "data": {
    "name": "...",
    "organization": "...",
    "role": "...",
    "location": "...",
    "communicationStyle": "...",
    "topics": ["..."],
    "relationshipValue": "key_customer|regular_contact|vendor|cold_contact|unknown"
  }
}`;

	const { text, usage } = await generateText({
		model,
		system: systemPrompt,
		prompt: userContent,
		maxOutputTokens: 600,
		temperature: 0.2,
	});

	logUsage(sql, agent, payload.emailId, usage.inputTokens ?? 0, usage.outputTokens ?? 0, "researched", modelDef);

	const cleaned = stripModelArtifacts(text.trim());
	try {
		const parsed = JSON.parse(cleaned) as { summary: string; data: SenderReport["data"] };
		const report: SenderReport = {
			id: existingReport?.id ?? crypto.randomUUID(),
			emailAddress: payload.sender,
			summary: parsed.summary,
			data: parsed.data ?? {},
			lastSeenAt: payload.date,
			emailCount: (existingReport?.emailCount ?? 0) + 1,
			createdAt: existingReport?.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		upsertSenderReport(sql, report);
	} catch {
		// Best effort — store raw summary if JSON fails
		const report: SenderReport = {
			id: existingReport?.id ?? crypto.randomUUID(),
			emailAddress: payload.sender,
			summary: cleaned.slice(0, 500),
			data: {},
			lastSeenAt: payload.date,
			emailCount: (existingReport?.emailCount ?? 0) + 1,
			createdAt: existingReport?.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		upsertSenderReport(sql, report);
	}

	return { outcome: "researched", emailAddress: payload.sender };
}

// ── Summarizer ────────────────────────────────────────────────────

async function runSummarizer(
	agent: Agent,
	payload: OnEmailReceivedPayload,
	model: ReturnType<typeof createLanguageModel>,
	sql: SqlStorage,
	env: Cloudflare.Env,
	mailboxId: string,
	modelDef?: ReturnType<typeof getModel>,
): Promise<AgentRunResult> {
	const stub = getMailboxStub(env as unknown as Env, mailboxId);
	const emailFull = await (stub as unknown as { getEmailById: (id: string) => Promise<{threadId?: string | null} | null> }).getEmailById(payload.emailId).catch(() => null);
	const threadId = emailFull?.threadId;
	let threadContent = `Subject: ${payload.subject}\nFrom: ${payload.sender}\n\n${(payload.body ?? "").slice(0, 6000)}`;

	if (threadId) {
		const thread = await (stub as unknown as { getThread: (id: string) => Promise<unknown> }).getThread(threadId).catch(() => null);
		if (thread) {
			threadContent = JSON.stringify(thread).slice(0, 8000);
		}
	}

	const systemPrompt = agent.systemPrompt ?? ROLE_PROMPTS.summarizer;

	const { text, usage } = await generateText({
		model,
		system: systemPrompt,
		prompt: `Summarize this email thread:\n\n${threadContent}`,
		maxOutputTokens: 400,
		temperature: 0.3,
	});

	logUsage(sql, agent, payload.emailId, usage.inputTokens ?? 0, usage.outputTokens ?? 0, "summarized", modelDef);

	const summary = stripModelArtifacts(text.trim());

	// Store in brain memory
	try {
		await stub.brainRemember("email_summary", payload.emailId, summary, 30);
	} catch {
		// Non-fatal — just proceed
	}

	return { outcome: "summarized", summary };
}

// ── Responder (also covers support / marketing / scheduler / custom) ──

async function runResponder(
	agent: Agent,
	payload: OnEmailReceivedPayload,
	model: ReturnType<typeof createLanguageModel>,
	sql: SqlStorage,
	env: Cloudflare.Env,
	mailboxId: string,
	modelDef?: ReturnType<typeof getModel>,
	routerContext?: { intent: string; suggestedAgent: string },
): Promise<AgentRunResult> {
	if (isNoReplyAddress(payload.sender)) {
		return { outcome: "skipped", reason: "Sender is a no-reply address" };
	}

	const stub = getMailboxStub(env as unknown as Env, mailboxId);
	const systemPrompt = agent.systemPrompt ?? ROLE_PROMPTS[agent.role];

	// Recall any memory about this sender
	let senderContext = "";
	try {
		const mem = await stub.brainRecall("sender", payload.sender);
		if (mem && mem.length > 0) {
			senderContext = `\nKnown context about this sender:\n${mem.map((m: { value: string }) => m.value).join("\n")}`;
		}
	} catch {
		// Non-fatal
	}

	const routerNote = routerContext
		? `\nRouter classification: intent="${routerContext.intent}", selected agent="${routerContext.suggestedAgent}". Use this context to tailor your response appropriately.\n`
		: "";

	const userContent = `Incoming email:
From: ${payload.sender}
Subject: ${payload.subject}
Date: ${payload.date}

${(payload.body ?? "").slice(0, 6000)}${senderContext}${routerNote}
Draft a reply to this email. Write only the reply body text (no headers, no "Subject:", no "From:").`;

	const { text, usage } = await generateText({
		model,
		system: systemPrompt,
		prompt: userContent,
		maxOutputTokens: 800,
		temperature: 0.4,
	});

	logUsage(sql, agent, payload.emailId, usage.inputTokens ?? 0, usage.outputTokens ?? 0,
		agent.guardrails.autoSend ? "sent" : "drafted", modelDef);

	const draftBody = stripModelArtifacts(text.trim());
	const draftHtml = textToHtml(draftBody);

	// Determine if we should auto-send
	if (agent.guardrails.autoSend) {
		// Check daily auto-send cap
		// We use a quick heuristic: count "sent" actions today
		const today = new Date().toISOString().slice(0, 10);
		const sentToday = [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT COUNT(*) as c FROM ag_usage WHERE agent_id = ? AND action = 'sent' AND timestamp >= ?`,
			agent.id, today + "T00:00:00Z",
		)][0]?.c ?? 0;

		if (Number(sentToday) >= agent.guardrails.maxAutoSendPerDay) {
			// Fall back to draft
			return await saveDraft(stub, payload, draftHtml, agent);
		}

		// Auto-send
		try {
			const { messageId } = await sendEmail(env.EMAIL as SendEmail, {
				from: mailboxId,
				to: payload.sender,
				subject: `Re: ${payload.subject}`,
				html: `${draftHtml}\n${buildQuotedReplyBlock({ body: payload.body ?? undefined, sender: payload.sender, date: payload.date })}`,
			});
			return { outcome: "sent", messageId };
		} catch {
			// Fall back to draft if send fails
			return await saveDraft(stub, payload, draftHtml, agent);
		}
	}

	return await saveDraft(stub, payload, draftHtml, agent);
}

async function saveDraft(
	stub: ReturnType<typeof getMailboxStub>,
	payload: OnEmailReceivedPayload,
	draftHtml: string,
	agent: Agent,
): Promise<AgentRunResult> {
	// Save to Drafts folder via the DO
	const draftId = crypto.randomUUID();
	try {
		await (stub as unknown as {
			saveDraft: (d: Record<string, unknown>) => Promise<void>
		}).saveDraft({
			id: draftId,
			subject: `Re: ${payload.subject}`,
			to: payload.sender,
			body: draftHtml,
			inReplyToEmailId: payload.emailId,
			createdAt: new Date().toISOString(),
			agentId: agent.id,
		});
	} catch {
		// Non-fatal
	}
	return { outcome: "drafted", draftId };
}
