import type { Env } from "../types";

export type LegalSourceType =
	| "SUPREME_COURT"
	| "LAW_REGISTER"
	| "REGULATION_REGISTER"
	| "FINKN";

export type QueueJob = {
	source_id: string;
	url: string;
	source_type: LegalSourceType;
	weight: number;
	js_required: boolean;
};

export const LEGAL_SOURCES: QueueJob[] = [
	{
		source_id: "domstol_hoyesterett_avgjorelser",
		url: "https://www.domstol.no/no/hoyesterett/avgjorelser/",
		source_type: "SUPREME_COURT",
		weight: 100,
		js_required: false,
	},
	{
		source_id: "lovdata_register_lover_nye",
		url: "https://lovdata.no/register/loverNye",
		source_type: "LAW_REGISTER",
		weight: 100,
		js_required: false,
	},
	{
		source_id: "lovdata_register_forskrifter_nye",
		url: "https://lovdata.no/register/forskrifterNye",
		source_type: "REGULATION_REGISTER",
		weight: 90,
		js_required: false,
	},
	{
		source_id: "finkn_area_78",
		url: "https://publisering.finkn.no/areas/78",
		source_type: "FINKN",
		weight: 80,
		js_required: true,
	},
];

export function sourceWeight(sourceType: LegalSourceType): number {
	switch (sourceType) {
		case "SUPREME_COURT":
			return 100;
		case "LAW_REGISTER":
			return 100;
		case "REGULATION_REGISTER":
			return 90;
		case "FINKN":
			return 80;
		default:
			return 70;
	}
}

function hex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return hex(digest);
}

