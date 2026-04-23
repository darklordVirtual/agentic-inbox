import { Badge, Button, Input, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	PlugsIcon,
	KeyIcon,
	EyeIcon,
	EyeSlashIcon,
	CheckIcon,
	XIcon,
	TrashIcon,
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
			<div className="flex items-center gap-2">
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
		<div className="flex items-center gap-2">
			{!provider.hasKey && (
				<Badge variant="secondary">
					<XIcon size={12} className="mr-1" />
					No key
				</Badge>
			)}
			{(editing || !provider.hasKey) && (
				<>
					<div className="relative">
						<Input
							type={showKey ? "text" : "password"}
							placeholder={`sk-...`}
							value={key}
							onChange={(e) => setKey(e.target.value)}
							className="w-64 font-mono text-sm"
						/>
						<button
							type="button"
							onClick={() => setShowKey((s) => !s)}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-kumo-subtle hover:text-kumo-default"
						>
							{showKey ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
						</button>
					</div>
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
				</>
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
		<div className="max-w-3xl mx-auto py-10 px-6 space-y-10">
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
							<div key={plugin.id} className="flex items-center justify-between px-4 py-4 bg-kumo-surface">
								<div>
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
							<div key={provider.id} className="px-4 py-4 bg-kumo-surface">
								<div className="flex items-start justify-between gap-4">
									<div>
										<div className="font-medium text-kumo-default">{provider.name}</div>
										<div className="text-sm text-kumo-subtle mt-0.5">{provider.description}</div>
										<div className="text-xs text-kumo-subtle mt-1">
											{provider.models.length} model{provider.models.length !== 1 ? "s" : ""} available
											{provider.models.some((m) => m.recommended) && (
												<span className="ml-2 text-emerald-600">
													· Recommended: {provider.models.find((m) => m.recommended)?.name}
												</span>
											)}
										</div>
									</div>
									<div className="shrink-0">
										{mailboxId && (
											<ProviderKeyForm provider={provider} mailboxId={mailboxId} />
										)}
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
