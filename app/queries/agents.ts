import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

// ── Types ─────────────────────────────────────────────────────────

export type AgentRole =
	| "router" | "responder" | "researcher" | "summarizer"
	| "spam_guard" | "marketing" | "support" | "scheduler" | "custom";

export interface AgentGuardrails {
	maxEmailsPerHour: number;
	dailyTokenBudget: number;
	autoSend: boolean;
	maxAutoSendPerDay: number;
	requireSpamCheck: boolean;
}

export interface TriggerPolicy {
	events: string[];
	senderFilter?: string[];
	subjectKeywords?: string[];
}

export interface AgentInfo {
	id: string;
	name: string;
	role: AgentRole;
	enabled: boolean;
	providerId: string;
	modelId: string;
	systemPrompt: string | null;
	trigger: TriggerPolicy;
	guardrails: AgentGuardrails;
	createdAt: string;
	updatedAt: string;
	roleMeta?: { name: string; description: string; icon: string };
}

export interface RoleInfo {
	id: AgentRole;
	name: string;
	description: string;
	icon: string;
	defaultTriggers: string[];
}

export interface SenderReport {
	id: string;
	emailAddress: string;
	summary: string;
	data: {
		name?: string;
		organization?: string;
		role?: string;
		location?: string;
		communicationStyle?: string;
		topics?: string[];
		relationshipValue?: string;
	};
	lastSeenAt?: string;
	emailCount?: number;
	createdAt: string;
	updatedAt: string;
}

export interface UsageSummary {
	totalRuns: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalCostUsd: number;
}

// ── API helper ────────────────────────────────────────────────────

const PLUGIN_BASE = (mailboxId: string) =>
	`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/api/plugins/agents`;

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		...options,
		headers: { "Content-Type": "application/json", ...(options?.headers as Record<string, string>) },
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({})) as { error?: string };
		throw new Error(body.error ?? `Request failed: ${res.status}`);
	}
	return res.json() as Promise<T>;
}

// ── Roles ────────────────────────────────────────────────────────

export function useAgentRoles(mailboxId: string | undefined) {
	return useQuery<{ roles: RoleInfo[] }>({
		queryKey: ["agent-roles"],
		queryFn: () => apiFetch(`${PLUGIN_BASE(mailboxId!)}/roles`),
		enabled: !!mailboxId,
		staleTime: Infinity,
	});
}

// ── Agents CRUD ───────────────────────────────────────────────────

export function useAgents(mailboxId: string | undefined) {
	return useQuery<{ agents: AgentInfo[] }>({
		queryKey: mailboxId ? queryKeys.agents.list(mailboxId) : ["agents", "_disabled"],
		queryFn: () => apiFetch(`${PLUGIN_BASE(mailboxId!)}/`),
		enabled: !!mailboxId,
	});
}

export function useAgent(mailboxId: string | undefined, agentId: string | undefined) {
	return useQuery<{ agent: AgentInfo }>({
		queryKey: mailboxId && agentId ? queryKeys.agents.detail(mailboxId, agentId) : ["agents", "_disabled"],
		queryFn: () => apiFetch(`${PLUGIN_BASE(mailboxId!)}/${agentId}`),
		enabled: !!mailboxId && !!agentId,
	});
}

export function useCreateAgent(mailboxId: string | undefined) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (agent: Partial<AgentInfo>) =>
			apiFetch<{ agent: AgentInfo }>(`${PLUGIN_BASE(mailboxId!)}/`, {
				method: "POST",
				body: JSON.stringify(agent),
			}),
		onSuccess: () => {
			if (mailboxId) qc.invalidateQueries({ queryKey: queryKeys.agents.list(mailboxId) });
		},
	});
}

export function useUpdateAgent(mailboxId: string | undefined) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ agentId, ...patch }: Partial<AgentInfo> & { agentId: string }) =>
			apiFetch<{ agent: AgentInfo }>(`${PLUGIN_BASE(mailboxId!)}/${agentId}`, {
				method: "PUT",
				body: JSON.stringify(patch),
			}),
		onSuccess: (_data, vars) => {
			if (mailboxId) {
				qc.invalidateQueries({ queryKey: queryKeys.agents.list(mailboxId) });
				qc.invalidateQueries({ queryKey: queryKeys.agents.detail(mailboxId, vars.agentId) });
			}
		},
	});
}

export function useDeleteAgent(mailboxId: string | undefined) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ agentId }: { agentId: string }) =>
			apiFetch(`${PLUGIN_BASE(mailboxId!)}/${agentId}`, { method: "DELETE" }),
		onSuccess: () => {
			if (mailboxId) qc.invalidateQueries({ queryKey: queryKeys.agents.list(mailboxId) });
		},
	});
}

// ── Usage ─────────────────────────────────────────────────────────

export function useAgentUsage(mailboxId: string | undefined, agentId: string | undefined, days = 7) {
	return useQuery<{ summary: UsageSummary }>({
		queryKey: mailboxId && agentId ? queryKeys.agents.usage(mailboxId, agentId, days) : ["agent-usage", "_disabled"],
		queryFn: () => apiFetch(`${PLUGIN_BASE(mailboxId!)}/${agentId}/usage?days=${days}`),
		enabled: !!mailboxId && !!agentId,
	});
}

// ── Sender reports ────────────────────────────────────────────────

export function useSenderReports(mailboxId: string | undefined, limit = 20) {
	return useQuery<{ reports: SenderReport[] }>({
		queryKey: mailboxId ? queryKeys.agents.reports(mailboxId) : ["sender-reports", "_disabled"],
		queryFn: () => apiFetch(`${PLUGIN_BASE(mailboxId!)}/reports?limit=${limit}`),
		enabled: !!mailboxId,
	});
}

export function useSenderReport(mailboxId: string | undefined, emailAddress: string | undefined) {
	return useQuery<{ report: SenderReport }>({
		queryKey: mailboxId && emailAddress ? queryKeys.agents.report(mailboxId, emailAddress) : ["sender-report", "_disabled"],
		queryFn: () => apiFetch(`${PLUGIN_BASE(mailboxId!)}/reports/${encodeURIComponent(emailAddress!)}`),
		enabled: !!mailboxId && !!emailAddress,
	});
}
