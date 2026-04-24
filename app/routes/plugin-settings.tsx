import { Badge, Button, Input, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	PlugsIcon,
	KeyIcon,
	EyeIcon,
	EyeSlashIcon,
	CheckIcon,
	XIcon,
	TrashIcon,
	CaretDownIcon,
	CaretUpIcon,
	StarIcon,
	WrenchIcon,
	CpuIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import {
	usePlugins,
	useTogglePlugin,
	useProviders,
	useSaveProviderKey,
	useDeleteProviderKey,
	type ProviderInfo,
} from "~/queries/plugins";

// ── Provider key form ─────────────────────────────────────────────

function ProviderKeyForm({
	provider,
	mailboxId,
}: {
	provider: ProviderInfo;
	mailboxId: string;
}) {
	const [key, setKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [editing, setEditing] = useState(false);
	const toastManager = useKumoToastManager();
	const saveKey = useSaveProviderKey(mailboxId);
	const deleteKey = useDeleteProviderKey(mailboxId);

	const handleSave = async () => {
		if (!key.trim()) return;
		try {
			await saveKey.mutateAsync({ providerId: provider.id, apiKey: key.trim() });
			toastManager.add({ title: `${provider.name} API key saved` });
			setKey("");
			setEditing(false);
		} catch {
			toastManager.add({ title: "Failed to save API key", variant: "error" });
		}
	};

	const handleDelete = async () => {
		try {
			await deleteKey.mutateAsync({ providerId: provider.id });
			toastManager.add({ title: `${provider.name} API key removed` });
		} catch {
			toastManager.add({ title: "Failed to remove API key", variant: "error" });
		}
	};

	if (!provider.requiresKey) {
		return (
			<div className="flex items-center gap-2">
				<Badge variant="success">Built-in — no key required</Badge>
			</div>
		);
	}

	if (provider.hasKey && !editing) {
		return (
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="success">
					<CheckIcon size={12} className="mr-1" />
					Key configured
				</Badge>
				<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
					Replace
				</Button>
				<Button
					variant="ghost"
					size="sm"
					icon={<TrashIcon size={14} />}
					onClick={handleDelete}
					disabled={deleteKey.isPending}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{(editing || !provider.hasKey) && (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
					<div className="relative min-w-0 flex-1">
						<Input
							type={showKey ? "text" : "password"}
							placeholder="Paste your API key here…"
							value={key}
							onChange={(e) => setKey(e.target.value)}
							className="w-full font-mono text-sm pr-9"
						/>
						<button
							type="button"
							onClick={() => setShowKey((s) => !s)}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-kumo-subtle hover:text-kumo-default"
						>
							{showKey ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
						</button>
					</div>
					<div className="flex flex-wrap items-center gap-2 sm:shrink-0">
						<Button
							variant="primary"
							size="sm"
							onClick={handleSave}
							disabled={!key.trim() || saveKey.isPending}
						>
							Save
						</Button>
						{editing && (
							<Button variant="ghost" size="sm" onClick={() => { setEditing(false); setKey(""); }}>
								Cancel
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Main route ────────────────────────────────────────────────────

export default function PluginSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();

	const { data: pluginsData, isLoading: pluginsLoading } = usePlugins(mailboxId);
	const { data: providersData, isLoading: providersLoading } = useProviders(mailboxId);
	const togglePlugin = useTogglePlugin(mailboxId);

	const handleToggle = async (pluginId: string, enabled: boolean) => {
		try {
			await togglePlugin.mutateAsync({ pluginId, enabled });
			toastManager.add({ title: enabled ? "Plugin enabled" : "Plugin disabled" });
		} catch {
			toastManager.add({ title: "Failed to update plugin", variant: "error" });
		}
	};

	return (
		<div className="mx-auto w-full max-w-5xl py-8 px-4 space-y-10 sm:px-6 lg:px-8">
			<div>
				<h1 className="text-2xl font-bold text-kumo-default flex items-center gap-2">
					<PlugsIcon size={24} />
					Plugins & Providers
				</h1>
				<p className="text-kumo-subtle mt-1 text-sm">
					Enable or disable plugins, and configure AI provider API keys.
				</p>
			</div>

			{/* ── Plugins ── */}
			<section>
				<h2 className="text-base font-semibold text-kumo-default mb-4">Installed Plugins</h2>
				{pluginsLoading ? (
					<div className="text-kumo-subtle text-sm">Loading plugins…</div>
				) : (
					<div className="divide-y divide-kumo-line border border-kumo-line rounded-lg overflow-hidden">
						{(pluginsData?.plugins ?? []).map((plugin) => (
							<div key={plugin.id} className="flex flex-col gap-3 px-4 py-4 bg-kumo-surface sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0">
									<div className="font-medium text-kumo-default">{plugin.name}</div>
									<div className="text-sm text-kumo-subtle mt-0.5">{plugin.description}</div>
									<Badge variant="secondary" className="mt-1 text-xs">{plugin.version}</Badge>
								</div>
								<Switch
									checked={plugin.enabled}
									onCheckedChange={(checked) => handleToggle(plugin.id, checked)}
									disabled={togglePlugin.isPending}
								/>
							</div>
						))}
						{(pluginsData?.plugins ?? []).length === 0 && (
							<div className="px-4 py-6 text-sm text-kumo-subtle text-center">No plugins installed</div>
						)}
					</div>
				)}
			</section>

			{/* ── AI Providers ── */}
			<section>
				<h2 className="text-base font-semibold text-kumo-default mb-1 flex items-center gap-2">
					<KeyIcon size={18} />
					AI Provider Keys
				</h2>
				<p className="text-sm text-kumo-subtle mb-4">
					Keys are encrypted with AES-256 and stored per-mailbox. They are never returned to the browser after saving.
				</p>
				{providersLoading ? (
					<div className="text-kumo-subtle text-sm">Loading providers…</div>
				) : (
					<div className="divide-y divide-kumo-line border border-kumo-line rounded-lg overflow-hidden">
						{(providersData?.providers ?? []).map((provider) => (
							<ProviderCard
								key={provider.id}
								provider={provider}
								mailboxId={mailboxId}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	);
}

// ── Provider card with expandable model list ──────────────────────

function ProviderCard({
	provider,
	mailboxId,
}: {
	provider: ProviderInfo;
	mailboxId: string | undefined;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="px-4 py-4 bg-kumo-surface space-y-3">
			{/* Provider name + badges + description */}
			<div>
				<div className="flex items-center gap-2 flex-wrap">
					<span className="font-medium text-kumo-default">{provider.name}</span>
					{!provider.requiresKey && (
						<Badge variant="success" className="text-xs">No key required</Badge>
					)}
					{provider.requiresKey && provider.hasKey && (
						<Badge variant="success" className="text-xs">
							<CheckIcon size={10} className="mr-1" />
							Key set
						</Badge>
					)}
					{provider.requiresKey && !provider.hasKey && (
						<Badge variant="secondary" className="text-xs">No key</Badge>
					)}
				</div>
				<div className="text-sm text-kumo-subtle mt-0.5">{provider.description}</div>
				<button
					type="button"
					onClick={() => setExpanded((x) => !x)}
					className="text-xs text-kumo-brand hover:text-kumo-brand-hover flex items-center gap-1 mt-1 cursor-pointer"
				>
					{expanded ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />}
					{provider.models.length} model{provider.models.length !== 1 ? "s" : ""}
					{provider.models.some((m) => m.recommended) && !expanded && (
						<span className="ml-1 text-emerald-600">
							· Recommended: {provider.models.find((m) => m.recommended)?.name}
						</span>
					)}
				</button>
			</div>

			{/* Key form — full width underneath */}
			{mailboxId && (
				<ProviderKeyForm provider={provider} mailboxId={mailboxId} />
			)}

			{/* Expandable model list */}
			{expanded && (
				<div className="mt-3 rounded-lg border border-kumo-line overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full min-w-[640px] text-xs">
						<thead className="bg-kumo-tint border-b border-kumo-line">
							<tr>
								<th className="text-left px-3 py-2 font-medium text-kumo-subtle">Model</th>
								<th className="text-left px-3 py-2 font-medium text-kumo-subtle">Context</th>
								<th className="text-left px-3 py-2 font-medium text-kumo-subtle">Input $/1M</th>
								<th className="text-left px-3 py-2 font-medium text-kumo-subtle">Output $/1M</th>
								<th className="text-left px-3 py-2 font-medium text-kumo-subtle">Tools</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-kumo-line">
							{provider.models.map((m) => (
								<tr key={m.id} className={m.recommended ? "bg-emerald-50/40" : "bg-kumo-surface"}>
									<td className="px-3 py-2">
										<div className="flex items-center gap-1.5">
											{m.recommended && <StarIcon size={11} weight="fill" className="text-amber-500" />}
											<span className="font-medium text-kumo-default">{m.name}</span>
										</div>
										<div className="text-kumo-subtle font-mono mt-0.5" style={{ fontSize: "10px" }}>{m.id}</div>
									</td>
									<td className="px-3 py-2 text-kumo-subtle">
										{m.contextWindow >= 1000000
											? `${(m.contextWindow / 1000000).toFixed(0)}M`
											: m.contextWindow >= 1000
											? `${(m.contextWindow / 1000).toFixed(0)}K`
											: m.contextWindow}
									</td>
									<td className="px-3 py-2 text-kumo-subtle">
										{m.costPer1MInput != null ? `$${m.costPer1MInput}` : <span className="text-emerald-600">Free</span>}
									</td>
									<td className="px-3 py-2 text-kumo-subtle">
										{m.costPer1MOutput != null ? `$${m.costPer1MOutput}` : <span className="text-emerald-600">Free</span>}
									</td>
									<td className="px-3 py-2">
										{m.supportsTools ? (
											<span className="text-emerald-600 flex items-center gap-1">
												<WrenchIcon size={11} /> Yes
											</span>
										) : (
											<span className="text-kumo-subtle">No</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
						</table>
					</div>
					<div className="px-3 py-2 bg-kumo-tint/50 text-xs text-kumo-subtle border-t border-kumo-line flex items-center gap-1">
						<CpuIcon size={12} />
						Select a model when creating or editing an agent in the AI Agents section.
					</div>
				</div>
			)}
		</div>
	);
}
