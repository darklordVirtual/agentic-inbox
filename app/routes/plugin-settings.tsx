import { Badge, Button, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	PlugsIcon,
	KeyIcon,
	EyeIcon,
	EyeSlashIcon,
	CheckIcon,
	TrashIcon,
	CaretDownIcon,
	CaretUpIcon,
	StarIcon,
	WrenchIcon,
	SpinnerGapIcon,
	WarningIcon,
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
			<div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
				<CheckIcon size={13} weight="bold" />
				Built-in — no key required
			</div>
		);
	}

	if (provider.hasKey && !editing) {
		return (
			<div className="flex items-center gap-2">
				<span className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
					<CheckIcon size={13} weight="bold" />
					Key configured
				</span>
				<button
					type="button"
					onClick={() => setEditing(true)}
					className="text-xs text-kumo-subtle hover:text-kumo-default underline underline-offset-2 cursor-pointer"
				>
					Replace
				</button>
				<button
					type="button"
					onClick={handleDelete}
					disabled={deleteKey.isPending}
					className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 cursor-pointer disabled:opacity-50"
				>
					{deleteKey.isPending ? (
						<SpinnerGapIcon size={12} className="animate-spin" />
					) : (
						<TrashIcon size={12} />
					)}
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-1.5">
			{!provider.hasKey && (
				<div className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
					<WarningIcon size={13} weight="fill" />
					API key required to use this provider
				</div>
			)}
			<div className="flex items-center gap-2">
				<div className="relative flex-1 min-w-0">
					<input
						type={showKey ? "text" : "password"}
						placeholder="Paste API key…"
						value={key}
						onChange={(e) => setKey(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleSave()}
						className="w-full rounded-md border border-kumo-line bg-kumo-bg px-3 py-1.5 pr-8 text-sm font-mono text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-accent"
					/>
					<button
						type="button"
						onClick={() => setShowKey((s) => !s)}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-kumo-subtle hover:text-kumo-default"
					>
						{showKey ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />}
					</button>
				</div>
				<Button
					variant="primary"
					size="sm"
					onClick={handleSave}
					disabled={!key.trim() || saveKey.isPending}
				>
					{saveKey.isPending ? <SpinnerGapIcon size={14} className="animate-spin" /> : "Save"}
				</Button>
				{editing && (
					<Button variant="ghost" size="sm" onClick={() => { setEditing(false); setKey(""); }}>
						Cancel
					</Button>
				)}
			</div>
		</div>
	);
}

// ── Provider card ─────────────────────────────────────────────────

function ProviderCard({
	provider,
	mailboxId,
}: {
	provider: ProviderInfo;
	mailboxId: string | undefined;
}) {
	const [modelsExpanded, setModelsExpanded] = useState(false);
	const recommended = provider.models.find((m) => m.recommended);

	return (
		<div className="px-5 py-4 bg-kumo-surface space-y-3">
			{/* Top: name + description */}
			<div>
				<div className="flex items-center gap-2 flex-wrap">
					<span className="text-sm font-semibold text-kumo-default">{provider.name}</span>
				</div>
				<p className="text-xs text-kumo-subtle mt-0.5 leading-relaxed">{provider.description}</p>
			</div>

			{/* Key form */}
			{mailboxId && (
				<ProviderKeyForm provider={provider} mailboxId={mailboxId} />
			)}

			{/* Models toggle */}
			<button
				type="button"
				onClick={() => setModelsExpanded((x) => !x)}
				className="flex items-center gap-1.5 text-xs text-kumo-subtle hover:text-kumo-default cursor-pointer transition-colors"
			>
				{modelsExpanded ? <CaretUpIcon size={11} /> : <CaretDownIcon size={11} />}
				<span>{provider.models.length} model{provider.models.length !== 1 ? "s" : ""}</span>
				{recommended && !modelsExpanded && (
					<span className="text-emerald-600 ml-1">· Recommended: {recommended.name}</span>
				)}
			</button>

			{/* Expandable model list */}
			{modelsExpanded && (
				<div className="rounded-lg border border-kumo-line overflow-hidden">
					{provider.models.map((m, idx) => (
						<div
							key={m.id}
							className={`flex items-center justify-between gap-3 px-3 py-2.5 text-xs ${
								idx > 0 ? "border-t border-kumo-line" : ""
							} ${m.recommended ? "bg-emerald-50/50" : "bg-kumo-bg"}`}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									{m.recommended && <StarIcon size={11} weight="fill" className="text-amber-500 shrink-0" />}
									<span className="font-medium text-kumo-default">{m.name}</span>
									{m.supportsTools && (
										<WrenchIcon size={10} className="text-emerald-600" />
									)}
								</div>
								<div className="text-kumo-subtle font-mono mt-0.5" style={{ fontSize: "10px" }}>{m.id}</div>
							</div>
							<div className="flex items-center gap-4 text-kumo-subtle shrink-0 text-right">
								<span>
									{m.contextWindow >= 1_000_000
										? `${(m.contextWindow / 1_000_000).toFixed(0)}M ctx`
										: `${(m.contextWindow / 1_000).toFixed(0)}K ctx`}
								</span>
								<span>
									{m.costPer1MInput != null
										? `$${m.costPer1MInput}/1M`
										: <span className="text-emerald-600">Free</span>}
								</span>
							</div>
						</div>
					))}
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
		<div className="h-full overflow-y-auto">
			<div className="max-w-2xl mx-auto py-10 px-6 space-y-10">

				{/* Header */}
				<div>
					<h1 className="text-2xl font-bold text-kumo-default flex items-center gap-2">
						<PlugsIcon size={22} />
						Plugins &amp; Providers
					</h1>
					<p className="text-sm text-kumo-subtle mt-1">
						Enable or disable plugins and configure AI provider API keys.
					</p>
				</div>

				{/* ── Installed Plugins ── */}
				<section className="space-y-3">
					<h2 className="text-sm font-semibold text-kumo-default uppercase tracking-wider">
						Installed Plugins
					</h2>
					{pluginsLoading ? (
						<div className="flex items-center gap-2 text-sm text-kumo-subtle py-4">
							<SpinnerGapIcon size={16} className="animate-spin" />
							Loading plugins…
						</div>
					) : (pluginsData?.plugins ?? []).length === 0 ? (
						<div className="rounded-lg border border-dashed border-kumo-line px-4 py-6 text-sm text-kumo-subtle text-center">
							No plugins installed
						</div>
					) : (
						<div className="rounded-lg border border-kumo-line divide-y divide-kumo-line overflow-hidden">
							{(pluginsData?.plugins ?? []).map((plugin) => (
								<div key={plugin.id} className="flex items-center justify-between gap-4 px-4 py-4 bg-kumo-surface">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-kumo-default">{plugin.name}</span>
											<Badge variant="secondary" className="text-[11px]">{plugin.version}</Badge>
										</div>
										<p className="text-xs text-kumo-subtle mt-0.5 leading-relaxed">{plugin.description}</p>
									</div>
									<Switch
										checked={plugin.enabled}
										onCheckedChange={(checked) => handleToggle(plugin.id, checked)}
										disabled={togglePlugin.isPending}
									/>
								</div>
							))}
						</div>
					)}
				</section>

				{/* ── AI Provider Keys ── */}
				<section className="space-y-3">
					<div>
						<h2 className="text-sm font-semibold text-kumo-default uppercase tracking-wider flex items-center gap-1.5">
							<KeyIcon size={14} />
							AI Provider Keys
						</h2>
						<p className="text-xs text-kumo-subtle mt-1">
							Keys are encrypted and stored per-mailbox. Never returned to the browser after saving.
						</p>
					</div>
					{providersLoading ? (
						<div className="flex items-center gap-2 text-sm text-kumo-subtle py-4">
							<SpinnerGapIcon size={16} className="animate-spin" />
							Loading providers…
						</div>
					) : (
						<div className="rounded-lg border border-kumo-line divide-y divide-kumo-line overflow-hidden">
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
		</div>
	);
}
