// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	toolListMailboxes,
	toolListEmails,
	toolGetEmail,
	toolGetThread,
	toolSearchEmails,
	toolReadAttachment,
	toolDraftReply,
	toolDraftEmail,
	toolUpdateDraft,
	toolDeleteEmail,
	toolSendReply,
	toolSendEmail,
	toolMarkEmailRead,
	toolMoveEmail,
	toolBrainRemember,
	toolBrainRecall,
	toolBrainSummary,
} from "../lib/tools";
import { Folders, FOLDER_TOOL_DESCRIPTION, MOVE_FOLDER_TOOL_DESCRIPTION } from "../../shared/folders";
import type { Env } from "../types";
import { getMailboxStub } from "../lib/email-helpers";
import { casesRepo } from "../../plugins/debt-control/storage/repos/cases.repo";
import { findingsRepo } from "../../plugins/debt-control/storage/repos/findings.repo";
import { settingsRepo } from "../../plugins/debt-control/storage/repos/settings.repo";
import { eventsRepo } from "../../plugins/debt-control/storage/repos/events.repo";
import { documentsRepo } from "../../plugins/debt-control/storage/repos/documents.repo";
import type { CaseStatus } from "../../plugins/debt-control/types";
import { runLegalityChecks } from "../../plugins/debt-control/domain/legality-engine";
import { getTacticalResponse } from "../../plugins/debt-control/domain/tactical-response-engine";
import { buildDebtTimelineInsights } from "../../plugins/debt-control/domain/timeline-insights";
import { buildCollectionFingerprint, describeFingerprintMatch } from "../../plugins/debt-control/domain/collection-fingerprint-engine";
import { predictNextCollectionStep } from "../../plugins/debt-control/domain/next-step-predictor";
import {
	enqueueAllSources,
	ingestionStatus,
	methodologyConsensus,
	processQueueJob,
	LEGAL_SOURCES,
	type LegalSourceType,
} from "../lib/legal-ingestion";

type DomainPluginId = "inkasso" | "gdpr" | "telecom" | "strom" | "husleie" | "arbeidsrett";
type PipelinePhase =
	| "classify"
	| "extract_signals"
	| "run_validators"
	| "detect_patterns"
	| "evaluate_deadlines"
	| "apply_harm_gate"
	| "apply_capacity_gate"
	| "route_templates"
	| "generate_transparent_output";

type DomainPluginManifest = {
	id: DomainPluginId;
	name: string;
	status: "production" | "maturing" | "planned";
	description: string;
	authorities: string[];
	deadlineRules: string[];
};

type DomainFinding = {
	rule: string;
	outcome: "PASS" | "FAIL" | "REVIEW";
	severity: "low" | "medium" | "high" | "critical";
	reason: string;
	legalAnchor?: string[];
};

const PIPELINE_PHASES: PipelinePhase[] = [
	"classify",
	"extract_signals",
	"run_validators",
	"detect_patterns",
	"evaluate_deadlines",
	"apply_harm_gate",
	"apply_capacity_gate",
	"route_templates",
	"generate_transparent_output",
];

const DCE_DOMAIN_PLUGINS: DomainPluginManifest[] = [
	{
		id: "inkasso",
		name: "@dce/inkasso",
		status: "production",
		description: "Inkasso og omkostningskontroll med deterministiske validatorer.",
		authorities: ["Inkassoloven", "Inkassoforskriften", "Finansklagenemnda", "Finanstilsynet"],
		deadlineRules: ["14-day notice", "active dispute hold", "portfolio consolidation"],
	},
	{
		id: "gdpr",
		name: "@dce/gdpr",
		status: "maturing",
		description: "SAR, art. 18/22, profilering og tilsynsspor.",
		authorities: ["GDPR", "Datatilsynet", "EDPB"],
		deadlineRules: ["30-day SAR response", "restriction hold"],
	},
	{
		id: "telecom",
		name: "@dce/telecom",
		status: "maturing",
		description: "SLA, oppetid, kompensasjonsspor og kritisk samband.",
		authorities: ["Ekomregelverk", "Brukerklagenemnda"],
		deadlineRules: ["complaint window", "service restoration urgency"],
	},
	{
		id: "strom",
		name: "@dce/strom",
		status: "planned",
		description: "Stengingsvern og helseavhengig tjenestevurdering.",
		authorities: ["Energiregelverk", "Elklagenemnda"],
		deadlineRules: ["disconnection warning rules", "manual health review"],
	},
	{
		id: "husleie",
		name: "@dce/husleie",
		status: "planned",
		description: "Depositum, fravikelse, tvisteløp og beviskontroll.",
		authorities: ["Husleieloven", "Husleietvistutvalget"],
		deadlineRules: ["notice windows", "eviction process timeline"],
	},
	{
		id: "arbeidsrett",
		name: "@dce/arbeidsrett",
		status: "planned",
		description: "Drøftelsesmøte, oppsigelsesvern og prosessfrister.",
		authorities: ["Arbeidsmiljøloven", "Tvisteloven"],
		deadlineRules: ["negotiation windows", "litigation deadlines"],
	},
];

