/**
 * CSV bank provider.
 *
 * Parses a CSV file (RFC 4180) with the following expected columns
 * (case-insensitive, flexible column order):
 *
 *   date, amount, currency, description, counterparty, reference
 *
 * "currency" and "reference" are optional.
 */

import type { BankProvider, ConnectionStatus, RawTransaction, TransactionFilter } from "../types";
import { nanoid } from "nanoid";

export interface CsvProviderOptions {
	/** Raw CSV content. Set via in-memory upload or import. */
	csvContent: string;
}

function parseDate(raw: string): string {
	// Accept DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD
	const slashDot = /^(\d{2})[.\/](\d{2})[.\/](\d{4})$/.exec(raw.trim());
	if (slashDot) return `${slashDot[3]}-${slashDot[2]}-${slashDot[1]}`;
	return raw.trim();
}

function parseAmount(raw: string): number {
	// Handle Norwegian number formatting: 1.234,56 or 1234.56
	const normalised = raw.trim().replace(/\s/g, "").replace(/\.(\d{3})/g, "$1").replace(",", ".");
	return parseFloat(normalised);
}

function parseCsv(content: string): Record<string, string>[] {
	const lines = content.split(/\r?\n/).filter((l) => l.trim());
	if (lines.length < 2) return [];

	const headers = lines[0].split(";").map((h) => h.replace(/"/g, "").trim().toLowerCase());
	return lines.slice(1).map((line) => {
		const values = line.split(";").map((v) => v.replace(/"/g, "").trim());
		return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
	});
}

function col(row: Record<string, string>, ...names: string[]): string {
	for (const n of names) {
		if (row[n] !== undefined && row[n] !== "") return row[n];
	}
	return "";
}

export function parseCsvTransactions(csvContent: string): RawTransaction[] {
	const rows = parseCsv(csvContent);
	return rows.map((row) => {
		const rawAmount = col(row, "amount", "beløp", "sum");
		const amount = parseAmount(rawAmount);
		return {
			externalId: nanoid(),
			amount: Number.isNaN(amount) ? 0 : amount,
			currency: col(row, "currency", "valuta") || "NOK",
			date: parseDate(col(row, "date", "dato", "transaksjonsdato")),
			description: col(row, "description", "beskrivelse", "tekst"),
			counterparty: col(row, "counterparty", "motpart", "avsender") || null,
			reference: col(row, "reference", "kid", "ref", "referanse") || null,
			rawData: JSON.stringify(row),
		};
	}).filter((t) => t.date && !Number.isNaN(t.amount));
}

// ── Provider implementation ───────────────────────────────────────

export class CsvProvider implements BankProvider {
	readonly id = "csv";
	private content: string;

	constructor(options: CsvProviderOptions) {
		this.content = options.csvContent;
	}

	async testConnection(): Promise<ConnectionStatus> {
		try {
			const rows = parseCsv(this.content);
			if (rows.length === 0) {
				return { status: "failed", lastSync: null, message: "CSV is empty or could not be parsed." };
			}
			return { status: "ok", lastSync: null, message: `${rows.length} row(s) available.` };
		} catch {
			return { status: "failed", lastSync: null, message: "CSV parse error." };
		}
	}

	async listTransactions(filter: TransactionFilter): Promise<RawTransaction[]> {
		const all = parseCsvTransactions(this.content);
		return all.filter((t) => {
			if (filter.fromDate && t.date < filter.fromDate) return false;
			if (filter.toDate && t.date > filter.toDate) return false;
			return true;
		}).slice(0, filter.limit ?? 500);
	}

	async exportTransactionsCsv(): Promise<Uint8Array> {
		return new TextEncoder().encode(this.content);
	}
}
