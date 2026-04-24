/**
 * Debt Timeline Insights
 *
 * Converts raw DebtEvents into annotated, human-readable timeline insights
 * with importance flags for frontend display.
 */

import type { DebtCase, DebtEvent, TimelineInsight } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
	return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function fmt(amount: number | null | undefined): string {
	return amount != null ? `${amount.toLocaleString("nb-NO")} kr` : "ukjent beløp";
}

// ── Main function ────────────────────────────────────────────────────

/**
 * Build a sorted list of timeline insights from a case and its events.
 * Each insight has a label, date, importance level, and description.
 */
export function buildDebtTimelineInsights(
	debtCase: DebtCase,
	events: DebtEvent[],
): TimelineInsight[] {
	const insights: TimelineInsight[] = [];
	const sorted = [...events].sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
	);

	let firstFeeAmount: number | null = null;
	let firstFeeDate: string | null = null;

	for (const ev of sorted) {
		const amounts = ev.amounts;
		const fee     = amounts?.legalCosts ?? amounts?.fee ?? null;

		switch (ev.kind) {
			case "inkassovarsel":
			case "collection_notice":
			case "initial_demand":
				insights.push({
					date:        ev.date,
					label:       "Inkassovarsel mottatt",
					importance:  "warning",
					description:
						`Inkassovarsel for ${fmt(amounts?.amountToPay ?? amounts?.principal ?? debtCase.amountDue)}` +
						(ev.deadline ? ` med betalingsfrist ${ev.deadline}` : "") +
						`. Trinnene i inkassoprosessen starter her.`,
				});
				break;

			case "betalingsoppfordring":
			case "collection_demand":
				insights.push({
					date:        ev.date,
					label:       "Betalingsoppfordring",
					importance:  "warning",
					description:
						`Formell betalingsoppfordring mottatt — ${fmt(amounts?.amountToPay ?? debtCase.amountDue)}` +
						(ev.deadline ? `. Frist: ${ev.deadline}` : "") +
						(fee ? `. Salær påløpt: ${fmt(fee)}.` : ""),
				});
				break;

			case "betalingspaaminnelse":
			case "reminder":
				insights.push({
					date:        ev.date,
					label:       "Påminnelse",
					importance:  "warning",
					description: `Betalingspåminnelse mottatt${fee ? ` med salær ${fmt(fee)}` : ""}.`,
				});
				break;

			case "restbeloep":
				insights.push({
					date:        ev.date,
					label:       "Restbeløp / ny kostnadsøkning",
					importance:  "critical",
					description:
						`Brev om nytt restbeløp: ${fmt(amounts?.amountToPay ?? debtCase.amountDue)}` +
						(fee ? `. Akkumulert salær: ${fmt(fee)}.` : "") +
						" Indikert at salær kan ha økt.",
				});
				// Detect fee increase
				if (fee && firstFeeAmount && fee > firstFeeAmount * 1.4) {
					insights.push({
						date:        ev.date,
						label:       "Salærøkning observert",
						importance:  "critical",
						description:
							`Salær økte fra ${fmt(firstFeeAmount)} til ${fmt(fee)}` +
							(firstFeeDate ? ` (${Math.round((new Date(ev.date).getTime() - new Date(firstFeeDate).getTime()) / 86_400_000)} dager siden første salær)` : "") +
							`. Sannsynlig regelmønster: salærøkning etter fristoversittelse.`,
					});
				}
				break;

			case "langtidsoppfoelging":
				insights.push({
					date:        ev.date,
					label:       "Langtidsovervåkning startet",
					importance:  "warning",
					description:
						"Inkassoselskapet har lagt saken til langtidsoppfølging. " +
						"Indikert eskaleringslogikk: saken kan bli sendt til rettssystem ved manglende betaling.",
				});
				break;

			case "sammenslaaing":
				insights.push({
					date:        ev.date,
					label:       "Sammenslåing av krav",
					importance:  "warning",
					description:
						`Flere fakturaer/krav er slått sammen til én sak` +
						(debtCase.mergedCaseNos?.length ? ` (${debtCase.mergedCaseNos.length} saker)` : "") +
						`. Totalt krav: ${fmt(amounts?.amountToPay ?? debtCase.amountDue)}.`,
				});
				break;

			case "kravspesifikasjon":
				insights.push({
					date:        ev.date,
					label:       "Kravspesifikasjon mottatt",
					importance:  "info",
					description:
						`Detaljert kravspesifikasjon — ` +
						`Hovedstol: ${fmt(amounts?.principal)}, ` +
						`Salær: ${fmt(amounts?.legalCosts ?? fee)}, ` +
						`Renter: ${fmt(amounts?.interest)}.`,
				});
				break;

			case "innsigelse_besvart":
				insights.push({
					date:        ev.date,
					label:       "Inkassoselskapet svarte på innsigelse",
					importance:  "info",
					description:
						"Inkassoselskapet har besvart innsigelsen. " +
						"Basert på observert mønster kan saken nå gå til manuell behandling eller redusert oppgjør.",
				});
				break;

			case "redusert_oppgjoer":
				insights.push({
					date:        ev.date,
					label:       "Tilbud om redusert oppgjør",
					importance:  "positive",
					description:
						`Inkassoselskapet tilbyr redusert oppgjør` +
						(amounts?.amountToPay ? ` — ${fmt(amounts.amountToPay)}` : "") +
						(ev.deadline ? ` (frist: ${ev.deadline})` : "") +
						". Vurder om tilbudet er akseptabelt sammenlignet med dokumentert hovedstol.",
				});
				break;

			case "betalingsbekreftelse":
			case "payment_confirmation":
				insights.push({
					date:        ev.date,
					label:       "Betaling bekreftet",
					importance:  "positive",
					description:
						`Betaling er bekreftet mottatt` +
						(amounts?.paid ? ` — ${fmt(amounts.paid)}` : "") +
						". Sjekk at saken avsluttes og at ingen nye krav er utestående.",
				});
				break;

			case "avslutningsbrev":
				insights.push({
					date:        ev.date,
					label:       "Saken avsluttet",
					importance:  "positive",
					description: "Avslutningsbrev mottatt. Saken er lukket fra inkassoselskapets side.",
				});
				break;

			case "informasjon_om_krav":
				insights.push({
					date:        ev.date,
					label:       "Informasjonsbrev om krav",
					importance:  "info",
					description: `Informasjonsbrev om kravestatus: ${fmt(amounts?.amountToPay ?? debtCase.amountDue)}.`,
				});
				break;

			case "ticket_timeline":
				insights.push({
					date:        ev.date,
					label:       "Systemlogg / kontakthenvendelse",
					importance:  "info",
					description: "Intern systemlogg eller kontaktsenter-oppføring mottatt.",
				});
				break;

			case "legal_notice":
			case "court_letter":
				insights.push({
					date:        ev.date,
					label:       ev.kind === "court_letter" ? "Stevning / forliksklage" : "Rettslig varsel",
					importance:  "critical",
					description:
						"Rettslig skritt varslet eller iverksatt. " +
						"Umiddelbar oppfølging anbefales — se etter frist for tilsvar.",
				});
				break;

			default:
				break;
		}

		// Track first fee for escalation detection
		if (fee && fee > 0 && !firstFeeAmount) {
			firstFeeAmount = fee;
			firstFeeDate   = ev.date;
			insights.push({
				date:        ev.date,
				label:       "Første salær påheftet",
				importance:  "warning",
				description: `Første salær registrert: ${fmt(fee)}.`,
			});
		}
	}

	// ── Objection date (from case, not event) ─────────────────────
	if (debtCase.objectionDate) {
		insights.push({
			date:        debtCase.objectionDate,
			label:       "Innsigelse registrert",
			importance:  "info",
			description: "Innsigelse er registrert i systemet. Inkassoselskapet plikter å behandle denne.",
		});
	}

	// ── Processing limitation ─────────────────────────────────────
	if (debtCase.processingLimitationRequestedAt) {
		insights.push({
			date:        debtCase.processingLimitationRequestedAt,
			label:       "Stansbegjæring sendt",
			importance:  "info",
			description: "Krav om stans i behandling er journalført.",
		});
	}

	// ── Closed date ───────────────────────────────────────────────
	if (debtCase.closedAt && !sorted.some((e) => e.kind === "avslutningsbrev")) {
		insights.push({
			date:        debtCase.closedAt,
			label:       "Saken markert avsluttet",
			importance:  "positive",
			description: "Saken ble markert som avsluttet.",
		});
	}

	// ── Upcoming deadline alert ───────────────────────────────────
	if (debtCase.dueDate) {
		const dl = daysUntil(debtCase.dueDate);
		if (dl > 0 && dl <= 14) {
			insights.push({
				date:        debtCase.dueDate,
				label:       `Betalingsfrist — ${dl} dager igjen`,
				importance:  dl <= 3 ? "critical" : "warning",
				description:
					`Betalingsfrist er ${debtCase.dueDate} (${dl} dager). ` +
					"Etter frist kan salær øke basert på observert eskaleringsmønster.",
			});
		} else if (dl <= 0) {
			insights.push({
				date:        debtCase.dueDate,
				label:       `Betalingsfrist passert`,
				importance:  "critical",
				description:
					`Frist var ${debtCase.dueDate} (${Math.abs(dl)} dager siden). ` +
					"Salærøkning er mulig basert på observert prosessmønster.",
			});
		}
	}

	// Sort by date, most important last within same date
	return insights.sort((a, b) => {
		const dt = new Date(a.date).getTime() - new Date(b.date).getTime();
		if (dt !== 0) return dt;
		const importanceOrder = ["info", "positive", "warning", "critical"];
		return importanceOrder.indexOf(a.importance) - importanceOrder.indexOf(b.importance);
	});
}
