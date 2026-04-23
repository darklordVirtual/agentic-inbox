/**
 * Multi-provider AI factory.
 *
 * Supports: Cloudflare Workers AI (built-in), OpenAI, Anthropic, OpenRouter,
 * Google Gemini, Groq, Together AI, and any OpenAI-compatible endpoint.
 *
 * API keys are stored encrypted in R2 per-mailbox using AES-GCM.
 * The encryption key is derived from a Workers secret + mailboxId using HKDF.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel } from "ai";
import type { Env } from "../types";

// ── Provider definitions ──────────────────────────────────────────

export interface ProviderDefinition {
	id: string;
	name: string;
	description: string;
	requiresKey: boolean;
	baseUrl?: string;
	models: ModelDefinition[];
}

export interface ModelDefinition {
	id: string;
	name: string;
	contextWindow: number;
	/** Estimated cost in USD per 1M input tokens */
	costPer1MInput?: number;
	/** Estimated cost in USD per 1M output tokens */
	costPer1MOutput?: number;
	supportsTools?: boolean;
	recommended?: boolean;
}

export const PROVIDERS: ProviderDefinition[] = [
	{
		id: "cloudflare",
		name: "Cloudflare Workers AI",
		description: "Built-in AI — no API key required. Free tier included.",
		requiresKey: false,
		models: [
			{ id: "@cf/moonshotai/kimi-k2.5",              name: "Kimi K2.5",              contextWindow: 128000, supportsTools: true, recommended: true },
			{ id: "@cf/meta/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B",     contextWindow: 128000, supportsTools: true },
			{ id: "@cf/meta/llama-3.1-8b-instruct-fast",   name: "Llama 3.1 8B (fast)",    contextWindow: 8192, supportsTools: false },
			{ id: "@cf/google/gemma-3-12b-it",             name: "Gemma 3 12B",            contextWindow: 8192, supportsTools: false },
		],
	},
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT-4o, GPT-4.1, o1, o3 and more. Best tool-calling reliability.",
		requiresKey: true,
		models: [
			{ id: "gpt-4.1",      name: "GPT-4.1",          contextWindow: 1000000, supportsTools: true, recommended: true, costPer1MInput: 2,    costPer1MOutput: 8 },
			{ id: "gpt-4o",       name: "GPT-4o",           contextWindow: 128000,  supportsTools: true,                    costPer1MInput: 2.5,  costPer1MOutput: 10 },
			{ id: "gpt-4o-mini",  name: "GPT-4o mini",      contextWindow: 128000,  supportsTools: true,                    costPer1MInput: 0.15, costPer1MOutput: 0.6 },
			{ id: "o4-mini",      name: "o4-mini",          contextWindow: 200000,  supportsTools: true,                    costPer1MInput: 1.1,  costPer1MOutput: 4.4 },
		],
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Claude 3.5 / 3.7 — excellent reasoning and long-context handling.",
		requiresKey: true,
		models: [
			{ id: "claude-sonnet-4-5",     name: "Claude Sonnet 4.5",   contextWindow: 200000, supportsTools: true, recommended: true, costPer1MInput: 3,    costPer1MOutput: 15 },
			{ id: "claude-opus-4-5",       name: "Claude Opus 4.5",     contextWindow: 200000, supportsTools: true,                    costPer1MInput: 15,   costPer1MOutput: 75 },
			{ id: "claude-haiku-3-5",      name: "Claude Haiku 3.5",    contextWindow: 200000, supportsTools: true,                    costPer1MInput: 0.8,  costPer1MOutput: 4 },
		],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "One key to access 100+ models from OpenAI, Anthropic, Meta, Mistral, etc.",
		requiresKey: true,
		baseUrl: "https://openrouter.ai/api/v1",
		models: [
			{ id: "anthropic/claude-sonnet-4-5",   name: "Claude Sonnet 4.5 (via OR)",  contextWindow: 200000, supportsTools: true, recommended: true, costPer1MInput: 3,    costPer1MOutput: 15 },
			{ id: "openai/gpt-4.1",                name: "GPT-4.1 (via OR)",            contextWindow: 1000000, supportsTools: true,                   costPer1MInput: 2,    costPer1MOutput: 8 },
			{ id: "google/gemini-2.5-pro",         name: "Gemini 2.5 Pro (via OR)",     contextWindow: 1000000, supportsTools: true,                   costPer1MInput: 1.25, costPer1MOutput: 10 },
			{ id: "meta-llama/llama-4-maverick",   name: "Llama 4 Maverick (via OR)",   contextWindow: 524288, supportsTools: true,                   costPer1MInput: 0.19, costPer1MOutput: 0.85 },
			{ id: "mistralai/mistral-small-3.1",   name: "Mistral Small 3.1 (via OR)",  contextWindow: 128000, supportsTools: true,                   costPer1MInput: 0.1,  costPer1MOutput: 0.3 },
		],
	},
	{
		id: "groq",
		name: "Groq",
		description: "Ultra-fast inference. Great for high-volume, latency-sensitive tasks.",
		requiresKey: true,
		baseUrl: "https://api.groq.com/openai/v1",
		models: [
			{ id: "llama-3.3-70b-versatile",  name: "Llama 3.3 70B",     contextWindow: 128000, supportsTools: true, recommended: true, costPer1MInput: 0.59, costPer1MOutput: 0.79 },
			{ id: "llama-3.1-8b-instant",     name: "Llama 3.1 8B",      contextWindow: 128000, supportsTools: true,                   costPer1MInput: 0.05, costPer1MOutput: 0.08 },
			{ id: "mixtral-8x7b-32768",       name: "Mixtral 8x7B",      contextWindow: 32768,  supportsTools: true,                   costPer1MInput: 0.24, costPer1MOutput: 0.24 },
		],
	},
	{
		id: "together",
		name: "Together AI",
		description: "Open-source models at scale. Good for research and summarization agents.",
		requiresKey: true,
		baseUrl: "https://api.together.xyz/v1",
		models: [
			{ id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", name: "Llama 3.1 70B Turbo", contextWindow: 128000, supportsTools: true, recommended: true, costPer1MInput: 0.88, costPer1MOutput: 0.88 },
			{ id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",  name: "Llama 3.1 8B Turbo",  contextWindow: 128000, supportsTools: true,                   costPer1MInput: 0.18, costPer1MOutput: 0.18 },
		],
	},
];

export function getProvider(id: string): ProviderDefinition | undefined {
	return PROVIDERS.find((p) => p.id === id);
}

export function getModel(providerId: string, modelId: string): ModelDefinition | undefined {
	return getProvider(providerId)?.models.find((m) => m.id === modelId);
}

// ── Encrypted key storage ─────────────────────────────────────────

const KEY_R2_PREFIX = "mailboxes/providers";

function keyPath(mailboxId: string, providerId: string): string {
	return `${KEY_R2_PREFIX}/${mailboxId}/${providerId}.enc`;
}

/**
 * Derive a 256-bit AES key from the Worker secret + mailboxId using HKDF.
 * This makes each mailbox's key unique even if two mailboxes share a Worker.
 */
async function deriveEncKey(secret: string, mailboxId: string): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: enc.encode(mailboxId), info: enc.encode("provider-key-encryption") },
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/**
 * Store an API key for a provider, AES-GCM encrypted in R2.
 * The IV is stored alongside the ciphertext as a JSON envelope.
 */
