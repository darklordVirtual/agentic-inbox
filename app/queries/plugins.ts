import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

// ── Types ─────────────────────────────────────────────────────────

export interface PluginInfo {
	id: string;
	name: string;
	version: string;
	description: string;
	enabled: boolean;
}

export interface ProviderInfo {
	id: string;
	name: string;
	description: string;
	requiresKey: boolean;
	hasKey: boolean;
	models: Array<{
		id: string;
		name: string;
		contextWindow: number;
		costPer1MInput?: number;
		costPer1MOutput?: number;
		supportsTools?: boolean;
		recommended?: boolean;
	}>;
}

// ── API helpers ───────────────────────────────────────────────────

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

// ── Plugins ───────────────────────────────────────────────────────

export function usePlugins(mailboxId: string | undefined) {
	return useQuery<{ plugins: PluginInfo[] }>({
		queryKey: mailboxId ? queryKeys.plugins.list(mailboxId) : ["plugins", "_disabled"],
		queryFn: () => apiFetch(`/api/v1/mailboxes/${encodeURIComponent(mailboxId!)}/plugins`),
		enabled: !!mailboxId,
	});
}

export function useTogglePlugin(mailboxId: string | undefined) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) =>
			apiFetch(`/api/v1/mailboxes/${encodeURIComponent(mailboxId!)}/plugins/${pluginId}`, {
				method: "PUT",
				body: JSON.stringify({ enabled }),
			}),
		onSuccess: () => {
			if (mailboxId) qc.invalidateQueries({ queryKey: queryKeys.plugins.list(mailboxId) });
		},
	});
}

// ── Providers ─────────────────────────────────────────────────────

export function useProviders(mailboxId: string | undefined) {
	return useQuery<{ providers: ProviderInfo[] }>({
		queryKey: mailboxId ? queryKeys.plugins.providers(mailboxId) : ["providers", "_disabled"],
		queryFn: () => apiFetch(`/api/v1/mailboxes/${encodeURIComponent(mailboxId!)}/providers`),
		enabled: !!mailboxId,
	});
}

export function useSaveProviderKey(mailboxId: string | undefined) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ providerId, apiKey }: { providerId: string; apiKey: string }) =>
			apiFetch(`/api/v1/mailboxes/${encodeURIComponent(mailboxId!)}/providers/${providerId}`, {
				method: "PUT",
				body: JSON.stringify({ apiKey }),
			}),
		onSuccess: () => {
			if (mailboxId) qc.invalidateQueries({ queryKey: queryKeys.plugins.providers(mailboxId) });
		},
	});
}

export function useDeleteProviderKey(mailboxId: string | undefined) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ providerId }: { providerId: string }) =>
			apiFetch(`/api/v1/mailboxes/${encodeURIComponent(mailboxId!)}/providers/${providerId}`, {
				method: "DELETE",
			}),
		onSuccess: () => {
			if (mailboxId) qc.invalidateQueries({ queryKey: queryKeys.plugins.providers(mailboxId) });
		},
	});
}
