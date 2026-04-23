/**
 * Classification engine.
 *
 * Uses deterministic text patterns first, then optionally AI.
 * Returns a ClassificationResult without side effects.
 */

import type { ClassificationResult, DocumentKind } from "../types";

// ── Rule patterns ─────────────────────────────────────────────────

interface Rule {
	kind: DocumentKind;
	patterns: RegExp[];
}

const RULES: Rule[] = [
	{
		kind: "court_letter",
		patterns: [
			/forliksklage/i,
			/stevning/i,
			/\bnamsmannen\b/i,
			/\btingrett\b/i,
			/\binkassostyret\b/i,
		],
	},
	{
		kind: "legal_notice",
		patterns: [
			/rettslig\s+skritt/i,
			/rettslig\s+inndrivning/i,
			/søksmål/i,
			/utleggsforretning/i,
		],
	},
	{
		kind: "collection_demand",
		patterns: [
			/inkassokrav/i,
			/inkasso\s*krav/i,
			/inndrivning\s+av\s+krav/i,
		],
	},
	{
		kind: "collection_notice",
		patterns: [
			/inkassovarsel/i,
			/inkasso\s*varsel/i,
			/varsel\s+om\s+inkasso/i,
		],
	},
	{
		kind: "reminder",
		patterns: [
			/\bpurring\b/i,
			/purrebrev/i,
			/betalingspåminnelse/i,
			/påminnelse\s+om\s+betaling/i,
			/\breminder\b/i,
		],
	},
	{
		kind: "payment_confirmation",
		patterns: [
			/betalingsbekreftelse/i,
			/kvittering\s+for\s+betaling/i,
			/betaling\s+mottatt/i,
			/payment\s+confirmation/i,
		],
	},
	{
		kind: "debt_settlement",
		patterns: [
			/betalingsavtale/i,
			/nedbetalingsplan/i,
			/gjeldsforlik/i,
			/avdragsordning/i,
		],
	},
	{
		kind: "initial_demand",
		patterns: [
			/faktura/i,
			/krav\s+om\s+betaling/i,
			/betalingskrav/i,
			/\binvoice\b/i,
		],
	},
];

// ── Amount / date / reference extraction ─────────────────────────

const AMOUNT_PATTERN = /(?:kr\.?|nok)\s*([\d\s,.]+)/i;
const AMOUNT_PLAIN   = /\b(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?)\s*(?:kr|nok)\b/i;
const DUE_DATE_PATTERN =
	/(?:forfallsdato|forfall|betales\s+innen|due\s+date)[:\s]+(\d{1,2}[\./\-]\d{1,2}[\./\-]\d{2,4})/i;
const REFERENCE_PATTERN =
	/(?:kid|ref(?:erance)?|kontonr|krav(?:nr|nummer)?)[:\s#]*([A-Z\d\-\/]{4,30})/i;
const CREDITOR_FROM_PATTERN = /^(?:fra|from|avsender)[:\s]+(.+)/im;

function extractAmount(text: string): number | null {
	let m = AMOUNT_PATTERN.exec(text);
	if (!m) m = AMOUNT_PLAIN.exec(text);
	if (!m) return null;
	const cleaned = m[1].replace(/\s/g, "").replace(",", ".");
	const val = parseFloat(cleaned);
	return Number.isFinite(val) ? val : null;
}

function extractDueDate(text: string): string | null {
	const m = DUE_DATE_PATTERN.exec(text);
	if (!m) return null;
	// Normalise to ISO-ish "YYYY-MM-DD" when possible
	const raw = m[1].replace(/\./g, "-").replace(/\//g, "-");
	const parts = raw.split("-");
	if (parts.length === 3 && parts[2].length === 4) {
		// DD-MM-YYYY -> YYYY-MM-DD
		return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
	}
	return raw;
}

function extractReference(text: string): string | null {
	const m = REFERENCE_PATTERN.exec(text);
	return m ? m[1].trim() : null;
}

function extractCreditor(subject: string, body: string): string | null {
	// Try "From: Creditor Name" in body
	const m = CREDITOR_FROM_PATTERN.exec(body);
	if (m) return m[1].trim();
	// Fallback: first non-empty token of subject before common separators
	const s = subject.replace(/^re:|^fwd:/i, "").trim();
	const short = s.split(/[-:|]/)[0].trim();
	return short.length > 2 ? short : null;
}

// ── Main classification function ──────────────────────────────────

export function classifyEmail(
	subject: string,
	body: string,
): ClassificationResult {
	const combined = `${subject}\n${body}`;

	let matchedKind: DocumentKind = "unknown";
	let matchedPatterns = 0;

	for (const rule of RULES) {
		const hits = rule.patterns.filter((p) => p.test(combined));
		if (hits.length > matchedPatterns) {
			matchedPatterns = hits.length;
			matchedKind = rule.kind;
		}
	}

	const amountDue = extractAmount(combined);
	const dueDate = extractDueDate(combined);
	const reference = extractReference(combined);
	const creditor = extractCreditor(subject, body);

	// Confidence: based on pattern hits (0.3 base + 0.15 per hit, max 1)
	const confidence = matchedKind === "unknown"
		? 0
		: Math.min(0.3 + matchedPatterns * 0.15, 1);

	return {
		kind: matchedKind,
		creditor,
		reference,
		amountDue,
		currency: "NOK",
		dueDate,
		confidence,
		reasoning: matchedKind === "unknown"
			? "No matching patterns found."
			: `Matched ${matchedPatterns} pattern(s) for kind "${matchedKind}".`,
	};
}
