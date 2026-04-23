/**
 * Hook: onEmailReceived — dispatches enabled agents against each new email.
 *
 * Pipeline (in order):
 *   1. If a spam_guard agent is enabled, run it first. Block if flagged.
 *   2. Run researcher agents (fire-and-forget style, non-blocking).
 *   3. Run router agent if present — its result can annotate the email.
 *   4. Run all other enabled agents (responder, support, marketing, etc.)
 *      that have email_received in their trigger events.
 */

import type { PluginContext, OnEmailReceivedPayload } from "../../../workers/plugins/types";
import { listAgents } from "../storage/repo";
import { runAgent } from "../domain/runner";

export async function onEmailReceived(
	payload: OnEmailReceivedPayload,
	ctx: PluginContext,
): Promise<void> {
	const agents = listAgents(ctx.sql).filter((a) => a.enabled && a.trigger.events.includes("email_received"));
	if (agents.length === 0) return;

	// ── 1. Spam guard first ────────────────────────────────────────
	const spamGuards = agents.filter((a) => a.role === "spam_guard");
	for (const agent of spamGuards) {
		const result = await runAgent(agent, payload, ctx.mailboxId, ctx.sql, ctx.env);
		if (result.outcome === "spam_blocked") {
			// Spam guard blocked — skip all other agents
			return;
		}
	}

	// ── 2. Researcher agents (non-blocking) ────────────────────────
	const researchers = agents.filter((a) => a.role === "researcher");
	const researchPromises = researchers.map((agent) =>
		runAgent(agent, payload, ctx.mailboxId, ctx.sql, ctx.env).catch((_err) => {
			// Research failures are non-fatal
		}),
	);

	// ── 3. Router ──────────────────────────────────────────────────
	const routers = agents.filter((a) => a.role === "router");
	for (const agent of routers) {
		await runAgent(agent, payload, ctx.mailboxId, ctx.sql, ctx.env).catch(() => undefined);
	}

	// ── 4. Remaining agents ────────────────────────────────────────
	const remaining = agents.filter(
		(a) => a.role !== "spam_guard" && a.role !== "researcher" && a.role !== "router",
	);
	const remainingPromises = remaining.map((agent) =>
		runAgent(agent, payload, ctx.mailboxId, ctx.sql, ctx.env).catch((_err) => {
			// Non-fatal
		}),
	);

	// Await all non-blocking work
	await Promise.allSettled([...researchPromises, ...remainingPromises]);
}