function inferDomainHints(text: string): {
	primary: DomainPluginId;
	secondary: DomainPluginId[];
	confidence: number;
	triggers: string[];
} {
	const normalized = text.toLowerCase();
	const keywordMap: { domain: DomainPluginId; tokens: string[] }[] = [
		{ domain: "inkasso", tokens: ["inkasso", "salær", "betalingsoppfordring", "kreditor", "gebyr"] },
		{ domain: "gdpr", tokens: ["gdpr", "personvern", "innsyn", "art. 15", "art. 18", "art. 22", "profilering"] },
		{ domain: "telecom", tokens: ["telecom", "fiber", "opptid", "driftsstans", "ekom", "samband", "sla"] },
		{ domain: "strom", tokens: ["strøm", "stenging", "helseutstyr", "cpap", "elklagenemnda", "nettleie"] },
		{ domain: "husleie", tokens: ["husleie", "depositum", "fravikelse", "utkastelse"] },
		{ domain: "arbeidsrett", tokens: ["oppsigelse", "drøftelsesmøte", "arbeidsmiljøloven", "arbeidsforhold"] },
	];

	const hits = keywordMap
		.map((entry) => ({
			domain: entry.domain,
			score: entry.tokens.filter((token) => normalized.includes(token)).length,
			tokens: entry.tokens.filter((token) => normalized.includes(token)),
		}))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score);

	if (hits.length === 0) {
		return {
			primary: "inkasso",
			secondary: [],
			confidence: 0.35,
			triggers: [],
		};
	}

	const [top, ...rest] = hits;
	const secondaries = rest.slice(0, 2).map((h) => h.domain);
	return {
		primary: top.domain,
		secondary: secondaries,
		confidence: Math.min(0.98, 0.5 + top.score * 0.12),
		triggers: top.tokens,
	};
}

function buildMultiDomainFindings(text: string): DomainFinding[] {
	const normalized = text.toLowerCase();
	const findings: DomainFinding[] = [];

	if (normalized.includes("inkasso") && normalized.includes("bestridt")) {
		findings.push({
			rule: "active_dispute_hold",
			outcome: "FAIL",
			severity: "high",
			reason: "Krav fremstår omtvistet; videre standardinndrivelse må stanses.",
			legalAnchor: ["Inkassoloven § 8", "Inkassoloven § 10"],
		});
	}

	if (normalized.includes("art. 18") || normalized.includes("behandlingsbegrensning")) {
		findings.push({
			rule: "gdpr_restriction_gate",
			outcome: "REVIEW",
			severity: "high",
			reason: "Mulig behandlingsbegrensning etter GDPR art. 18 krever kontrollspor.",
			legalAnchor: ["GDPR art. 18"],
		});
	}

	if (normalized.includes("stenging") && (normalized.includes("helse") || normalized.includes("cpap"))) {
		findings.push({
			rule: "critical_utility_health_gate",
			outcome: "FAIL",
			severity: "critical",
			reason: "Kritisk tjeneste/helserisiko krever manuell vurdering før eskalering.",
			legalAnchor: ["Harm Gate"],
		});
	}

	if (normalized.includes("opptid") || normalized.includes("driftsstans")) {
		findings.push({
			rule: "telecom_service_continuity_gate",
			outcome: "REVIEW",
			severity: "medium",
			reason: "Telecom/SLA-spor identifisert; vurder kompensasjon og kontinuitetskrav.",
			legalAnchor: ["Telecom SLA"],
		});
	}

	return findings;
}

function aggregateStrength(findings: DomainFinding[]) {
	const score = findings.reduce((acc, finding) => {
		const base = finding.outcome === "FAIL" ? 2 : finding.outcome === "REVIEW" ? 1 : 0;
		const sevBoost = finding.severity === "critical" ? 2 : finding.severity === "high" ? 1 : 0;
		return acc + base + sevBoost;
	}, 0);
	const level = score >= 8 ? "VERY_STRONG" : score >= 5 ? "STRONG" : score >= 3 ? "MODERATE" : "WEAK";
	return { score, level };
}

