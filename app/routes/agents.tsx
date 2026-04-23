import { Badge, Button, Dialog, Input, Select, Switch, Textarea, useKumoToastManager } from "@cloudflare/kumo";
import {
	RobotIcon,
	PlusIcon,
	TrashIcon,
	PencilSimpleIcon,
	SpinnerGapIcon,
	IdentificationCardIcon,
	BrainIcon,
	ShieldIcon,
	StarIcon,
	WrenchIcon,
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

// ── Agent form (create / edit) — tabbed ─────────────────────────

type FormTab = "identity" | "model" | "guardrails";

const TABS: { id: FormTab; label: string; icon: React.ReactNode }[] = [
	{ id: "identity",   label: "Identity",   icon: <RobotIcon size={14} /> },
	{ id: "model",      label: "Model",      icon: <BrainIcon size={14} /> },
	{ id: "guardrails", label: "Guardrails", icon: <ShieldIcon size={14} /> },
];

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

	const [activeTab, setActiveTab] = useState<FormTab>("identity");
	const [name, setName] = useState(initial?.name ?? "");
	const [role, setRole] = useState<AgentRole>(initial?.role ?? "responder");
	const [providerId, setProviderId] = useState(initial?.providerId ?? "cloudflare");
	const [modelId, setModelId] = useState(initial?.modelId ?? "@cf/moonshotai/kimi-k2.5");
	const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
	const [guardrails, setGuardrails] = useState(initial?.guardrails ?? EMPTY_GUARDRAILS);
	const [saving, setSaving] = useState(false);

	const selectedProvider = (providersData?.providers ?? []).find((p) => p.id === providerId);
	const models = selectedProvider?.models ?? [];
	const selectedModel = models.find((m) => m.id === modelId);

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
		<div className="flex flex-col gap-0">
			{/* Tab bar */}
			<div className="flex border-b border-kumo-line mb-5 -mx-1">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px cursor-pointer ${
							activeTab === tab.id
								? "border-kumo-brand text-kumo-brand"
								: "border-transparent text-kumo-subtle hover:text-kumo-default"
						}`}
					>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{/* Tab: Identity */}
			{activeTab === "identity" && (
				<div className="space-y-5">
					<div>
						<label className="text-sm font-medium text-kumo-default block mb-1">Agent Name</label>
						<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Support Agent" />
					</div>
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
						{role && (
							<div className="mt-1.5">
								<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[role]}`}>
									{(rolesData?.roles ?? []).find((r) => r.id === role)?.name ?? role}
								</span>
							</div>
						)}
					</div>
					<div>
						<label className="text-sm font-medium text-kumo-default block mb-1">
							System Prompt Override{" "}
							<span className="font-normal text-kumo-subtle">(optional)</span>
						</label>
						<Textarea
							value={systemPrompt}
							onChange={(e) => setSystemPrompt(e.target.value)}
							placeholder="You are a helpful email assistant…"
							rows={5}
							className="font-mono text-sm"
						/>
						<p className="text-xs text-kumo-subtle mt-1">Leave blank to use the built-in role default.</p>
					</div>
				</div>
			)}

			{/* Tab: Model */}
			{activeTab === "model" && (
				<div className="space-y-5">
					<div>
						<label className="text-sm font-medium text-kumo-default block mb-1">Provider</label>
						<Select
							value={providerId}
							onValueChange={(v) => {
								if (!v) return;
								setProviderId(v);
								const p = (providersData?.providers ?? []).find((pr) => pr.id === v);
								const firstModel = p?.models.find((m) => m.recommended) ?? p?.models[0];
								if (firstModel) setModelId(firstModel.id);
							}}
						>
							{(providersData?.providers ?? []).map((p) => (
								<Select.Option key={p.id} value={p.id}>
									{p.name}{p.requiresKey && !p.hasKey ? " ⚠ no key" : ""}
								</Select.Option>
							))}
						</Select>
						{selectedProvider && (
							<p className="text-xs text-kumo-subtle mt-1">{selectedProvider.description}</p>
						)}
						{selectedProvider?.requiresKey && !selectedProvider.hasKey && (
							<p className="text-xs text-amber-600 mt-1">⚠ No API key saved for this provider. Add it in Plugins &amp; Providers settings.</p>
						)}
					</div>
					<div>
						<label className="text-sm font-medium text-kumo-default block mb-1">Model</label>
						<Select value={modelId} onValueChange={(v) => { if (v) setModelId(v); }}>
							{models.map((m) => (
								<Select.Option key={m.id} value={m.id}>
									{m.recommended ? "★ " : ""}{m.name}
								</Select.Option>
							))}
						</Select>
					</div>
					{/* Selected model info card */}
					{selectedModel && (
						<div className="rounded-lg border border-kumo-line bg-kumo-tint p-4 space-y-2">
							<div className="flex items-center gap-2">
								<span className="font-medium text-kumo-default text-sm">{selectedModel.name}</span>
								{selectedModel.recommended && (
									<Badge variant="success" className="text-xs">
										<StarIcon size={10} className="mr-1" />
										Recommended
									</Badge>
								)}
								{selectedModel.supportsTools ? (
									<Badge variant="secondary" className="text-xs">
										<WrenchIcon size={10} className="mr-1" />
										Tool use
									</Badge>
								) : (
									<Badge variant="secondary" className="text-xs opacity-60">No tool use</Badge>
								)}
							</div>
							<div className="font-mono text-xs text-kumo-subtle">{selectedModel.id}</div>
							<div className="grid grid-cols-3 gap-3 pt-1">
								<div>
									<div className="text-xs text-kumo-subtle">Context window</div>
									<div className="text-sm font-medium text-kumo-default">
										{selectedModel.contextWindow >= 1000000
											? `${(selectedModel.contextWindow / 1000000).toFixed(1)}M`
											: `${(selectedModel.contextWindow / 1000).toFixed(0)}K`}
									</div>
								</div>
								<div>
									<div className="text-xs text-kumo-subtle">Input / 1M tokens</div>
									<div className="text-sm font-medium text-kumo-default">
										{selectedModel.costPer1MInput != null ? `$${selectedModel.costPer1MInput}` : <span className="text-emerald-600">Free</span>}
									</div>
								</div>
								<div>
									<div className="text-xs text-kumo-subtle">Output / 1M tokens</div>
									<div className="text-sm font-medium text-kumo-default">
										{selectedModel.costPer1MOutput != null ? `$${selectedModel.costPer1MOutput}` : <span className="text-emerald-600">Free</span>}
									</div>
								</div>
							</div>
						</div>
					)}
					{/* All models for this provider */}
					<div>
						<p className="text-xs text-kumo-subtle font-medium mb-2">All available models for {selectedProvider?.name}</p>
						<div className="rounded-lg border border-kumo-line overflow-hidden">
							{models.map((m, idx) => (
								<button
									key={m.id}
									type="button"
									onClick={() => setModelId(m.id)}
									className={`w-full text-left flex items-center justify-between px-3 py-2.5 text-xs transition-colors cursor-pointer ${
										m.id === modelId
											? "bg-kumo-brand/10 border-l-2 border-kumo-brand"
											: "hover:bg-kumo-tint border-l-2 border-transparent"
									} ${idx > 0 ? "border-t border-kumo-line" : ""}`}
								>
									<div>
										<span className="font-medium text-kumo-default flex items-center gap-1">
											{m.recommended && <StarIcon size={11} weight="fill" className="text-amber-500" />}
											{m.name}
										</span>
										<span className="text-kumo-subtle font-mono" style={{ fontSize: "10px" }}>{m.id}</span>
									</div>
									<div className="text-right text-kumo-subtle">
										{m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(1)}M ctx` : `${(m.contextWindow / 1000).toFixed(0)}K ctx`}
										{m.supportsTools && <span className="ml-2 text-emerald-600">tools</span>}
									</div>
								</button>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Tab: Guardrails */}
			{activeTab === "guardrails" && (
				<div className="space-y-4">
					<p className="text-xs text-kumo-subtle">Rate limits and budgets protect against runaway costs and spam attacks.</p>
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
					<div className="space-y-3 bg-kumo-tint p-4 rounded-lg border border-kumo-line">
						<div className="flex items-center justify-between">
							<div>
								<div className="text-sm text-kumo-default font-medium">Auto-send</div>
								<div className="text-xs text-kumo-subtle mt-0.5">Send emails without human review — use with caution</div>
							</div>
							<Switch
								checked={guardrails.autoSend}
								onCheckedChange={(v) => setGuardrails({ ...guardrails, autoSend: v })}
							/>
						</div>
						{guardrails.autoSend && (
							<div className="pt-2 border-t border-kumo-line">
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
						<div className="flex items-center justify-between pt-2 border-t border-kumo-line">
							<div>
								<div className="text-sm text-kumo-default font-medium">Require spam check</div>
								<div className="text-xs text-kumo-subtle mt-0.5">Run spam guard before this agent processes an email</div>
							</div>
							<Switch
								checked={guardrails.requireSpamCheck}
								onCheckedChange={(v) => setGuardrails({ ...guardrails, requireSpamCheck: v })}
							/>
						</div>
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="flex justify-between items-center pt-5 mt-2 border-t border-kumo-line">
				<div className="flex gap-1">
					{TABS.map((tab, idx) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setActiveTab(tab.id)}
							className={`w-2 h-2 rounded-full transition-colors cursor-pointer ${
								activeTab === tab.id ? "bg-kumo-brand" : "bg-kumo-line hover:bg-kumo-fill"
							}`}
							aria-label={`Go to ${tab.label} tab`}
						/>
					))}
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
					<Button variant="primary" onClick={handleSave} disabled={saving || !name.trim()}>
						{saving && <SpinnerGapIcon size={16} className="animate-spin mr-1" />}
						{initial ? "Save Changes" : "Create Agent"}
					</Button>
				</div>
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
