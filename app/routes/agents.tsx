import { Badge, Button, Dialog, Input, Select, Switch, Textarea, useKumoToastManager } from "@cloudflare/kumo";
import {
	RobotIcon,
	PlusIcon,
	TrashIcon,
	PencilSimpleIcon,
	SpinnerGapIcon,
	ArrowCounterClockwiseIcon,
	ChartBarIcon,
	IdentificationCardIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams, NavLink } from "react-router";
import {
	useAgents,
	useAgentRoles,
	useCreateAgent,
	useUpdateAgent,
	useDeleteAgent,
	useAgentUsage,
	type AgentInfo,
	type AgentRole,
} from "~/queries/agents";
import { useProviders } from "~/queries/plugins";

// ── Role badge colors ─────────────────────────────────────────────

const ROLE_COLORS: Record<AgentRole, string> = {
	router:     "bg-blue-100 text-blue-700",
	responder:  "bg-purple-100 text-purple-700",
	researcher: "bg-amber-100 text-amber-700",
	summarizer: "bg-teal-100 text-teal-700",
	spam_guard: "bg-red-100 text-red-700",
	marketing:  "bg-pink-100 text-pink-700",
	support:    "bg-green-100 text-green-700",
	scheduler:  "bg-indigo-100 text-indigo-700",
	custom:     "bg-gray-100 text-gray-700",
};

// ── Usage badge for one agent ─────────────────────────────────────

function AgentUsageBadge({ mailboxId, agentId }: { mailboxId: string; agentId: string }) {
	const { data } = useAgentUsage(mailboxId, agentId, 7);
	if (!data?.summary || data.summary.totalRuns === 0) return null;
	return (
		<span className="text-xs text-kumo-subtle">
			{data.summary.totalRuns} run{data.summary.totalRuns !== 1 ? "s" : ""} (7d) ·{" "}
			${data.summary.totalCostUsd.toFixed(4)}
		</span>
	);
}

// ── Default guardrails values ─────────────────────────────────────

const EMPTY_GUARDRAILS = {
	maxEmailsPerHour: 20,
	dailyTokenBudget: 100000,
	autoSend: false,
	maxAutoSendPerDay: 10,
	requireSpamCheck: true,
};

// ── Agent form (create / edit) ─────────────────────────────────────

