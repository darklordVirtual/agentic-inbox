/**
 * Plugin contract for Agentic Inbox.
 *
 * Every plugin must export a default value conforming to InboxPlugin.
 * The plugin loader discovers and wires plugins at startup without
 * requiring changes to core code.
 */

import type { Hono } from "hono";
import type { Migration } from "../durableObject/migrations";
import type { MailboxContext } from "../lib/mailbox";

// ── Shared context passed to every plugin hook / handler ──────────

export interface PluginContext {
	/** The mailbox this event belongs to (e.g. "user@example.com"). */
	mailboxId: string;
	/** Raw SQL access to the per-mailbox Durable Object storage. */
	sql: SqlStorage;
	/** Cloudflare environment bindings (secrets, R2, AI, etc.). */
	env: Cloudflare.Env;
}

// ── Hooks ─────────────────────────────────────────────────────────

export interface OnEmailReceivedPayload {
	emailId: string;
	subject: string;
	sender: string;
	recipient: string;
	body: string | null;
	date: string;
	attachmentIds: string[];
}

export interface OnMessageOpenedPayload {
	emailId: string;
	mailboxId: string;
}

export interface OnSyncRequestPayload {
	mailboxId: string;
}

// ── Plugin settings schema ─────────────────────────────────────────

/** A JSON-Schema-compatible description of a single setting field. */
export interface PluginSettingField {
	type: "string" | "number" | "boolean" | "secret";
	label: string;
	description?: string;
	default?: unknown;
	required?: boolean;
}

export type PluginSettingsSchema = Record<string, PluginSettingField>;

// ── Plugin manifest ────────────────────────────────────────────────

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	/** Schema that describes the configurable settings for this plugin. */
	settingsSchema?: PluginSettingsSchema;
}

// ── Plugin interface ───────────────────────────────────────────────

export interface InboxPlugin {
	manifest: PluginManifest;

	/**
	 * SQLite migrations to run inside the mailbox Durable Object.
	 * Applied once, in order, using the core migration runner.
	 */
	migrations?: Migration[];

	/**
	 * Register Hono API routes under /api/plugins/:pluginId/.
	 * The Hono app passed here is already scoped to that prefix.
	 */
	registerRoutes?: (app: Hono<MailboxContext>) => void;

	// ── Lifecycle hooks ────────────────────────────────────────────

	/** Called after a new email is stored in the mailbox. */
	onEmailReceived?: (
		payload: OnEmailReceivedPayload,
		ctx: PluginContext,
	) => Promise<void>;

	/** Called when the user opens a message. */
	onMessageOpened?: (
		payload: OnMessageOpenedPayload,
		ctx: PluginContext,
	) => Promise<void>;

	/** Called when a manual sync is requested (e.g. bank sync). */
	onSyncRequest?: (
		payload: OnSyncRequestPayload,
		ctx: PluginContext,
	) => Promise<void>;

	/** Called once when the plugin is first activated for a mailbox. */
	onInit?: (ctx: PluginContext) => Promise<void>;
}
