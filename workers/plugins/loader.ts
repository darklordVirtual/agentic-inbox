/**
 * Plugin loader / registry.
 *
 * Usage in workers/index.ts:
 *   import { pluginRegistry } from "./plugins/loader";
 *   pluginRegistry.register(debtControlPlugin);
 *   pluginRegistry.mountRoutes(app);   // mounts /api/plugins/...
 */

import { Hono } from "hono";
import type { InboxPlugin, PluginContext, OnEmailReceivedPayload, OnMessageOpenedPayload, OnSyncRequestPayload } from "./types";
import type { MailboxContext } from "../lib/mailbox";
import { applyMigrations } from "../durableObject/migrations";

class PluginRegistry {
	private plugins: Map<string, InboxPlugin> = new Map();

	register(plugin: InboxPlugin): void {
		if (this.plugins.has(plugin.manifest.id)) {
			console.warn(`[plugins] Plugin "${plugin.manifest.id}" already registered, skipping.`);
			return;
		}
		this.plugins.set(plugin.manifest.id, plugin);
		console.log(`[plugins] Registered plugin: ${plugin.manifest.id} v${plugin.manifest.version}`);
	}

	/**
	 * Apply all plugin migrations to the given SQL storage.
	 * Safe to call on every DO constructor — migration runner is idempotent.
	 */
	applyMigrations(sql: SqlStorage, storage?: DurableObjectStorage): void {
		for (const plugin of this.plugins.values()) {
			if (plugin.migrations && plugin.migrations.length > 0) {
				applyMigrations(sql, plugin.migrations, storage);
			}
		}
	}

	/** Mount each plugin's routes under /api/v1/mailboxes/:mailboxId/api/plugins/:pluginId/. */
	mountRoutes(app: Hono<MailboxContext>): void {
		for (const plugin of this.plugins.values()) {
			if (!plugin.registerRoutes) continue;
			const sub = new Hono<MailboxContext>();
			plugin.registerRoutes(sub);
			// Mount under the per-mailbox prefix so requireMailbox middleware applies
			const prefix = `/api/v1/mailboxes/:mailboxId/api/plugins/${plugin.manifest.id}`;
			app.route(prefix, sub);
			console.log(`[plugins] Mounted routes for: ${plugin.manifest.id} at ${prefix}`);
		}
	}

	// ── Hook dispatchers ─────────────────────────────────────────────

	async dispatchEmailReceived(
		payload: OnEmailReceivedPayload,
		ctx: PluginContext,
	): Promise<void> {
		for (const plugin of this.plugins.values()) {
			if (plugin.onEmailReceived) {
				try {
					await plugin.onEmailReceived(payload, ctx);
				} catch (err) {
					console.error(`[plugins] onEmailReceived error in "${plugin.manifest.id}":`, err);
				}
			}
		}
	}

	async dispatchMessageOpened(
		payload: OnMessageOpenedPayload,
		ctx: PluginContext,
	): Promise<void> {
		for (const plugin of this.plugins.values()) {
			if (plugin.onMessageOpened) {
				try {
					await plugin.onMessageOpened(payload, ctx);
				} catch (err) {
					console.error(`[plugins] onMessageOpened error in "${plugin.manifest.id}":`, err);
				}
			}
		}
	}

	async dispatchSyncRequest(
		payload: OnSyncRequestPayload,
		ctx: PluginContext,
	): Promise<void> {
		for (const plugin of this.plugins.values()) {
			if (plugin.onSyncRequest) {
				try {
					await plugin.onSyncRequest(payload, ctx);
				} catch (err) {
					console.error(`[plugins] onSyncRequest error in "${plugin.manifest.id}":`, err);
				}
			}
		}
	}

	async dispatchInit(ctx: PluginContext): Promise<void> {
		for (const plugin of this.plugins.values()) {
			if (plugin.onInit) {
				try {
					await plugin.onInit(ctx);
				} catch (err) {
					console.error(`[plugins] onInit error in "${plugin.manifest.id}":`, err);
				}
			}
		}
	}

	getAll(): InboxPlugin[] {
		return Array.from(this.plugins.values());
	}
}

export interface DurableObjectStorage {
	transactionSync: <T>(closure: () => T) => T;
}

/** Singleton registry — import this everywhere. */
export const pluginRegistry = new PluginRegistry();
