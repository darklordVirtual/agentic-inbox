/**
 * Debt Control API client.
 * All calls go through /api/v1/mailboxes/:mailboxId/api/plugins/debt-control/
 */

import type { DebtCase, DebtDocument, Finding, PaymentMatch, PluginSettings } from "../../../plugins/debt-control/types";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	constructor(public status: number, public body: unknown) {
		super(`API error ${status}`);
	}
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: { "Content-Type": "application/json", ...(options.headers as Record<string, string>) },
		});
		clearTimeout(timer);
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new ApiError(res.status, body);
		return body as T;
	} finally {
		clearTimeout(timer);
	}
}

function base(mailboxId: string) {
	return `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/api/plugins/debt-control`;
}

// ── Settings ───────────────────────────────────────────────────────

export function getSettings(mailboxId: string): Promise<PluginSettings> {
	return request(`${base(mailboxId)}/settings`);
}

export function updateSettings(mailboxId: string, patch: Partial<PluginSettings>): Promise<PluginSettings> {
	return request(`${base(mailboxId)}/settings`, {
		method: "PATCH",
		body: JSON.stringify(patch),
	});
}

// ── Bank ───────────────────────────────────────────────────────────

export interface BankStatus {
	status: "configured" | "ok" | "failed" | "not_configured";
	provider: string;
	lastSync: string | null;
	message?: string;
}

export function getBankStatus(mailboxId: string): Promise<BankStatus> {
	return request(`${base(mailboxId)}/settings/bank`);
}

export function testBankConnection(mailboxId: string): Promise<BankStatus> {
	return request(`${base(mailboxId)}/settings/bank/test`, { method: "POST" });
}

export function triggerBankSync(mailboxId: string): Promise<{ imported: number; total: number }> {
	return request(`${base(mailboxId)}/bank/sync`, { method: "POST" });
}

// ── Cases ──────────────────────────────────────────────────────────

export function listCases(mailboxId: string, status?: string): Promise<DebtCase[]> {
	const q = status ? `?status=${encodeURIComponent(status)}` : "";
	return request(`${base(mailboxId)}/cases${q}`);
}

export interface CaseDetail {
	case: DebtCase;
	documents: DebtDocument[];
	findings: Finding[];
	paymentMatches: PaymentMatch[];
}

export function getCase(mailboxId: string, caseId: string): Promise<CaseDetail> {
	return request(`${base(mailboxId)}/cases/${encodeURIComponent(caseId)}`);
}

export function reconcileCase(mailboxId: string, caseId: string): Promise<{ matched: number; skipped: number }> {
	return request(`${base(mailboxId)}/cases/${encodeURIComponent(caseId)}/reconcile`, { method: "POST" });
}

// ── Drafts ─────────────────────────────────────────────────────────

export interface DraftResult {
	subject: string;
	body: string;
}

export function draftObjection(mailboxId: string, caseId: string, kind?: string, senderName?: string): Promise<DraftResult> {
	return request(`${base(mailboxId)}/cases/${encodeURIComponent(caseId)}/draft-objection`, {
		method: "POST",
		body: JSON.stringify({ kind, senderName }),
	});
}

export function requestMoreInfo(mailboxId: string, caseId: string, senderName?: string): Promise<DraftResult> {
	return request(`${base(mailboxId)}/cases/${encodeURIComponent(caseId)}/request-more-info`, {
		method: "POST",
		body: JSON.stringify({ senderName }),
	});
}