function stripTags(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function extractCitationKeys(text: string): string[] {
	const matches = text.match(/\b(§\s*\d+[a-zA-Z\-]*)\b/g) ?? [];
	return [...new Set(matches.map((m) => m.replace(/\s+/g, " ").trim()))].slice(0, 50);
}

function inferLegalArea(sourceType: LegalSourceType, text: string): string {
	if (sourceType === "SUPREME_COURT") return "domstol";
	if (sourceType === "FINKN") return "nemndspraksis";
	if (text.toLowerCase().includes("inkasso")) return "inkasso";
	return "general";
}

function inferEffectiveDate(text: string): string | null {
	const m = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
	return m?.[1] ?? null;
}

async function fetchSource(url: string): Promise<{ raw: string; normalized: string }> {
	const res = await fetch(url, {
		headers: {
			"user-agent": "agentic-inbox-legal-ingestion/1.0",
			"accept-language": "nb-NO,nb;q=0.9,en;q=0.8",
		},
	});
	if (!res.ok) {
		throw new Error(`fetch_failed:${res.status}`);
	}
	const raw = await res.text();
	return {
		raw,
		normalized: stripTags(raw),
	};
}

export async function enqueueAllSources(env: Env): Promise<{ queued: number; sources: string[] }> {
	for (const source of LEGAL_SOURCES) {
		await env.LEGAL_INGEST_QUEUE.send(source);
	}
	return { queued: LEGAL_SOURCES.length, sources: LEGAL_SOURCES.map((s) => s.source_id) };
}

async function upsertJobStart(env: Env, source: QueueJob): Promise<number> {
	const now = new Date().toISOString();
	const result = await env.LEGAL_INTEL_DB.prepare(
		`INSERT INTO ingestion_jobs (source_id, source_type, status, started_at)
		 VALUES (?1, ?2, 'RUNNING', ?3)
		 RETURNING id`,
	)
		.bind(source.source_id, source.source_type, now)
		.first<{ id: number }>();
	return result?.id ?? 0;
}

async function completeJob(env: Env, id: number, status: "SUCCESS" | "FAILED", note: string) {
	const now = new Date().toISOString();
	await env.LEGAL_INTEL_DB.prepare(
		`UPDATE ingestion_jobs
		 SET status = ?1, completed_at = ?2, note = ?3
		 WHERE id = ?4`,
	)
		.bind(status, now, note, id)
		.run();
}

export async function processQueueJob(env: Env, source: QueueJob): Promise<{
	status: "ingested" | "skipped_unchanged";
	source_id: string;
	document_hash: string;
}> {
	const jobId = await upsertJobStart(env, source);
	try {
		const fetched = await fetchSource(source.url);
		const documentHash = await sha256(fetched.normalized);
		const previous = await env.LEGAL_INTEL_DB.prepare(
			`SELECT document_hash FROM source_documents WHERE source_id = ?1 ORDER BY id DESC LIMIT 1`,
		)
			.bind(source.source_id)
			.first<{ document_hash: string }>();

		if (previous?.document_hash === documentHash) {
			await completeJob(env, jobId, "SUCCESS", "delta_skip_no_change");
			return { status: "skipped_unchanged", source_id: source.source_id, document_hash: documentHash };
		}

		const now = new Date().toISOString();
		const effectiveDate = inferEffectiveDate(fetched.normalized);
		const legalArea = inferLegalArea(source.source_type, fetched.normalized);
		const citationKeys = JSON.stringify(extractCitationKeys(fetched.normalized));
		const weight = sourceWeight(source.source_type);

		const rawKey = `legal-intel/raw/${source.source_id}/${documentHash}.html`;
		const normKey = `legal-intel/normalized/${source.source_id}/${documentHash}.txt`;
		await env.LEGAL_INTEL_BUCKET.put(rawKey, fetched.raw, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
		await env.LEGAL_INTEL_BUCKET.put(normKey, fetched.normalized, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });

		await env.LEGAL_INTEL_DB.prepare(
			`INSERT INTO source_documents (
				source_id, source_type, source_url, source_weight, effective_date, legal_area,
				citation_keys, document_hash, raw_r2_key, normalized_r2_key, created_at, methodology_trace
			) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
		)
			.bind(
				source.source_id,
				source.source_type,
				source.url,
				weight,
				effectiveDate,
				legalArea,
				citationKeys,
				documentHash,
				rawKey,
				normKey,
				now,
				JSON.stringify({
					source: source.source_id,
					weight,
					selected: true,
					reasons: ["scheduled_ingestion", "delta_hash_changed"],
					excluded_sources: [],
					license_note:
						source.source_id.includes("lovdata")
							? "Respect Lovdata terms. Prefer licensed/API source where available."
							: null,
				}),
			)
			.run();

		await completeJob(env, jobId, "SUCCESS", "ingested_new_version");
		return { status: "ingested", source_id: source.source_id, document_hash: documentHash };
	} catch (error) {
		await completeJob(env, jobId, "FAILED", String(error));
		throw error;
	}
}

export async function ingestionStatus(env: Env) {
	const docs = await env.LEGAL_INTEL_DB.prepare(
		`SELECT source_type, COUNT(*) as c FROM source_documents GROUP BY source_type`,
	).all<{ source_type: string; c: number }>();
	const jobs = await env.LEGAL_INTEL_DB.prepare(
		`SELECT status, COUNT(*) as c FROM ingestion_jobs GROUP BY status`,
	).all<{ status: string; c: number }>();
	return {
		sources: LEGAL_SOURCES,
		documents_by_source_type: docs.results,
		jobs_by_status: jobs.results,
		cache_policy: "all analyzers read from R2 normalized docs",
	};
}

export type ConsensusInput = {
	references: Array<{
		source_type: LegalSourceType;
		review_required?: boolean;
		specialis_score?: number;
		effective_date?: string;
	}>;
	assertion_level: "fact_observed" | "legal_issue" | "probable_breach" | "asserted_breach";
};

export function methodologyConsensus(input: ConsensusInput) {
	const refs = input.references.map((r) => ({
		...r,
		weight: sourceWeight(r.source_type),
		specialis_score: r.specialis_score ?? 0,
		effective_ts: r.effective_date ? Date.parse(r.effective_date) : 0,
	}));

	const sorted = refs.sort((a, b) => {
		if (b.weight !== a.weight) return b.weight - a.weight; // lex superior
		if ((b.specialis_score ?? 0) !== (a.specialis_score ?? 0)) return (b.specialis_score ?? 0) - (a.specialis_score ?? 0); // lex specialis
		return (b.effective_ts ?? 0) - (a.effective_ts ?? 0); // lex posterior
	});

	const top = sorted[0];
	const hasReviewRequired = sorted.some((r) => r.review_required);
	const blockAsserted = input.assertion_level === "asserted_breach" && (!!hasReviewRequired || !top || top.weight < 80);

	return {
		top_source: top ?? null,
		ordered_sources: sorted,
		has_review_required: hasReviewRequired,
		block_asserted_breach: blockAsserted,
		allowed_assertion_level: blockAsserted ? "probable_breach" : input.assertion_level,
	};
}
