/**
 * Reconciliation engine.
 *
 * Matches bank transactions to open debt cases using deterministic
 * scoring. Never auto-confirms — user must explicitly confirm a match.
 */

import type { DebtCase, BankTransaction, PaymentMatch, MatchConfidence } from "../types";
import { paymentMatchesRepo } from "../storage/repos/transactions.repo";

interface MatchScore {
	transactionId: string;
	caseId: string;
	score: number;
	reasons: string[];
}

// ── Scoring helpers ───────────────────────────────────────────────

function scoreAmount(txAmount: number, caseAmount: number | null): number {
	if (caseAmount === null) return 0;
	const diff = Math.abs(txAmount - caseAmount);
	const relative = diff / caseAmount;
	if (relative < 0.01) return 40;    // exact
	if (relative < 0.05) return 25;    // within 5%
	if (relative < 0.10) return 10;    // within 10%
	return 0;
}

function scoreDate(txDate: string, dueDate: string | null): number {
	if (!dueDate) return 0;
	const txMs  = new Date(txDate).getTime();
	const dueMs = new Date(dueDate).getTime();
	const diffDays = Math.abs(txMs - dueMs) / 86_400_000;
	if (diffDays <= 1)  return 20;
	if (diffDays <= 7)  return 12;
	if (diffDays <= 30) return 5;
	return 0;
}

function scoreReference(txRef: string | null, caseRef: string | null): number {
	if (!txRef || !caseRef) return 0;
	// Normalise: remove spaces and lowercase
	const a = txRef.replace(/\s/g, "").toLowerCase();
	const b = caseRef.replace(/\s/g, "").toLowerCase();
	if (a === b) return 30;
	if (a.includes(b) || b.includes(a)) return 20;
	return 0;
}

function scoreCounterparty(txCounterparty: string | null, creditor: string): number {
	if (!txCounterparty) return 0;
	const a = txCounterparty.toLowerCase();
	const b = creditor.toLowerCase();
	if (a.includes(b) || b.includes(a)) return 10;
	return 0;
}

/**
 * Compute a 0–100 match score between a transaction and a case.
 * The sum of maximum possible scores is: 40 + 20 + 30 + 10 = 100.
 */
function computeScore(
	tx: BankTransaction,
	c: DebtCase,
): { score: number; reasons: string[] } {
	const reasons: string[] = [];
	let total = 0;

	const amountPts = scoreAmount(tx.amount, c.amountDue);
	if (amountPts > 0) {
		total += amountPts;
		reasons.push(`amount match (${amountPts} pts)`);
	}

	const datePts = scoreDate(tx.date, c.dueDate);
	if (datePts > 0) {
		total += datePts;
		reasons.push(`date proximity (${datePts} pts)`);
	}

	const refPts = scoreReference(tx.reference, c.reference);
	if (refPts > 0) {
		total += refPts;
		reasons.push(`reference match (${refPts} pts)`);
	}

	const counterpartyPts = scoreCounterparty(tx.counterparty, c.creditor);
	if (counterpartyPts > 0) {
		total += counterpartyPts;
		reasons.push(`counterparty match (${counterpartyPts} pts)`);
	}

	return { score: total, reasons };
}

function scoreToConfidence(score: number): MatchConfidence {
	if (score >= 60) return "high";
	if (score >= 30) return "medium";
	if (score >= 10) return "low";
	return "none";
}

// ── Main reconcile function ───────────────────────────────────────

export interface ReconcileResult {
	matched: number;
	skipped: number;
}

/**
 * Run reconciliation: for every open case, try to find matching
 * transactions. Persist matches with score >= 10.
 */
export function reconcile(
	sql: SqlStorage,
	cases: DebtCase[],
	transactions: BankTransaction[],
): ReconcileResult {
	let matched = 0;
	let skipped = 0;

	// Only consider credit transactions (money going out = positive amount)
	const debitTxns = transactions.filter((t) => t.amount > 0);
	const openCases = cases.filter((c) => c.status === "open" || c.status === "disputed");

	for (const c of openCases) {
		for (const tx of debitTxns) {
			const { score, reasons } = computeScore(tx, c);
			if (score < 10) {
				skipped++;
				continue;
			}

			paymentMatchesRepo.upsert(sql, {
				caseId: c.id,
				transactionId: tx.id,
				confidence: scoreToConfidence(score),
				matchScore: score,
				matchReasons: JSON.stringify(reasons),
				confirmedAt: null,
			});
			matched++;
		}
	}

	return { matched, skipped };
}
