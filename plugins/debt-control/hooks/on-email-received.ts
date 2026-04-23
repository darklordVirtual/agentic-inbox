/**
 * Hook: onEmailReceived
 *
 * Triggered after each new email is stored. Classifies the email
 * and creates/updates a DebtCase if relevant.
 */

import type { OnEmailReceivedPayload, PluginContext } from "../../../workers/plugins/types";
import { classifyEmail } from "../domain/classification-engine";
import { processEmail } from "../domain/case-engine";
import { runLegalityChecks } from "../domain/legality-engine";
import { findingsRepo } from "../storage/repos/findings.repo";
import { settingsRepo } from "../storage/repos/settings.repo";

const RELEVANT_KINDS = new Set([
	"initial_demand",
	"reminder",
	"collection_notice",
	"collection_demand",
	"legal_notice",
	"court_letter",
]);

export async function onEmailReceived(
	payload: OnEmailReceivedPayload,
	ctx: PluginContext,
): Promise<void> {
	const settings = settingsRepo.get(ctx.sql);
	if (!settings.enabled || !settings.autoClassify) return;

	const classification = classifyEmail(payload.subject, payload.body ?? "");

	// Only process email kinds that are relevant to debt
	if (!RELEVANT_KINDS.has(classification.kind)) return;

	const result = processEmail(ctx.sql, {
		emailId:       payload.emailId,
		mailboxId:     ctx.mailboxId,
		classification,
		bodyText:      payload.body ?? "",
	});

	// Run legality checks and persist findings
	const docs     = [result.document];
	const findings = runLegalityChecks(result.case, docs);
	for (const f of findings) {
		findingsRepo.upsert(ctx.sql, f);
	}
}
