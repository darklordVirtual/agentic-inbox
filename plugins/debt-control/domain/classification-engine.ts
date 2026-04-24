/**
 * Classification engine.
 *
 * Uses deterministic text patterns first, then optionally AI as fallback.
 * Returns a ClassificationResult without side effects.
 */

import type { ClassificationResult, DocumentKind, DebtAmountBreakdown, DebtInvoice } from "../types";
import { parseNorwegianAmount } from "./amount-parser";

// ── Rule patterns ─────────────────────────────────────────────────

interface Rule {
	kind: DocumentKind;
	patterns: RegExp[];
}

/**
 * Rules ordered by specificity — most specific first.
 * The rule with the most pattern hits wins.
 */
const RULES: Rule[] = [
	// ── Rettslig / court ──────────────────────────────────────────
	{ kind: "court_letter", patterns: [/forliksklage/i, /stevning/i, /\bnamsmannen\b/i, /\btingrett\b/i] },
	{ kind: "legal_notice", patterns: [/rettslig\s+skritt/i, /rettslig\s+inndrivning/i, /søksmål/i, /utleggsforretning/i] },
	// ── Ticket / systemlogg ───────────────────────────────────────
	{ kind: "ticket_timeline", patterns: [/Ticket\s+created/i, /Rules\s+applied/i, /Puzzel\s+Contact\s+Centre/i, /Status\s+changed/i] },
	// ── Kravspesifikasjon ─────────────────────────────────────────
	{ kind: "kravspesifikasjon", patterns: [/Kravspesifikasjon/i, /Kravtype/i, /utenrettslig\s+inndrivingskostnad/i] },
	// ── Innsigelse besvart ────────────────────────────────────────
	{ kind: "innsigelse_besvart", patterns: [/viser\s+til\s+innsigelse/i, /fastholder\s+(kravet|saken)/i, /restbeløp\s+på\s+saken/i] },
	// ── Redusert oppgjør ──────────────────────────────────────────
	{ kind: "redusert_oppgjoer", patterns: [/redusert\s+oppgjør/i, /avslag\s+på\s+salæret/i, /50\s*%\s+avslag/i, /30\s*%\s+avslag/i, /tilbud\s+om\s+å\s+avslutte/i] },
	// ── Avslutningsbrev ───────────────────────────────────────────
	{ kind: "avslutningsbrev", patterns: [/Takk\s+for\s+din\s+betaling/i, /Saken\s+er\s+nå\s+avsluttet/i, /avsluttet\s+hos\s+oss/i] },
	// ── Betalingsbekreftelse ──────────────────────────────────────
	{ kind: "betalingsbekreftelse", patterns: [/betalingsbekreftelse/i, /kvittering\s+for\s+betaling/i, /betaling\s+mottatt/i, /payment\s+confirmation/i] },
	// ── Sammenslåing ──────────────────────────────────────────────
	{ kind: "sammenslaaing", patterns: [/SAMMENSLÅING/i, /slått\s+sammen/i, /sammenslåing/i] },
	// ── Langtidsoppfølging ────────────────────────────────────────
	{ kind: "langtidsoppfoelging", patterns: [/LANGTIDSOPPFØLGING/i, /\bOVERVÅK\b/i, /saken\s+overvåkes/i] },
	// ── Informasjon om krav ───────────────────────────────────────
	{ kind: "informasjon_om_krav", patterns: [/INFORMASJON\s+OM\s+KRAV/i, /VIDERE\s+PROSESS/i] },
	// ── Restbeløp ─────────────────────────────────────────────────
	{ kind: "restbeloep", patterns: [/\bRESTBELØP\b/i, /fortsatt\s+.{0,30}ikke\s+er\s+betalt/i] },
	// ── Betalingspåminnelse ───────────────────────────────────────
	{ kind: "betalingspaaminnelse", patterns: [/BETALINGSPÅMINNELSE/i, /\bpurring\b/i, /purrebrev/i, /påminnelse\s+om\s+betaling/i] },
	// ── Betalingsoppfordring ──────────────────────────────────────
	{ kind: "betalingsoppfordring", patterns: [/BETALINGSOPPFORDRING/i, /inkassokrav/i, /inndrivning\s+av\s+krav/i] },
	// ── Inkassovarsel ─────────────────────────────────────────────
	{ kind: "inkassovarsel", patterns: [/INKASSOVARSEL/i, /inkassovarsel/i, /varsel\s+om\s+inkasso/i] },
	// ── Debt settlement ───────────────────────────────────────────
	{ kind: "debt_settlement", patterns: [/betalingsavtale/i, /nedbetalingsplan/i, /gjeldsforlik/i, /avdragsordning/i] },
	// ── Initial demand (legacy) ───────────────────────────────────
	{ kind: "initial_demand", patterns: [/faktura/i, /krav\s+om\s+betaling/i, /betalingskrav/i] },
];