export async function storeProviderKey(env: Env, mailboxId: string, providerId: string, apiKey: string): Promise<void> {
	const secret = env.SECRET ?? "dev-fallback-secret-change-in-production";
	const key = await deriveEncKey(secret, mailboxId);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const enc = new TextEncoder();
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(apiKey));
	const payload = JSON.stringify({
		iv: btoa(String.fromCharCode(...iv)),
		ct: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
	});
	await env.BUCKET.put(keyPath(mailboxId, providerId), payload, {
		httpMetadata: { contentType: "application/json" },
	});
}

/** Retrieve and decrypt a stored API key. Returns null if not found. */
export async function getProviderKey(env: Env, mailboxId: string, providerId: string): Promise<string | null> {
	const obj = await env.BUCKET.get(keyPath(mailboxId, providerId));
	if (!obj) return null;
	try {
		const { iv: ivB64, ct: ctB64 } = await obj.json<{ iv: string; ct: string }>();
		const secret = env.SECRET ?? "dev-fallback-secret-change-in-production";
		const key = await deriveEncKey(secret, mailboxId);
		const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
		const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
		const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
		return new TextDecoder().decode(plaintext);
	} catch {
		return null;
	}
}

/** Delete a stored API key. */
export async function deleteProviderKey(env: Env, mailboxId: string, providerId: string): Promise<void> {
	await env.BUCKET.delete(keyPath(mailboxId, providerId));
}

/** List which providers have keys stored for a mailbox. */
export async function listConfiguredProviders(env: Env, mailboxId: string): Promise<string[]> {
	const list = await env.BUCKET.list({ prefix: `${KEY_R2_PREFIX}/${mailboxId}/` });
	return list.objects.map((o) => o.key.replace(`${KEY_R2_PREFIX}/${mailboxId}/`, "").replace(".enc", ""));
}

// ── AI model factory ──────────────────────────────────────────────

/**
 * Create a language model instance from a provider/model/key combo.
 * Falls back to Cloudflare Workers AI if no key is available.
 */
export function createLanguageModel(
	providerId: string,
	modelId: string,
	apiKey: string | null,
	env: Env,
): LanguageModel {
	if (providerId === "cloudflare" || !apiKey) {
		const workersai = createWorkersAI({ binding: env.AI });
		return workersai(modelId as Parameters<ReturnType<typeof createWorkersAI>>[0]);
	}

	const providerDef = getProvider(providerId);

	switch (providerId) {
		case "anthropic": {
			const anthropic = createAnthropic({ apiKey });
			return anthropic(modelId as Parameters<ReturnType<typeof createAnthropic>>[0]);
		}
		case "openai": {
			const openai = createOpenAI({ apiKey });
			return openai(modelId as Parameters<ReturnType<typeof createOpenAI>>[0]);
		}
		default: {
			// OpenRouter, Groq, Together, and any OpenAI-compatible endpoint
			const openai = createOpenAI({
				apiKey,
				baseURL: providerDef?.baseUrl,
				...(providerId === "openrouter" ? {
					defaultHeaders: {
						"HTTP-Referer": "https://agentic-inbox.workers.dev",
						"X-Title": "Agentic Inbox",
					},
				} : {}),
			});
			return openai(modelId as Parameters<ReturnType<typeof createOpenAI>>[0]);
		}
	}
}
