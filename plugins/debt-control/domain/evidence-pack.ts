/**
 * Evidence pack builder.
 *
 * Assembles a structured JSON snapshot of a case for export/archiving.
 * Safe to export — does NOT include full extracted text (use rawTextHash + preview only).
 */

import type { DebtCase, DebtEvent, Finding, DebtEvidencePack, DebtInvoice } from "../types";
import { getRecommendedAction } from "./recommended-action-engine";
import { generateAllLetters } from "./letter-templates";

export function buildEvidencePack(
	debtCase: DebtCase,
	events: DebtEvent[],
	findings: Finding[],
	recipientName?: string,
): DebtEvidencePack {
	const amounts = debtCase.amounts;

	// ── Amount evolution across events ────────────────────────────
	const amountEvolution = events
		.filter((e) => e.amounts?.amountToPay != null || e.amounts?.outstanding != null)
		.map((e) => ({
			date: e.date,
			amountToPay: e.amounts?.amountToPay ?? e.amounts?.outstanding ?? null,
			source: `${e.kind} (${e.sourceFileName ?? e.sourceEmailId.slice(0, 8)})`,
		}));

	// ── Payments ──────────────────────────────────────────────────
	const payments = events
		.filter((e) => (e.amounts?.paid ?? 0) > 0)
		.map((e) => ({
			date: e.date,
			amount: e.amounts!.paid!,
			source: `${e.kind} (${e.sourceFileName ?? e.sourceEmailId.slice(0, 8)})`,
		}));

	// ── Source document refs ──────────────────────────────────────
	const sourceDocumentRefs = events.map((e) => ({
		emailId:      e.sourceEmailId,
		attachmentId: e.sourceAttachmentId,
		kind:         e.kind,
		date:         e.date,
	}));

	// ── Case summary ──────────────────────────────────────────────
	const totalEvents  = events.length;
	const latestAmount = debtCase.amountDue ?? amounts?.outstanding ?? amounts?.amountToPay;
	const caseSummary  = [
		`Sak: ${debtCase.externalCaseNo ?? debtCase.reference ?? debtCase.id}`,
		`Kreditor: ${debtCase.creditor}`,
		`Status: ${debtCase.status}`,
		`Prioritet: ${debtCase.priority}`,
		`Antall hendelser: ${totalEvents}`,
		latestAmount != null ? `Siste kjente beløp å betale: kr ${latestAmount.toFixed(2)}` : null,
		amounts?.principal != null ? `Hovedstol: kr ${amounts.principal.toFixed(2)}` : null,
		amounts?.legalCosts != null ? `Salær: kr ${amounts.legalCosts.toFixed(2)}` : null,
		debtCase.objectionDate ? `Innsigelse registrert: ${debtCase.objectionDate}` : null,
		debtCase.closedAt ? `Avsluttet: ${debtCase.closedAt}` : null,
	].filter(Boolean).join("\n");

	const recommendedAction = getRecommendedAction(debtCase, findings);
	const letterDrafts      = generateAllLetters(debtCase, recipientName);

	return {
		generatedAt:       new Date().toISOString(),
		caseSummary,
		creditor:          debtCase.creditor,
		externalCaseNo:    debtCase.externalCaseNo ?? debtCase.reference ?? null,
		invoices:          debtCase.invoices ?? [],
		timeline:          events,
		amountEvolution,
		payments,
		findings,
		recommendedAction,
		letterDrafts,
		sourceDocumentRefs,
	};
}
