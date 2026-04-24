/**
 * Hook: onEmailReceived
 *
 * Triggered after each new email is stored. Extracts text from any PDF
 * attachments, classifies the email (with AI fallback when regex is
 * inconclusive), and creates/updates a DebtCase if relevant.
 */

import type { OnEmailReceivedPayload, PluginContext } from "../../../workers/plugins/types";
import { extractPdfText, buildAttachmentKey } from "../../../workers/lib/pdf";
import { classifyEmail, classifyEmailWithAI } from "../domain/classification-engine";
import { processEmail } from "../domain/case-engine";
import { runLegalityChecks } from "../domain/legality-engine";
import { documentsRepo } from "../storage/repos/documents.repo";
import { eventsRepo } from "../storage/repos/events.repo";
import { findingsRepo } from "../storage/repos/findings.repo";
import { settingsRepo } from "../storage/repos/settings.repo";

const RELEVANT_KINDS = new Set([
	// Legacy kinds
	"initial_demand",
	"reminder",
	"collection_notice",
	"collection_demand",
	"legal_notice",
	"court_letter",
	"payment_confirmation",
	// New Norwegian-specific kinds
	"inkassovarsel",
	"betalingsoppfordring",
	"betalingspaaminnelse",
	"restbeloep",
	"informasjon_om_krav",
	"langtidsoppfoelging",
	"sammenslaaing",
	"betalingsbekreftelse",
	"avslutningsbrev",
	"redusert_oppgjoer",
	"innsigelse_besvart",
	"kravspesifikasjon",
	"ticket_timeline",
]);

/** Minimum regex confidence below which we ask the AI to classify instead. */
const AI_FALLBACK_THRESHOLD = 0.45;

export async function onEmailReceived(
	payload: OnEmailReceivedPayload,
	ctx: PluginContext,
): Promise<void> {
	const settings = settingsRepo.get(ctx.sql);
	if (!settings.enabled || !settings.autoClassify) return;

	// ── 1. Extract text from PDF attachments ────────────────────────
	const pdfTexts: string[] = [];
	const pdfAttachmentIds: string[] = [];

	for (const att of payload.attachments) {
		const lowerName = att.filename.toLowerCase();
		const isPdf =
			att.mimetype === "application/pdf" ||
			att.mimetype === "application/octet-stream" && lowerName.endsWith(".pdf") ||
			lowerName.endsWith(".pdf");

		if (isPdf) {
			const key = buildAttachmentKey(payload.emailId, att.id, att.filename);
			const text = await extractPdfText(ctx.env.BUCKET, key);
			if (text) {
				pdfTexts.push(text);
				pdfAttachmentIds.push(att.id);
				console.log(`[debt-control] Extracted ${text.length} chars from PDF: ${att.filename}`);
			} else {
				console.warn(`[debt-control] PDF extraction returned no text for: ${att.filename} (may be scanned/image-only)`);
			}
		}
	}

	// ── 2. Classify using deterministic rules ────────────────────────
	let classification = classifyEmail(payload.subject, payload.body ?? "", pdfTexts);

	// ── 3. AI fallback when regex confidence is too low ──────────────
	if (classification.confidence < AI_FALLBACK_THRESHOLD) {
		console.log(`[debt-control] Low regex confidence (${classification.confidence}), trying AI classification`);
		const aiResult = await classifyEmailWithAI(
			ctx.env.AI,
			payload.subject,
			payload.body ?? "",
			pdfTexts,
		);
		if (aiResult && aiResult.confidence > classification.confidence) {
			classification = aiResult;
		}
	}

	// Only process email kinds that are relevant to debt
	if (!RELEVANT_KINDS.has(classification.kind)) return;

	// ── 4. Create/update case and document ──────────────────────────
	const result = processEmail(ctx.sql, {
		emailId:           payload.emailId,
		mailboxId:         ctx.mailboxId,
		classification,
		bodyText:          payload.body ?? "",
		attachmentTexts:   pdfTexts,
		attachmentIds:     pdfAttachmentIds,
		attachmentFileNames: payload.attachments
			.filter((a) => a.mimetype === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf"))
			.map((a) => a.filename),
		emailDate: undefined,
	});

	// ── 5. Run finding rules and persist findings ────────────────────
	// Use ALL docs so historical checks (e.g. double-fee, payment-on-file) work
	const allDocs   = documentsRepo.findByCaseId(ctx.sql, result.case.id);
	const allEvents = eventsRepo.findByCaseId(ctx.sql, result.case.id);
	const findings  = runLegalityChecks(result.case, allDocs, allEvents);
	for (const f of findings) {
		findingsRepo.upsert(ctx.sql, f);
	}
}

