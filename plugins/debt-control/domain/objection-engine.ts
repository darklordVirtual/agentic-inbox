/**
 * Objection engine — generates structured email drafts.
 *
 * Loads a Markdown recipe, fills in case details and returns plain text
 * suitable for the compose window. AI can be layered on top separately;
 * these are rule-based templates.
 */

import type { DebtCase, Finding } from "../types";

export type ObjectionKind =
	| "already_paid"
	| "missing_basis"
	| "excessive_fees"
	| "fragmentation";

export interface DraftResult {
	subject: string;
	body: string;
}

/** Fill a template string with simple {{key}} placeholders. */
function fill(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `[${key}]`);
}

function formatAmount(amount: number | null, currency = "NOK"): string {
	if (amount === null) return "[beløp ukjent]";
	return `${amount.toLocaleString("nb-NO")} ${currency}`;
}

function formatDate(date: string | null): string {
	if (!date) return "[dato ukjent]";
	return new Date(date).toLocaleDateString("nb-NO");
}

// ── Templates ─────────────────────────────────────────────────────

const TEMPLATES: Record<ObjectionKind, { subject: string; body: string }> = {
	already_paid: {
		subject: "Svar: Innsigelse – kravet er allerede betalt",
		body: `Hei,

Jeg viser til krav datert {{dueDate}} på kr {{amount}} fra {{creditor}}.

Jeg vil informere om at dette kravet allerede er betalt. Jeg ber om at dere bekrefter
mottak av betalingen og lukker saken.

Dersom dere mener kravet ikke er oppgjort, ber jeg om fullstendig dokumentasjon
på utestående beløp inkludert transaksjonsoversikt fra deres side.

Med vennlig hilsen,
{{senderName}}
`,
	},

	missing_basis: {
		subject: "Svar: Krav om dokumentasjon – mangelfullt kravgrunnlag",
		body: `Hei,

Jeg viser til brev/e-post der det fremsettes krav mot meg.

Jeg bestrider ikke at det kan foreligge et mellomværende, men etterlyser følgende
dokumentasjon før betaling kan vurderes:

1. Original faktura / kontraktsgrunnlag
2. Spesifikasjon av alle påløpte gebyrer og renter
3. Dokumentasjon på at kravet er lovlig overdratt til inkassobyrå (om aktuelt)

Inntil dokumentasjonen er mottatt og gjennomgått, er kravet å anse som bestridt.

Med vennlig hilsen,
{{senderName}}
`,
	},

	excessive_fees: {
		subject: "Svar: Innsigelse mot gebyrer og renter",
		body: `Hei,

Jeg viser til krav på kr {{amount}} fra {{creditor}}.

Kravet inneholder gebyrer og/eller renter som fremstår uforholdsmessig høye
i henhold til inkassoloven § 17 og renteloven.

Jeg ber om:
1. Detaljert spesifikasjon av alle gebyrer og renteberegninger
2. Bekreftelse på at gebyrene er i tråd med inkassoforskriften
3. Reduksjon av kravet i tråd med gjeldende satser

Med vennlig hilsen,
{{senderName}}
`,
	},

	fragmentation: {
		subject: "Svar: Innsigelse – mulig fragmentering av krav",
		body: `Hei,

Jeg viser til flere krav mottatt fra {{creditor}}.

Jeg er av den oppfatning at kravene fremstår som fragmenterte (delt opp i flere
mindre krav for å omgå terskler i inkassoloven). Dette er i strid med
inkassoloven § 8 og god inkassoskikk.

Jeg ber om:
1. Samlet oversikt over alle krav og tilhørende fakturgrunnlag
2. Bekreftelse på at fragmentering ikke er tilsiktet
3. Sammenslåing av kravene til én behandling

Med vennlig hilsen,
{{senderName}}
`,
	},
};

// ── Public API ────────────────────────────────────────────────────

export function buildDraft(
	kind: ObjectionKind,
	c: DebtCase,
	senderName = "Brevskriveren",
): DraftResult {
	const tmpl = TEMPLATES[kind];

	const vars: Record<string, string> = {
		creditor: c.creditor,
		amount: formatAmount(c.amountDue, c.currency),
		dueDate: formatDate(c.dueDate),
		reference: c.reference ?? "[ref. ukjent]",
		senderName,
	};

	return {
		subject: fill(tmpl.subject, vars),
		body: fill(tmpl.body, vars),
	};
}

/** Suggest the most relevant objection kind based on case findings. */
export function suggestObjectionKind(findings: Finding[]): ObjectionKind | null {
	const codes = new Set(findings.map((f) => f.code));
	if (codes.has("POSSIBLE_ALREADY_PAID")) return "already_paid";
	if (codes.has("FRAGMENTATION_SUSPECTED")) return "fragmentation";
	if (codes.has("MISSING_LEGAL_BASIS")) return "missing_basis";
	return null;
}