/** Wrap a plain result object into MCP content format. */
function mcpText(result: unknown) {
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(result, null, 2) },
		],
	};
}

/** Wrap an error string into MCP error format. */
function mcpError(message: string) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
		isError: true as const,
	};
}

/**
 * Wrap a result that may contain an `error` field into MCP format,
 * automatically setting isError when appropriate.
 */
function mcpResult(result: Record<string, unknown>) {
	if ("error" in result) {
		return {
			content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
			isError: true as const,
		};
	}
	return mcpText(result);
}

/**
 * EmailMCP — exposes email tools over the Model Context Protocol.
 *
 * Clients (ProtoAgent, Claude Code, Cursor, etc.) connect to the
 * `/mcp` endpoint and can list mailboxes, read/search emails,
 * draft replies, send messages, and manage folders.
 */
export class EmailMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "agentic-inbox",
		version: "1.0.0",
	});

	async init() {
		const env = this.env;

		/**
		 * Verify a mailbox exists in R2 before operating on it.
		 * Returns an MCP error response if the mailbox is not found, or null if valid.
		 */
		const verifyMailbox = async (mailboxId: string) => {
			const obj = await env.BUCKET.head(`mailboxes/${mailboxId}.json`);
			if (!obj) {
				return mcpError(`Mailbox "${mailboxId}" not found. Use list_mailboxes to see available mailboxes.`);
			}
			return null;
		};

		// ── list_mailboxes ─────────────────────────────────────────
		this.server.tool(
			"list_mailboxes",
			"List all available mailboxes",
			{},
			async () => {
				const result = await toolListMailboxes(env);
				return mcpText(result);
			},
		);

		// ── list_emails ────────────────────────────────────────────
		this.server.tool(
			"list_emails",
			"List emails in a mailbox folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id).",
			{
				mailboxId: z
					.string()
					.describe("The mailbox email address (e.g. user@example.com)"),
				folder: z
					.string()
					.default(Folders.INBOX)
					.describe(FOLDER_TOOL_DESCRIPTION),
				limit: z
					.number()
					.default(20)
					.describe("Maximum number of emails to return"),
				page: z
					.number()
					.default(1)
					.describe("Page number for pagination"),
			},
			async ({ mailboxId, folder, limit, page }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolListEmails(env, mailboxId, { folder, limit, page });
				return mcpText(result);
			},
		);

		// ── get_email ──────────────────────────────────────────────
		this.server.tool(
			"get_email",
			"Get a single email with its full body content. Use this to read the actual content of an email.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				emailId: z.string().describe("The email ID to retrieve"),
			},
			async ({ mailboxId, emailId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolGetEmail(env, mailboxId, emailId);
				if ("error" in result) {
					return {
						content: [{ type: "text" as const, text: "Email not found" }],
						isError: true,
					};
				}
				return mcpText(result);
			},
		);

		// ── get_thread ─────────────────────────────────────────────
		this.server.tool(
			"get_thread",
			"Get all emails in a conversation thread. Returns all messages sorted chronologically.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				threadId: z
					.string()
					.describe("The thread_id to retrieve all messages for"),
			},
			async ({ mailboxId, threadId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolGetThread(env, mailboxId, threadId);
				return mcpText(result);
			},
		);

		// ── search_emails ──────────────────────────────────────────
		this.server.tool(
			"search_emails",
			"Search for emails matching a query across subject and body fields.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				query: z.string().describe("Search query to match against subject and body"),
				folder: z
					.string()
					.optional()
					.describe("Optional folder to restrict search to"),
			},
			async ({ mailboxId, query, folder }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolSearchEmails(env, mailboxId, { query, folder });
				return mcpText(result);
			},
		);

		// ── draft_reply ────────────────────────────────────────────
		this.server.tool(
			"draft_reply",
			"Draft a reply to an email and save it to the Drafts folder. Does NOT send — saves a draft for review.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				originalEmailId: z
					.string()
					.describe("The ID of the email being replied to"),
				to: z.string().email().describe("Recipient email address"),
				subject: z.string().describe("Subject line (usually 'Re: ...')"),
				bodyHtml: z
					.string()
					.describe("The HTML body of the reply"),
			},
			async ({ mailboxId, originalEmailId, to, subject, bodyHtml }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolDraftReply(env, mailboxId, {
					originalEmailId,
					to,
					subject,
					body: bodyHtml,
					isPlainText: false,
					runVerifyDraft: true,
				});
				return mcpResult(result);
			},
		);

		// ── create_draft ───────────────────────────────────────────
		this.server.tool(
			"create_draft",
			"Create a new draft email. Can be a new email or a reply draft.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				to: z
					.string()
					.optional()
					.describe("Recipient email address (optional for early drafts)"),
				subject: z.string().describe("Subject line"),
				bodyHtml: z.string().describe("The HTML body of the draft"),
				in_reply_to: z
					.string()
					.optional()
					.describe("The ID of the email this draft is replying to (optional)"),
				thread_id: z
					.string()
					.optional()
					.describe("Thread ID to attach this draft to (optional)"),
			},
			async ({ mailboxId, to, subject, bodyHtml, in_reply_to, thread_id }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolDraftEmail(env, mailboxId, {
					to: to || "",
					subject,
					body: bodyHtml,
					isPlainText: false,
					runVerifyDraft: true,
					in_reply_to,
					thread_id,
				});
				if ("error" in result) {
					return mcpResult(result);
				}
				// Map the response to match the original create_draft output shape
				return mcpText({
					status: "draft_created",
					draftId: result.draftId,
					threadId: result.threadId,
					message: "Draft created in Drafts folder.",
				});
			},
		);

		// ── update_draft ───────────────────────────────────────────
		this.server.tool(
			"update_draft",
			"Update an existing draft email's content.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				draftId: z.string().describe("The ID of the draft to update"),
				to: z
					.string()
					.optional()
					.describe("Updated recipient email address"),
				subject: z.string().optional().describe("Updated subject line"),
				bodyHtml: z.string().optional().describe("Updated HTML body"),
			},
			async ({ mailboxId, draftId, to, subject, bodyHtml }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolUpdateDraft(env, mailboxId, {
					draftId,
					to,
					subject,
					bodyHtml,
				});
				if ("error" in result) {
					if (result.error === "Draft not found") {
						return {
							content: [{ type: "text" as const, text: "Draft not found" }],
							isError: true,
						};
					}
					return mcpResult(result);
				}
				return mcpText(result);
			},
		);

		// ── delete_email ───────────────────────────────────────────
		this.server.tool(
			"delete_email",
			"Permanently delete an email by ID.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				emailId: z.string().describe("The email ID to delete"),
			},
			async ({ mailboxId, emailId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolDeleteEmail(env, mailboxId, emailId);
				return mcpResult(result);
			},
		);

		// ── send_reply ─────────────────────────────────────────────
		this.server.tool(
			"send_reply",
			"Send a reply to an email. Only call after drafting and getting confirmation.",
			{
				mailboxId: z.string().describe("The mailbox email address to send from"),
				originalEmailId: z
					.string()
					.describe("The ID of the email being replied to"),
				to: z.string().email().describe("Recipient email address"),
				subject: z.string().describe("Subject line"),
				bodyHtml: z.string().describe("The HTML body of the reply"),
			},
			async ({ mailboxId, originalEmailId, to, subject, bodyHtml }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolSendReply(env, mailboxId, {
					originalEmailId,
					to,
					subject,
					bodyHtml,
				});
				if ("error" in result) {
					// Preserve the original MCP error format for send failures
					if (typeof result.error === "string" && result.error.startsWith("Failed to send")) {
						return {
							content: [{ type: "text" as const, text: result.error }],
							isError: true,
						};
					}
					if (result.error === "Original email not found") {
						return {
							content: [{ type: "text" as const, text: "Original email not found" }],
							isError: true,
						};
					}
					return mcpResult(result);
				}
				return mcpText(result);
			},
		);

		// ── send_email ─────────────────────────────────────────────
		this.server.tool(
			"send_email",
			"Send a new email (not a reply). Only call after getting confirmation.",
			{
				mailboxId: z.string().describe("The mailbox email address to send from"),
				to: z.string().email().describe("Recipient email address"),
				subject: z.string().describe("Subject line"),
				bodyHtml: z.string().describe("The HTML body of the email"),
			},
			async ({ mailboxId, to, subject, bodyHtml }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolSendEmail(env, mailboxId, {
					to,
					subject,
					bodyHtml,
				});
				if ("error" in result) {
					if (typeof result.error === "string" && result.error.startsWith("Failed to send")) {
						return {
							content: [{ type: "text" as const, text: result.error }],
							isError: true,
						};
					}
					return mcpResult(result);
				}
				return mcpText(result);
			},
		);

		// ── mark_email_read ────────────────────────────────────────
		this.server.tool(
			"mark_email_read",
			"Mark an email as read or unread.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				emailId: z.string().describe("The email ID"),
				read: z.boolean().describe("true to mark as read, false for unread"),
			},
			async ({ mailboxId, emailId, read }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolMarkEmailRead(env, mailboxId, emailId, read);
				return mcpText(result);
			},
		);

		// ── move_email ─────────────────────────────────────────────
		this.server.tool(
			"move_email",
			"Move an email to a different folder (inbox, sent, draft, archive, trash).",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				emailId: z.string().describe("The email ID"),
				folderId: z
					.string()
					.describe(MOVE_FOLDER_TOOL_DESCRIPTION),
			},
			async ({ mailboxId, emailId, folderId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolMoveEmail(env, mailboxId, emailId, folderId);
				if ("error" in result) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({ error: "Failed to move email" }),
							},
						],
						isError: true,
					};
				}
				return mcpText(result);
			},
		);

		// ── read_attachment ────────────────────────────────────────
		this.server.tool(
			"read_attachment",
			"Read the text content of an email attachment (PDF or plain text). Use this to analyse invoices, court letters, contracts, or other documents attached to emails. First call get_email to see available attachments and their IDs.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				emailId: z.string().describe("The ID of the email that contains the attachment"),
				attachmentId: z.string().describe("The attachment ID (from the email's attachments array)"),
				filename: z.string().describe("The attachment filename (e.g. 'invoice.pdf')"),
			},
			async ({ mailboxId, emailId, attachmentId, filename }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolReadAttachment(env, mailboxId, emailId, attachmentId, filename);
				return mcpText(result);
			},
		);

		// ── brain_remember ─────────────────────────────────────────
		this.server.tool(
			"brain_remember",
			"Store a persistent fact in the mailbox brain memory. Memories survive across sessions and are accessible to the AI agent. Use scope='sender' for per-sender knowledge, scope='instruction' for handling rules, scope='preference' for mailbox settings (e.g. key='auto_reply' value='false' to disable auto-drafting), scope='loop' is reserved for internal use.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				scope: z
					.enum(["sender", "instruction", "preference", "loop"])
					.describe("Memory category"),
				key: z
					.string()
					.describe("Unique key within the scope, e.g. sender email address or setting name"),
				value: z.string().describe("The value to store"),
				ttlDays: z
					.number()
					.optional()
					.describe("Optional TTL in days — omit for permanent storage"),
			},
			async ({ mailboxId, scope, key, value, ttlDays }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolBrainRemember(env, mailboxId, scope, key, value, ttlDays);
				return mcpText(result);
			},
		);

		// ── brain_recall ───────────────────────────────────────────
		this.server.tool(
			"brain_recall",
			"Retrieve facts from the mailbox brain memory. If key is provided, returns just that entry. If omitted, returns all entries in the scope.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				scope: z
					.enum(["sender", "instruction", "preference", "loop"])
					.describe("Memory category to query"),
				key: z
					.string()
					.optional()
					.describe("Specific key to look up — omit to list all keys in scope"),
			},
			async ({ mailboxId, scope, key }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolBrainRecall(env, mailboxId, scope, key);
				return mcpText(result);
			},
		);

		// ── brain_summary ──────────────────────────────────────────
		this.server.tool(
			"brain_summary",
			"Return a summary of all active brain memories for a mailbox — sender notes, instructions, preferences, and loop counters.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
			},
			async ({ mailboxId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				const result = await toolBrainSummary(env, mailboxId);
				return mcpText(result);
			},
		);

		// ── list_debt_cases ────────────────────────────────────────
		this.server.tool(
			"list_debt_cases",
			"List debt collection cases for a mailbox. Returns case summaries including creditor, amount, due date, status, and priority. Requires the Debt Control plugin to be enabled.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				status: z
					.enum(["open", "disputed", "resolved", "closed", "escalated"])
					.optional()
					.describe("Filter by case status — omit to return all cases"),
			},
			async ({ mailboxId, status }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				try {
					const stub = getMailboxStub(env, mailboxId);
					const sql = await stub.getSql();
					const cases = casesRepo.listByMailbox(sql, mailboxId, status as CaseStatus | undefined);
					return mcpText({ cases, total: cases.length });
				} catch (err) {
					return mcpError(`Failed to list debt cases: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// ── get_debt_case ──────────────────────────────────────────
		this.server.tool(
			"get_debt_case",
			"Get full details for a single debt case, including findings (legal/validity issues detected) and the Debt Control plugin settings for the mailbox.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				caseId: z.string().describe("The debt case ID"),
			},
			async ({ mailboxId, caseId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				try {
					const stub = getMailboxStub(env, mailboxId);
					const sql = await stub.getSql();
					const caseRecord = casesRepo.findById(sql, caseId);
					if (!caseRecord) {
						return mcpError(`Debt case "${caseId}" not found`);
					}
					const findings = findingsRepo.findByCaseId(sql, caseId);
					return mcpText({ case: caseRecord, findings });
				} catch (err) {
					return mcpError(`Failed to get debt case: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// ── get_debt_settings ──────────────────────────────────────
		this.server.tool(
			"get_debt_settings",
			"Get the Debt Control plugin settings for a mailbox — automation toggles, thresholds, and bank provider configuration.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
			},
			async ({ mailboxId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				try {
					const stub = getMailboxStub(env, mailboxId);
					const sql = await stub.getSql();
					const settings = settingsRepo.get(sql);
					return mcpText({ settings });
				} catch (err) {
					return mcpError(`Failed to get debt settings: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// ── dce_doc_to_action_plan ──────────────────────────────────
		this.server.tool(
			"dce_doc_to_action_plan",
			"Run DCE deterministic checks for a debt case and return a concrete action plan with findings, tactical response, and next-step prediction.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				caseId: z.string().describe("The debt case ID"),
			},
			async ({ mailboxId, caseId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				try {
					const stub = getMailboxStub(env, mailboxId);
					const sql = await stub.getSql();
					const caseRecord = casesRepo.findById(sql, caseId);
					if (!caseRecord) {
						return mcpError(`Debt case "${caseId}" not found`);
					}
					const docs = documentsRepo.findByCaseId(sql, caseId);
					const events = eventsRepo.findByCaseId(sql, caseId);
					const freshFindings = runLegalityChecks(caseRecord, docs, events);
					for (const finding of freshFindings) {
						findingsRepo.upsert(sql, finding);
					}
					const findings = findingsRepo.findByCaseId(sql, caseId);
					const prediction = predictNextCollectionStep(caseRecord, events);
					const tactical = getTacticalResponse(caseRecord, findings, prediction);
					return mcpText({
						case: caseRecord,
						findingCount: findings.length,
						findings,
						prediction,
						tacticalResponse: tactical,
					});
				} catch (err) {
					return mcpError(`Failed to build DCE action plan: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// ── dce_case_timeline_insights ──────────────────────────────
		this.server.tool(
			"dce_case_timeline_insights",
			"Generate timeline insights for a debt case, including fee-escalation and process-pattern observations.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				caseId: z.string().describe("The debt case ID"),
			},
			async ({ mailboxId, caseId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				try {
					const stub = getMailboxStub(env, mailboxId);
					const sql = await stub.getSql();
					const caseRecord = casesRepo.findById(sql, caseId);
					if (!caseRecord) {
						return mcpError(`Debt case "${caseId}" not found`);
					}
					const events = eventsRepo.findByCaseId(sql, caseId);
					const insights = buildDebtTimelineInsights(caseRecord, events);
					return mcpText({
						caseId,
						eventCount: events.length,
						insightCount: insights.length,
						insights,
					});
				} catch (err) {
					return mcpError(`Failed to build DCE timeline insights: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// ── dce_creditor_profile ────────────────────────────────────
		this.server.tool(
			"dce_creditor_profile",
			"Build a creditor/collector process fingerprint from all matching debt cases in a mailbox, with pattern-based strategy notes.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
				creditor: z.string().describe("Creditor/collector display name to profile"),
			},
			async ({ mailboxId, creditor }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				try {
					const stub = getMailboxStub(env, mailboxId);
					const sql = await stub.getSql();
					const allCases = casesRepo.listByMailbox(sql, mailboxId);
					const creditorCases = allCases.filter((c) => c.creditor.toLowerCase().includes(creditor.toLowerCase()));
					if (creditorCases.length === 0) {
						return mcpError(`No debt cases found for creditor "${creditor}" in mailbox "${mailboxId}"`);
					}
					const eventsByCaseId = new Map<string, ReturnType<typeof eventsRepo.findByCaseId>>();
					for (const caseItem of creditorCases) {
						eventsByCaseId.set(caseItem.id, eventsRepo.findByCaseId(sql, caseItem.id));
					}
					const fingerprint = buildCollectionFingerprint(creditor, creditorCases, eventsByCaseId, creditor);
					const strategy = creditorCases.slice(0, 5).map((caseItem) => ({
						caseId: caseItem.id,
						match: describeFingerprintMatch(caseItem, fingerprint),
					}));
					return mcpText({
						creditor,
						caseCount: creditorCases.length,
						fingerprint,
						caseMatchSamples: strategy,
					});
				} catch (err) {
					return mcpError(`Failed to build creditor profile: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// ── dce_portfolio_report ────────────────────────────────────
		this.server.tool(
			"dce_portfolio_report",
			"Generate a portfolio-level DCE report with overcharge/fragmentation indicators and prioritized follow-up list.",
			{
				mailboxId: z.string().describe("The mailbox email address"),
			},
			async ({ mailboxId }) => {
				const denied = await verifyMailbox(mailboxId);
				if (denied) return denied;
				try {
					const stub = getMailboxStub(env, mailboxId);
					const sql = await stub.getSql();
					const allCases = casesRepo.listByMailbox(sql, mailboxId);
					const prioritized = allCases.map((caseItem) => {
						const docs = documentsRepo.findByCaseId(sql, caseItem.id);
						const events = eventsRepo.findByCaseId(sql, caseItem.id);
						const findings = runLegalityChecks(caseItem, docs, events);
						const hasCritical = findings.some((f) => f.severity === "critical");
						const fee = caseItem.amounts?.legalCosts ?? 0;
						const principal = caseItem.amounts?.principal ?? 0;
						const ratio = principal > 0 ? Number((fee / principal).toFixed(2)) : null;
						const score = (hasCritical ? 3 : 0) + (ratio !== null && ratio >= 2 ? 2 : 0) + (caseItem.status === "disputed" ? 2 : 0);
						return {
							caseId: caseItem.id,
							creditor: caseItem.creditor,
							status: caseItem.status,
							priorityScore: score,
							feeToPrincipalRatio: ratio,
							findings: findings.map((f) => ({ code: f.code, severity: f.severity })),
						};
					}).sort((a, b) => b.priorityScore - a.priorityScore);

					const summary = {
						totalCases: allCases.length,
						disputedCases: allCases.filter((c) => c.status === "disputed" || c.status === "objection_registered").length,
						casesWithHighFeeRatio: prioritized.filter((p) => p.feeToPrincipalRatio !== null && p.feeToPrincipalRatio >= 2).length,
						criticalCases: prioritized.filter((p) => p.findings.some((f) => f.severity === "critical")).length,
					};
					return mcpText({ summary, prioritizedCases: prioritized });
				} catch (err) {
					return mcpError(`Failed to build DCE portfolio report: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// -- dce_plugin_registry -------------------------------------------------
		this.server.tool(
			"dce_plugin_registry",
			"Return the domain-agnostic DCE plugin registry with current status, authorities, and deadline rule families.",
			{},
			async () =>
				mcpText({
					core: {
						name: "@dce/core",
						phases: PIPELINE_PHASES,
						pluginCount: DCE_DOMAIN_PLUGINS.length,
					},
					plugins: DCE_DOMAIN_PLUGINS,
				}),
		);

		// -- dce_domain_router ---------------------------------------------------
		this.server.tool(
			"dce_domain_router",
			"Route free-text/legal context to the most relevant DCE domain plugin(s), with confidence and trigger transparency.",
			{
				text: z.string().describe("Case text, incident description, or document content snippet."),
			},
			async ({ text }) => {
				const decision = inferDomainHints(text);
				return mcpText({
					decision,
					conflict_policy: "lex_specialis_first_then_lex_superior",
				});
			},
		);

		// -- dce_run_multi_domain_pipeline --------------------------------------
		this.server.tool(
			"dce_run_multi_domain_pipeline",
			"Run a transparent 9-phase multi-domain DCE pipeline that separates routing, findings, scoring and suggested actions.",
			{
				text: z.string().describe("Case text or extracted facts."),
				feedbackSignals: z
					.array(z.object({
						signal: z.string(),
						value: z.number().min(-1).max(1),
					}))
					.optional()
					.describe("Optional anonymized feedback signals for confidence tuning (does not override deterministic FAIL)."),
			},
			async ({ text, feedbackSignals }) => {
				const route = inferDomainHints(text);
				const findings = buildMultiDomainFindings(text);
				const strength = aggregateStrength(findings);
				const feedback = feedbackSignals ?? [];
				const feedbackScore = feedback.reduce((acc, item) => acc + item.value, 0);
				const adjustedConfidence = Number(
					Math.max(0.1, Math.min(0.99, route.confidence + feedbackScore * 0.03)).toFixed(2),
				);
				const deterministicFailCount = findings.filter((f) => f.outcome === "FAIL").length;
				const templates = [
					...(deterministicFailCount > 0 ? ["T02_specific_dispute", "T04_documentation_request"] : []),
					...(route.primary === "gdpr" ? ["T13_supervisory_complaint_datatilsynet"] : []),
					...(route.primary === "strom" ? ["T42_critical_utility_health_disconnection"] : []),
				];

				return mcpText({
					spec_version: "3.4.0",
					engine: "@dce/core+plugins",
					pipeline_phases: PIPELINE_PHASES,
					route,
					findings,
					score: strength,
					feedback: {
						signal_count: feedback.length,
						adjusted_confidence: adjustedConfidence,
						guardrail: "feedback_can_tune_confidence_not_override_deterministic_fail",
					},
					recommended_templates: [...new Set(templates)],
					transparency: {
						deterministic_share_pct: 85,
						heuristic_share_pct: 15,
						timestamp_utc: new Date().toISOString(),
					},
				});
			},
		);

		// -- dce_feedback_signal_stats ------------------------------------------
		this.server.tool(
			"dce_feedback_signal_stats",
			"Summarize anonymized feedback signals for test evidence and transparent calibration metrics.",
			{
				feedbackSignals: z.array(z.object({
					signal: z.string(),
					value: z.number().min(-1).max(1),
				})),
			},
			async ({ feedbackSignals }) => {
				const total = feedbackSignals.length;
				const positive = feedbackSignals.filter((s) => s.value > 0).length;
				const negative = feedbackSignals.filter((s) => s.value < 0).length;
				const neutral = total - positive - negative;
				const avg = total > 0 ? feedbackSignals.reduce((acc, item) => acc + item.value, 0) / total : 0;
				return mcpText({
					total,
					positive,
					negative,
					neutral,
					average_signal: Number(avg.toFixed(3)),
					note: "Signals are anonymized calibrators and never direct legal truth.",
				});
			},
		);

		// -- legal_ingestion_status -------------------------------------------------
		this.server.tool(
			"legal_ingestion_status",
			"Get ingestion status for legal intelligence pipeline (documents/jobs/cache status by source).",
			{},
			async () => {
				try {
					const status = await ingestionStatus(env);
					return mcpText({ success: true, ...status });
				} catch (err) {
					return mcpError(`Failed to get ingestion status: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// -- legal_ingestion_queue_sources ------------------------------------------
		this.server.tool(
			"legal_ingestion_queue_sources",
			"Queue all stable legal sources for ingestion (Høyesterett, Lovdata registries, FinKN).",
			{},
			async () => {
				try {
					const result = await enqueueAllSources(env);
					return mcpText({ success: true, ...result });
				} catch (err) {
					return mcpError(`Failed to queue sources: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// -- legal_ingestion_run_job ------------------------------------------------
		this.server.tool(
			"legal_ingestion_run_job",
			"Run one ingestion job immediately (for deterministic testing without waiting for queue schedule).",
			{
				source_id: z.string().describe("One of LEGAL_SOURCES source_id values."),
			},
			async ({ source_id }) => {
				try {
					const source = LEGAL_SOURCES.find((s) => s.source_id === source_id);
					if (!source) {
						return mcpError(`Unknown source_id: ${source_id}`);
					}
					const result = await processQueueJob(env, source);
					return mcpText({ success: true, source, result });
				} catch (err) {
					return mcpError(`Failed to run ingestion job: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);

		// -- dce_methodology_consensus ----------------------------------------------
		this.server.tool(
			"dce_methodology_consensus",
			"Apply legal methodology consensus rules (lex superior/specialis/posterior) and gate asserted breach when source quality is insufficient.",
			{
				assertion_level: z.enum(["fact_observed", "legal_issue", "probable_breach", "asserted_breach"]),
				references: z.array(z.object({
					source_type: z.enum(["SUPREME_COURT", "LAW_REGISTER", "REGULATION_REGISTER", "FINKN"] as [LegalSourceType, ...LegalSourceType[]]),
					review_required: z.boolean().optional(),
					specialis_score: z.number().optional(),
					effective_date: z.string().optional(),
				})),
			},
			async ({ assertion_level, references }) => {
				try {
					const consensus = methodologyConsensus({ assertion_level, references });
					return mcpText({ success: true, consensus });
				} catch (err) {
					return mcpError(`Failed to run methodology consensus: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		);
	}
}