function AgentForm({
	mailboxId,
	initial,
	onClose,
}: {
	mailboxId: string;
	initial?: AgentInfo;
	onClose: () => void;
}) {
	const toastManager = useKumoToastManager();
	const { data: rolesData } = useAgentRoles(mailboxId);
	const { data: providersData } = useProviders(mailboxId);
	const createAgent = useCreateAgent(mailboxId);
	const updateAgent = useUpdateAgent(mailboxId);

	const [name, setName] = useState(initial?.name ?? "");
	const [role, setRole] = useState<AgentRole>(initial?.role ?? "responder");
	const [providerId, setProviderId] = useState(initial?.providerId ?? "cloudflare");
	const [modelId, setModelId] = useState(initial?.modelId ?? "@cf/moonshotai/kimi-k2.5");
	const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
	const [guardrails, setGuardrails] = useState(initial?.guardrails ?? EMPTY_GUARDRAILS);
	const [saving, setSaving] = useState(false);

	const selectedProvider = (providersData?.providers ?? []).find((p) => p.id === providerId);
	const models = selectedProvider?.models ?? [];

	const handleSave = async () => {
		if (!name.trim() || !role || !providerId || !modelId) return;
		setSaving(true);
		try {
			if (initial) {
				await updateAgent.mutateAsync({
					agentId: initial.id,
					name,
					role,
					providerId,
					modelId,
					systemPrompt: systemPrompt || null,
					guardrails,
				});
				toastManager.add({ title: "Agent updated" });
			} else {
				await createAgent.mutateAsync({ name, role, providerId, modelId, systemPrompt: systemPrompt || null, guardrails });
				toastManager.add({ title: "Agent created" });
			}
			onClose();
		} catch {
			toastManager.add({ title: "Failed to save agent", variant: "error" });
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-5">
			{/* Name */}
			<div>
				<label className="text-sm font-medium text-kumo-default block mb-1">Agent Name</label>
				<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Support Agent" />
			</div>

			{/* Role */}
			<div>
				<label className="text-sm font-medium text-kumo-default block mb-1">Role</label>
				<Select
					value={role}
					onValueChange={(v) => { if (v) setRole(v as AgentRole); }}
				>
					{(rolesData?.roles ?? []).map((r) => (
						<Select.Option key={r.id} value={r.id}>{r.name} — {r.description}</Select.Option>
					))}
				</Select>
			</div>

			{/* Provider + Model */}
			<div className="grid grid-cols-2 gap-3">
				<div>
					<label className="text-sm font-medium text-kumo-default block mb-1">Provider</label>
					<Select
				value={providerId}
				onValueChange={(v) => {
					if (!v) return;
					setProviderId(v);
					const p = (providersData?.providers ?? []).find((pr) => pr.id === v);
					if (p?.models[0]) setModelId(p.models[0].id);
				}}
			>
						{(providersData?.providers ?? []).map((p) => (
							<Select.Option key={p.id} value={p.id}>
								{p.name}{p.requiresKey && !p.hasKey ? " (no key)" : ""}
							</Select.Option>
						))}
					</Select>
				</div>
				<div>
					<label className="text-sm font-medium text-kumo-default block mb-1">Model</label>
					<Select value={modelId} onValueChange={(v) => { if (v) setModelId(v); }}>
						{models.map((m) => (
							<Select.Option key={m.id} value={m.id}>
								{m.name}{m.recommended ? " ★" : ""}
							</Select.Option>
						))}
					</Select>
				</div>
			</div>

			{/* System prompt override */}
			<div>
				<label className="text-sm font-medium text-kumo-default block mb-1">
					System Prompt Override{" "}
					<span className="font-normal text-kumo-subtle">(optional — leave blank to use the built-in role default)</span>
				</label>
				<Textarea
					value={systemPrompt}
					onChange={(e) => setSystemPrompt(e.target.value)}
					placeholder="You are a helpful email assistant…"
					rows={4}
					className="font-mono text-sm"
				/>
			</div>

			{/* Guardrails */}
			<div>
				<h3 className="text-sm font-medium text-kumo-default mb-3">Guardrails</h3>
				<div className="space-y-3 bg-kumo-tint p-4 rounded-lg">
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="text-xs text-kumo-subtle block mb-1">Max emails/hour</label>
							<Input
								type="number"
								value={guardrails.maxEmailsPerHour}
								onChange={(e) => setGuardrails({ ...guardrails, maxEmailsPerHour: Number(e.target.value) })}
								min={1}
								max={1000}
							/>
						</div>
						<div>
							<label className="text-xs text-kumo-subtle block mb-1">Daily token budget</label>
							<Input
								type="number"
								value={guardrails.dailyTokenBudget}
								onChange={(e) => setGuardrails({ ...guardrails, dailyTokenBudget: Number(e.target.value) })}
								min={1000}
								step={10000}
							/>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<div>
							<div className="text-sm text-kumo-default">Auto-send</div>
							<div className="text-xs text-kumo-subtle">Send emails without human review (use with caution)</div>
						</div>
						<Switch
							checked={guardrails.autoSend}
							onCheckedChange={(v) => setGuardrails({ ...guardrails, autoSend: v })}
						/>
					</div>
					{guardrails.autoSend && (
						<div>
							<label className="text-xs text-kumo-subtle block mb-1">Max auto-sends/day</label>
							<Input
								type="number"
								value={guardrails.maxAutoSendPerDay}
								onChange={(e) => setGuardrails({ ...guardrails, maxAutoSendPerDay: Number(e.target.value) })}
								min={1}
								max={200}
							/>
						</div>
					)}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-sm text-kumo-default">Require spam check</div>
							<div className="text-xs text-kumo-subtle">Run spam guard before this agent processes an email</div>
						</div>
						<Switch
							checked={guardrails.requireSpamCheck}
							onCheckedChange={(v) => setGuardrails({ ...guardrails, requireSpamCheck: v })}
						/>
					</div>
				</div>
			</div>

			{/* Actions */}
			<div className="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
				<Button variant="primary" onClick={handleSave} disabled={saving || !name.trim()}>
					{saving && <SpinnerGapIcon size={16} className="animate-spin mr-1" />}
					{initial ? "Save Changes" : "Create Agent"}
				</Button>
			</div>
		</div>
	);
}

// ── Agent card ────────────────────────────────────────────────────

function AgentCard({
	agent,
	mailboxId,
}: {
	agent: AgentInfo;
	mailboxId: string;
}) {
	const toastManager = useKumoToastManager();
	const updateAgent = useUpdateAgent(mailboxId);
	const deleteAgent = useDeleteAgent(mailboxId);
	const [editOpen, setEditOpen] = useState(false);

	const handleToggle = async (enabled: boolean) => {
		try {
			await updateAgent.mutateAsync({ agentId: agent.id, enabled });
		} catch {
			toastManager.add({ title: "Failed to update agent", variant: "error" });
		}
	};

	const handleDelete = async () => {
		if (!confirm(`Delete agent "${agent.name}"?`)) return;
		try {
			await deleteAgent.mutateAsync({ agentId: agent.id });
			toastManager.add({ title: "Agent deleted" });
		} catch {
			toastManager.add({ title: "Failed to delete agent", variant: "error" });
		}
	};

	return (
		<>
			<div className="flex items-start justify-between gap-3 px-4 py-4 bg-kumo-surface border border-kumo-line rounded-lg">				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="font-medium text-kumo-default">{agent.name}</span>
						<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[agent.role]}`}>
							{agent.roleMeta?.name ?? agent.role}
						</span>
						{agent.guardrails.autoSend && (
							<Badge variant="secondary" className="text-xs">Auto-send</Badge>
						)}
					</div>
					<div className="text-xs text-kumo-subtle mt-0.5">
						{agent.providerId} · {agent.modelId}
					</div>
					<div className="mt-1">
						<AgentUsageBadge mailboxId={mailboxId} agentId={agent.id} />
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Switch
						checked={agent.enabled}
						onCheckedChange={handleToggle}
						disabled={updateAgent.isPending}
					/>
					<Button
						variant="ghost"
						size="sm"
						shape="square"
						aria-label="Edit agent"
						icon={<PencilSimpleIcon size={14} />}
						onClick={() => setEditOpen(true)}
					/>
					<Button
						variant="ghost"
						size="sm"
						shape="square"
						aria-label="Delete agent"
						icon={<TrashIcon size={14} />}
						onClick={handleDelete}
					/>
				</div>
			</div>

			<Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
				<Dialog size="lg">
					<Dialog.Title>{`Edit Agent: ${agent.name}`}</Dialog.Title>
					<AgentForm mailboxId={mailboxId} initial={agent} onClose={() => setEditOpen(false)} />
				</Dialog>
			</Dialog.Root>
		</>
	);
}

// ── Main route ────────────────────────────────────────────────────

export default function AgentsDashboardRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { data, isLoading } = useAgents(mailboxId);
	const [createOpen, setCreateOpen] = useState(false);

	const agents = data?.agents ?? [];
	const enabledCount = agents.filter((a) => a.enabled).length;

	return (
		<div className="max-w-3xl mx-auto py-10 px-6 space-y-8">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div>
					<h1 className="text-2xl font-bold text-kumo-default flex items-center gap-2">
						<RobotIcon size={24} />
						AI Agents
					</h1>
					<p className="text-kumo-subtle mt-1 text-sm">
						{agents.length === 0
							? "No agents configured. Create your first agent to automate email processing."
							: `${enabledCount} of ${agents.length} agent${agents.length !== 1 ? "s" : ""} active`
						}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<NavLink
						to={`/mailbox/${mailboxId}/agents/reports`}
						className="text-sm text-kumo-subtle hover:text-kumo-default flex items-center gap-1"
					>
						<IdentificationCardIcon size={16} />
						Sender Reports
					</NavLink>
					<Button
						variant="primary"
						icon={<PlusIcon size={16} />}
						onClick={() => setCreateOpen(true)}
					>
						New Agent
					</Button>
				</div>
			</div>

			{/* Agent list */}
			{isLoading ? (
				<div className="flex justify-center py-12">
					<SpinnerGapIcon size={24} className="animate-spin text-kumo-subtle" />
				</div>
			) : agents.length === 0 ? (
				<div className="text-center py-16 border border-dashed border-kumo-line rounded-lg">
					<RobotIcon size={40} className="text-kumo-subtle mx-auto mb-3" />
					<p className="text-kumo-subtle text-sm">No agents yet</p>
					<Button
						variant="primary"
						className="mt-4"
						icon={<PlusIcon size={16} />}
						onClick={() => setCreateOpen(true)}
					>
						Create your first agent
					</Button>
				</div>
			) : (
				<div className="space-y-3">
					{agents.map((agent) => (
						<AgentCard key={agent.id} agent={agent} mailboxId={mailboxId!} />
					))}
				</div>
			)}

			{/* Info cards */}
			{agents.length > 0 && (
				<div className="bg-kumo-tint rounded-lg p-4 text-xs text-kumo-subtle space-y-1">
					<p>• <strong>Spam Guard</strong> always runs first and can block emails from reaching other agents.</p>
					<p>• Agents with <strong>Auto-send</strong> disabled will save replies to Drafts for your review.</p>
					<p>• Rate limits and daily token budgets protect against runaway costs from spam attacks.</p>
				</div>
			)}

			{/* Create dialog */}
			<Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
				<Dialog size="lg">
					<Dialog.Title>New AI Agent</Dialog.Title>
					<AgentForm mailboxId={mailboxId!} onClose={() => setCreateOpen(false)} />
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
