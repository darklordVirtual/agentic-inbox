/**
 * Type definitions for the Agents plugin.
 *
 * Agents are autonomous or semi-autonomous AI workers that run inside the
 * mailbox Durable Object. Each agent has a role, a configured model/provider,
 * budget guardrails, and a trigger policy.
 */

// ── Agent roles ────────────────────────────────────────────────────

/**
 * Built-in agent role IDs. Each role has a default system prompt and
 * a set of default tools available to it.
 */
export type AgentRole =
	| "router"          // Routes incoming emails to the right specialist agent
	| "responder"       // Drafts (or auto-sends) email replies
	| "researcher"      // Researches sender identity, creates reports
	| "summarizer"      // Summarises long threads / digest mode
	| "spam_guard"      // Classifies and quarantines spam before other agents run
	| "marketing"       // Handles outbound marketing campaigns
	| "support"         // Customer support auto-responder (with escalation)
	| "scheduler"       // Extracts meeting requests, drafts calendar invites
	| "custom";         // Fully custom system prompt defined by operator

// ── Trigger policies ──────────────────────────────────────────────

export type TriggerEvent = "email_received" | "email_opened" | "scheduled" | "manual";

export interface TriggerPolicy {
	/** Which events activate this agent */
	events: TriggerEvent[];
	/**
	 * Optional sender filter — only trigger for emails from matching addresses/domains.
	 * Supports glob: "*@example.com", "specific@user.com".
	 * Empty = match all.
	 */
	senderFilter?: string[];
	/**
	 * Optional subject keyword filter.
	 * Agent only runs when subject contains one of these keywords (case-insensitive).
	 * Empty = match all.
	 */
	subjectKeywords?: string[];
}

// ── Guardrails ─────────────────────────────────────────────────────

export interface AgentGuardrails {
	/** Maximum emails this agent can process per hour (spam protection). Default 20. */
	maxEmailsPerHour: number;
	/** Maximum total input+output tokens per day across all runs. Default 100k. */
	dailyTokenBudget: number;
	/**
	 * When true, agent can send emails autonomously without human review.
	 * When false (default), always saves to Drafts for review.
	 */
	autoSend: boolean;
	/**
	 * Maximum emails agent may auto-send per 24h (safety cap, even if autoSend=true).
	 * Default 10.
	 */
	maxAutoSendPerDay: number;
	/** Run spam guard check before this agent processes an email. Default true. */
	requireSpamCheck: boolean;
}

export const DEFAULT_GUARDRAILS: AgentGuardrails = {
	maxEmailsPerHour: 20,
	dailyTokenBudget: 100_000,
	autoSend: false,
	maxAutoSendPerDay: 10,
	requireSpamCheck: true,
};

// ── Agent record ──────────────────────────────────────────────────

export interface Agent {
	id: string;
	name: string;
	role: AgentRole;
	enabled: boolean;
	/** Provider ID from PROVIDERS list (e.g. "openai", "cloudflare"). */
	providerId: string;
	/** Model ID within the provider. */
	modelId: string;
	/** Override system prompt (leave null to use the built-in role default). */
	systemPrompt: string | null;
	trigger: TriggerPolicy;
	guardrails: AgentGuardrails;
	createdAt: string;
	updatedAt: string;
}

// ── Usage tracking ────────────────────────────────────────────────

export interface AgentUsageRecord {
	id: string;
	agentId: string;
	emailId: string | null;
	tokensIn: number;
	tokensOut: number;
	/** Estimated cost in USD */
	costUsd: number;
	action: "drafted" | "sent" | "classified" | "summarized" | "researched";
	timestamp: string;
}

// ── Research report ───────────────────────────────────────────────

export interface SenderReport {
	id: string;
	emailAddress: string;
	/** Human-readable summary */
	summary: string;
	/** Structured fields extracted from emails */
	data: {
		name?: string;
		organization?: string;
		role?: string;
		location?: string;
		language?: string;
		tone?: "formal" | "informal" | "aggressive" | "friendly" | "neutral";
		topics?: string[];
		totalEmails?: number;
		firstSeen?: string;
		lastSeen?: string;
		relationshipValue?: string;
	};
	/** ISO date of the last email seen from this sender */
	lastSeenAt?: string;
	/** Total emails received from this sender */
	emailCount?: number;
	createdAt: string;
	updatedAt: string;
}

// ── API request/response types ────────────────────────────────────

export interface CreateAgentRequest {
	name: string;
	role: AgentRole;
	providerId: string;
	modelId: string;
	enabled?: boolean;
	systemPrompt?: string;
	trigger?: Partial<TriggerPolicy>;
	guardrails?: Partial<AgentGuardrails>;
}

export interface UpdateAgentRequest extends Partial<CreateAgentRequest> {
	enabled?: boolean;
}
