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

/**
 * Parse a Norwegian-formatted amount string.
 * Handles "1.234,56" (dot=thousands, comma=decimal) and "1234.56" (international).
 */
function parseNorwegianAmount(raw: string): number | null {
	const s = raw.replace(/\s/g, "");
	// If there's both a dot and a comma, dot is thousands separator, comma is decimal
	// e.g. "1.234,56" → "1234.56"
	// If there's only a dot: could be thousands ("1.234") or decimal ("1234.56") —
	// treat as decimal only if there are exactly 2 digits after the dot.
	if (s.includes(".") && s.includes(",")) {
		const normalised = s.replace(/\./g, "").replace(",", ".");
		const val = Number(normalised);
		return Number.isFinite(val) ? val : null;
	}
	// Only comma: comma is decimal separator ("1234,56" or "1.234,56" already handled above)
	if (s.includes(",") && !s.includes(".")) {
		const normalised = s.replace(",", ".");
		const val = Number(normalised);
		return Number.isFinite(val) ? val : null;
	}
	const val = Number(s);
	return Number.isFinite(val) ? val : null;
}

function extractAmount(text: string): number | null {
	let m = AMOUNT_PATTERN.exec(text);
	if (!m) m = AMOUNT_PLAIN.exec(text);
	if (!m) return null;
	return parseNorwegianAmount(m[1]);
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

/**
 * Classify an email using deterministic text patterns.
 *
 * @param subject - The email subject line.
 * @param body    - The email body (plain text or HTML stripped).
 * @param attachmentTexts - Optional extracted text from PDF/document attachments.
 *                          These are concatenated into the classification corpus,
 *                          so KID numbers, amounts, and creditor names in attached
 *                          invoices are also matched.
 */
export function classifyEmail(
	subject: string,
	body: string,
	attachmentTexts?: string[],
): ClassificationResult {
	const combined = [subject, body, ...(attachmentTexts ?? [])].join("\n");

	let matchedKind: DocumentKind = "unknown";
	let matchedPatterns = 0;

	for (const rule of RULES) {
		const hits = rule.patterns.filter((p) => p.test(combined));
		if (hits.length > matchedPatterns) {
			matchedPatterns = hits.length;
			matchedKind = rule.kind;
		}
	}

	// Use all available text for field extraction so values inside PDFs are found
	const amountDue = extractAmount(combined);
	const dueDate   = extractDueDate(combined);
	const reference = extractReference(combined);
	const creditor  = extractCreditor(subject, combined);

	// Confidence: based on pattern hits (0.3 base + 0.15 per hit, max 1)
	const confidence = matchedKind === "unknown"
		? 0
		: Math.min(0.3 + matchedPatterns * 0.15, 1);

	const sourceSuffix = (attachmentTexts?.length ?? 0) > 0
		? " (including attachment text)"
		: "";

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
			: `Matched ${matchedPatterns} pattern(s) for kind "${matchedKind}"${sourceSuffix}.`,
	};
}

// ── AI classification fallback ─────────────────────────────────

const VALID_KINDS = new Set<DocumentKind>([
	"initial_demand",
	"reminder",
	"collection_notice",
	"collection_demand",
	"legal_notice",
	"court_letter",
	"debt_settlement",
	"payment_confirmation",
	"unknown",
]);

const AI_CLASSIFY_PROMPT = `Du er et klassifiseringssystem for norske gjeldsdokumenter.
Analyser teksten nedenfor og klassifiser dokumentet som én av følgende verdier:

initial_demand    - Første kravbrev eller faktura
reminder          - Purring eller betalingspåminnelse
collection_notice - Inkassovarsel
collection_demand - Inkassokrav
legal_notice      - Rettslig varsel
court_letter      - Stevning eller forliksklage
debt_settlement   - Gjeldsforlik eller nedbetalingsavtale
payment_confirmation - Betalingsbekreftelse eller kvittering
unknown           - Ingen av de over

Svar KUN med ett av disse ordene. Ingen forklaring.`;

/**
 * AI-powered classification fallback.
 *
 * Called when regex confidence is too low to make a reliable determination
 * (e.g. the email body is sparse but the PDF contains the relevant contents).
 * Returns a ClassificationResult with confidence 0.65, or null on failure.
 */
export async function classifyEmailWithAI(
	ai: Ai,
	subject: string,
	body: string,
	attachmentTexts?: string[],
): Promise<ClassificationResult | null> {
	const corpus = [subject, body, ...(attachmentTexts ?? [])]
		.join("\n")
		.slice(0, 3000);

	if (corpus.trim().length < 20) return null;

	try {
		const response = (await ai.run(
			// @ts-expect-error — model string not in generated union
			"@cf/meta/llama-3.1-8b-instruct-fast",
			{
				messages: [
					{ role: "system", content: AI_CLASSIFY_PROMPT },
					{ role: "user",   content: corpus },
				],
				max_tokens: 20,
				temperature: 0,
			},
		)) as { response?: string };

		const raw = (response?.response ?? "").trim().toLowerCase() as DocumentKind;
		if (!VALID_KINDS.has(raw) || raw === "unknown") return null;

		// Re-run field extraction on the full corpus with the AI-determined kind
		const combined = [subject, body, ...(attachmentTexts ?? [])].join("\n");
		return {
			kind:        raw,
			creditor:    extractCreditor(subject, combined),
			reference:   extractReference(combined),
			amountDue:   extractAmount(combined),
			currency:    "NOK",
			dueDate:     extractDueDate(combined),
			confidence:  0.65,
			reasoning:   `AI classification: "${raw}" (regex was inconclusive).`,
		};
	} catch {
		return null;
	}
}
