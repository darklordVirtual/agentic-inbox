import type { PluginManifest } from "../../workers/plugins/types";

export const debtControlManifest: PluginManifest = {
	id: "debt-control",
	name: "Gjeldskontroll",
	version: "0.1.0",
	description:
		"Norsk gjeldshåndtering for privatkunder. Klassifiserer innkommende " +
		"inkassokrav og fakturaer, sjekker automatisk om krav er betalt via " +
		"SpareBank 1 API, og prioriterer utestående betalinger etter tilgjengelig " +
		"saldo. Overholder norsk inkassolovgivning (inkassoloven, " +
		"finansavtaleloven og forsinkelsesrenteloven).",
	settingsSchema: {
		enabled: {
			type: "boolean",
			label: "Aktiver Gjeldskontroll",
			default: true,
			required: false,
		},
		bankProvider: {
			type: "string",
			label: "Banktilkobling",
			description:
				"Velg transaksjonskilde for betalingsavstемming. " +
				"sparebank1 = direkte API-tilkobling (krever API-nøkler fra " +
				"sparebank1.no/open-api), csv = manuell kontoutskrift, " +
				"none = ingen bankintegrasjon.",
			default: "none",
		},
		autoClassify: {
			type: "boolean",
			label: "Automatisk klassifisering av e-post",
			description:
				"Klassifiser automatisk innkommende e-poster som inkassokrav, " +
				"fakturaer eller purringer ved mottak.",
			default: true,
		},
		autoReconcile: {
			type: "boolean",
			label: "Automatisk betalingsavstемming",
			description:
				"Koble banktransaksjoner til åpne saker automatisk etter synk. " +
				"Marker krav som betalt og prioriter gjenstående etter saldo.",
			default: true,
		},
	},
};
