/**
 * Legality engine — deterministic rule checks.
 *
 * Inspects a case and its documents to produce Finding records.
 * Side-effect free: returns findings without writing to storage.
 */

import type { DebtCase, DebtDocument, Finding, FindingCode } from "../types";

interface FindingInput {
	severity: Finding["severity"];
	code: FindingCode;
	description: string;
}

function finding(
	caseId: string,
	code: FindingCode,
	severity: Finding["severity"],
	description: string,
): Omit<Finding, "id" | "detectedAt"> {
	return { caseId, code, severity, description };
}

/**
 * Run all legality checks against a case and its documents.
 * Returns an array of findings (may be empty).
 */
export function runLegalityChecks(
	c: DebtCase,
	docs: DebtDocument[],
): Omit<Finding, "id" | "detectedAt">[] {
	const results: Omit<Finding, "id" | "detectedAt">[] = [];

	// ── 1. Payment confirmation already on file ──────────────────
	const hasPaymentConfirmation = docs.some(
		(d) => d.kind === "payment_confirmation",
	);
	if (hasPaymentConfirmation && c.status !== "paid") {
		results.push(
			finding(c.id, "POSSIBLE_ALREADY_PAID", "critical",
				"A payment confirmation exists for this case but status is not 'paid'. " +
				"Verify whether the demand has been satisfied."),
		);
	}

	// ── 2. No initial demand but collection received ─────────────
	const hasInitialDemand = docs.some(
		(d) => d.kind === "initial_demand" || d.kind === "reminder",
	);
	const hasCollection = docs.some(
		(d) => d.kind === "collection_demand" || d.kind === "collection_notice",
	);
	if (hasCollection && !hasInitialDemand) {
		results.push(
			finding(c.id, "MISSING_LEGAL_BASIS", "warning",
				"Collection demand received but no original invoice or reminder on file. " +
				"Request documentation of the underlying claim."),
		);
	}

	// ── 3. Short deadline ────────────────────────────────────────
	if (c.dueDate) {
		const days = Math.ceil(
			(new Date(c.dueDate).getTime() - Date.now()) / 86_400_000,
		);
		if (days >= 0 && days <= 3) {
			results.push(
				finding(c.id, "SHORT_DEADLINE", "critical",
					`Due date is in ${days} day(s). Immediate action required.`),
			);
		} else if (days < 0) {
			results.push(
				finding(c.id, "SHORT_DEADLINE", "critical",
					`Due date passed ${Math.abs(days)} day(s) ago.`),
			);
		}
	}

	// ── 4. Duplicate demands from same creditor ──────────────────
	// (Requires caller to pass multiple cases — skip here, handled in API)

	// ── 5. Missing sender identity in documents ──────────────────
	if (c.creditor === "Unknown creditor") {
		results.push(
			finding(c.id, "MISSING_SENDER_IDENTITY", "info",
				"Creditor could not be identified from email content. " +
				"Manual review recommended."),
		);
	}

	// ── 6. Legal notice without prior collection notice ──────────
	const hasLegalNotice = docs.some((d) => d.kind === "legal_notice" || d.kind === "court_letter");
	const hasCollectionNotice = docs.some((d) => d.kind === "collection_notice");
	if (hasLegalNotice && !hasCollectionNotice) {
		results.push(
			finding(c.id, "MISSING_LEGAL_BASIS", "critical",
				"Legal action threatened or initiated but no collection notice is stored in this mailbox. " +
				"Request documentation of prior collection steps before concluding that process rules were breached."),
		);
	}

	return results;
}

/**
 * Cross-case check: detect possible fragmentation (same creditor,
 * multiple small claims that add up).
 */
export function detectFragmentation(
	cases: DebtCase[],
	creditor: string,
): { suspected: boolean; totalAmount: number; caseIds: string[] } {
	const matching = cases.filter(
		(c) => c.creditor === creditor && c.status === "open",
	);
	if (matching.length < 2) {
		return { suspected: false, totalAmount: 0, caseIds: [] };
	}
	const totalAmount = matching.reduce((s, c) => s + (c.amountDue ?? 0), 0);
	return {
		suspected: true,
		totalAmount,
		caseIds: matching.map((c) => c.id),
	};
}