// ── Field extraction patterns ─────────────────────────────────────

const DUE_DATE_PATTERN =
	/(?:forfallsdato|betalingsfrist|forfall|betales\s+innen|due\s+date|frist)[:\s]+(\d{1,2}[\./\-]\d{1,2}[\./\-]\d{2,4})/i;
const REFERENCE_PATTERN =
	/(?:kid|ref(?:erance)?|saksnr(?:ummer)?|krav(?:nr|nummer)?)[:\s#]*([A-Z\d\-\/]{4,30})/i;
const CASE_NO_PATTERN =
	/(?:saksnummer|sak(?:s)?nr\.?|vårt\s+saksnummer)[:\s#]*([A-Z\d\-\/]{4,30})/i;
const INVOICE_PATTERN_GLOBAL = /(?:faktura(?:nr|nummer)?|invoice(?:\s+no)?)[:\s#]*([A-Z\d\-\/]{3,25})/gi;
const VEHICLE_REG_PATTERN =
	/(?:regnr|registreringsnummer|kjennemerke)[:\s]*([A-Z]{2}\s*\d{4,5})/i;
const CREDITOR_PATTERN = /^(?:fra|from|avsender|kreditor|klient)[:\s]+(.+)/im;
const DOCUMENT_DATE_PATTERN =
	/(?:dato|date|brevdato)[:\s]+(\d{1,2}[\./\-]\d{1,2}[\./\-]\d{2,4})/i;
const KID_PATTERN = /(?:\bKID\b)[:\s]*(\d{4,25})/i;
const ACCOUNT_NO_PATTERN = /(?:kontonummer|konto(?:nr)?)[:\s]*(\d{4,15})/i;
const IBAN_PATTERN = /\b(NO\d{2}\s*\d{4}\s*\d{2}\s*\d{5})\b/i;
const BIC_PATTERN = /\b([A-Z]{6}[A-Z\d]{2,5})\b/;
const PRINCIPAL_PATTERN =
	/(?:hovedstol|opprinnelig\s+krav|opprinnelig\s+beløp)[:\s]*([\d\s,.]+)\s*(?:kr|nok)?/i;
const INTEREST_PATTERN =
	/(?:renter?|forsinkelsesrente)[:\s]*([\d\s,.]+)\s*(?:kr|nok)?/i;
const FEE_PATTERN =
	/(?:purregebyr|gebyr)[:\s]*([\d\s,.]+)\s*(?:kr|nok)?/i;
const LEGAL_COST_PATTERN =
	/(?:salær|inndrivingskostnad|inkassosalær|utenrettslig\s+inndrivingskostnad)[:\s]*([\d\s,.]+)\s*(?:kr|nok)?/i;
const PAID_PATTERN =
	/(?:betalt|innbetalt)[:\s]*([\d\s,.]+)\s*(?:kr|nok)?/i;
const OUTSTANDING_PATTERN =
	/(?:utestående|restbeløp|gjenstående)[:\s]*([\d\s,.]+)\s*(?:kr|nok)?/i;
const AMOUNT_TO_PAY_PATTERN =
	/(?:beløp\s+å\s+betale|totalbeløp|å\s+betale)[:\s]*([\d\s,.]+)\s*(?:kr|nok)?/i;
// Fallback: "kr X" or "X kr"
const AMOUNT_PREFIXED = /(?:kr\.?|nok)\s*([\d\s,.]+)/i;
const AMOUNT_SUFFIXED = /\b([\d]{1,3}(?:[. ]\d{3})*(?:[,.]\d{1,2})?)(?:\s*(?:kr\.?|nok))\b/i;

// ── Helpers ───────────────────────────────────────────────────────

function extractStr(text: string, re: RegExp): string | null {
	const m = re.exec(text);
	return m ? m[1].trim() : null;
}

function extractAmt(text: string, re: RegExp): number | null {
	const raw = extractStr(text, re);
	return raw ? parseNorwegianAmount(raw) : null;
}

function normaliseDate(raw: string): string | null {
	const cleaned = raw.replace(/\./g, "-").replace(/\//g, "-");
	const parts = cleaned.split("-");
	if (parts.length !== 3) return cleaned;
	const [a, b, c] = parts;
	if (c && c.length === 4) return `${c}-${b!.padStart(2, "0")}-${a!.padStart(2, "0")}`;
	if (a && a.length === 4) return `${a}-${b!.padStart(2, "0")}-${c!.padStart(2, "0")}`;
	return cleaned;
}

function extractDueDate(text: string): string | null {
	const raw = extractStr(text, DUE_DATE_PATTERN);
	return raw ? normaliseDate(raw) : null;
}

function extractDocumentDate(text: string): string | null {
	const raw = extractStr(text, DOCUMENT_DATE_PATTERN);
	return raw ? normaliseDate(raw) : null;
}

function extractInvoiceNos(text: string): string[] {
	const nos: string[] = [];
	const re = new RegExp(INVOICE_PATTERN_GLOBAL.source, "gi");
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const n = m[1].trim();
		if (n && !nos.includes(n)) nos.push(n);
	}
	return nos;
}

function extractFirstAmount(text: string): number | null {
	let m = AMOUNT_PREFIXED.exec(text);
	if (!m) m = AMOUNT_SUFFIXED.exec(text);
	return m ? parseNorwegianAmount(m[1]) : null;
}

function buildAmountBreakdown(text: string): DebtAmountBreakdown {
	return {
		principal:   extractAmt(text, PRINCIPAL_PATTERN),
		interest:    extractAmt(text, INTEREST_PATTERN),
		fee:         extractAmt(text, FEE_PATTERN),
		reminderFee: extractAmt(text, FEE_PATTERN),
		legalCosts:  extractAmt(text, LEGAL_COST_PATTERN),
		paid:        extractAmt(text, PAID_PATTERN),
		outstanding: extractAmt(text, OUTSTANDING_PATTERN),
		amountToPay: extractAmt(text, AMOUNT_TO_PAY_PATTERN),
		currency:    "NOK",
	};
}

function buildInvoices(text: string): DebtInvoice[] {
	const vehicleReg = extractStr(text, VEHICLE_REG_PATTERN)?.replace(/\s+/g, "").toUpperCase() ?? null;
	return extractInvoiceNos(text).map((no) => ({
		invoiceNo: no,
		originalAmount: null,
		dueDate: null,
		vehicleReg,
		paidAmount: null,
	}));
}

// ── Rich result extends ClassificationResult ──────────────────────

export interface RichClassificationResult extends ClassificationResult {
	externalCaseNo: string | null;
	invoiceNos: string[];
	vehicleReg: string | null;
	documentDate: string | null;
	kid: string | null;
	accountNo: string | null;
	iban: string | null;
	bic: string | null;
	amounts: DebtAmountBreakdown;
	invoices: DebtInvoice[];
	signals: {
		isClosed: boolean;
		isDisputed: boolean;
		isConsolidated: boolean;
		isSettlementOffer: boolean;
		isFeeIncreaseWarning: boolean;
	};
}

/**
 * Classify an email using deterministic text patterns.
 */
export function classifyEmail(
	subject: string,
	body: string,
	attachmentTexts?: string[],
): RichClassificationResult {
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

	const amounts    = buildAmountBreakdown(combined);
	const invoices   = buildInvoices(combined);
	const invoiceNos = invoices.map((i) => i.invoiceNo);

	const amountDue =
		amounts.amountToPay ??
		amounts.outstanding ??
		amounts.principal ??
		extractFirstAmount(combined) ??
		null;

	const creditorRaw = extractStr(combined, CREDITOR_PATTERN)
		?? (() => {
			const s = subject.replace(/^re:|^fwd:/i, "").trim();
			const short = s.split(/[-:|]/)[0].trim();
			return short.length > 2 ? short : null;
		})();

	const isClosed          = /Takk\s+for\s+din\s+betaling|Saken\s+er\s+nå\s+avsluttet|avsluttet\s+hos\s+oss/i.test(combined);
	const isDisputed        = /innsigelse\s+er\s+registrert|vi\s+har\s+mottatt\s+din\s+innsigelse/i.test(combined);
	const isConsolidated    = /SAMMENSLÅING|slått\s+sammen/i.test(combined);
	const isSettlementOffer = /redusert\s+oppgjør|avslag\s+på\s+salæret|[35]0\s*%\s+avslag/i.test(combined);
	const isFeeIncreaseWarning = /salæret\s+kan\s+dobles|salærøkning|ytterligere\s+salær/i.test(combined);

	const confidence = matchedKind === "unknown"
		? 0
		: Math.min(0.3 + matchedPatterns * 0.15, 1);

	return {
		kind:           matchedKind,
		creditor:       creditorRaw,
		reference:      extractStr(combined, REFERENCE_PATTERN),
		externalCaseNo: extractStr(combined, CASE_NO_PATTERN),
		amountDue,
		currency:       "NOK",
		dueDate:        extractDueDate(combined),
		confidence,
		reasoning: matchedKind === "unknown"
			? "No matching patterns found."
			: `Matched ${matchedPatterns} pattern(s) for kind "${matchedKind}"${(attachmentTexts?.length ?? 0) > 0 ? " (including attachment text)" : ""}.`,
		invoiceNos,
		vehicleReg:     extractStr(combined, VEHICLE_REG_PATTERN)?.replace(/\s+/g, "").toUpperCase() ?? null,
		documentDate:   extractDocumentDate(combined),
		kid:            extractStr(combined, KID_PATTERN),
		accountNo:      extractStr(combined, ACCOUNT_NO_PATTERN),
		iban:           extractStr(combined, IBAN_PATTERN),
		bic:            extractStr(combined, BIC_PATTERN),
		amounts,
		invoices,
		signals: { isClosed, isDisputed, isConsolidated, isSettlementOffer, isFeeIncreaseWarning },
	};
}

// ── AI classification fallback ─────────────────────────────────

const VALID_KINDS = new Set<DocumentKind>([
	"inkassovarsel", "betalingsoppfordring", "betalingspaaminnelse", "restbeloep",
	"informasjon_om_krav", "langtidsoppfoelging", "sammenslaaing", "betalingsbekreftelse",
	"avslutningsbrev", "redusert_oppgjoer", "innsigelse_besvart", "kravspesifikasjon",
	"ticket_timeline",
	"initial_demand", "reminder", "collection_notice", "collection_demand",
	"legal_notice", "court_letter", "debt_settlement", "payment_confirmation", "unknown",
]);

const AI_CLASSIFY_PROMPT = `Du er et klassifiseringssystem for norske inkasso-/gjeldsdokumenter.
Klassifiser teksten som én av disse (svar KUN med verdien):
inkassovarsel, betalingsoppfordring, betalingspaaminnelse, restbeloep,
informasjon_om_krav, langtidsoppfoelging, sammenslaaing, betalingsbekreftelse,
avslutningsbrev, redusert_oppgjoer, innsigelse_besvart, kravspesifikasjon,
court_letter, legal_notice, debt_settlement, unknown`;

export async function classifyEmailWithAI(
	ai: Ai,
	subject: string,
	body: string,
	attachmentTexts?: string[],
): Promise<RichClassificationResult | null> {
	const corpus = [subject, body, ...(attachmentTexts ?? [])].join("\n").slice(0, 3000);
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
				max_tokens: 30,
				temperature: 0,
			},
		)) as { response?: string };

		const raw = (response?.response ?? "").trim().toLowerCase() as DocumentKind;
		if (!VALID_KINDS.has(raw) || raw === "unknown") return null;

		const base = classifyEmail(subject, body, attachmentTexts);
		return { ...base, kind: raw, confidence: 0.65, reasoning: `AI classification: "${raw}"` };
	} catch {
		return null;
	}
}
