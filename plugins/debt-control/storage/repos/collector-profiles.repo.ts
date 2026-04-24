import type { CollectorProfile, CollectionAlgorithmFingerprint } from "../../types";
import { nanoid } from "nanoid";

function row(r: Record<string, unknown>): CollectorProfile {
	return {
		name:                 r.name as string,
		orgNo:                (r.org_no as string | null) ?? undefined,
		portalDomains:        JSON.parse((r.portal_domains_json as string) ?? "[]"),
		paymentAccountNumbers: JSON.parse((r.payment_accounts_json as string) ?? "[]"),
		knownEmailAddresses:  JSON.parse((r.known_emails_json as string) ?? "[]"),
		observedFingerprints: JSON.parse((r.fingerprints_json as string) ?? "[]"),
		strategyNotes:        JSON.parse((r.strategy_notes_json as string) ?? "[]"),
	};
}

export const collectorProfilesRepo = {
	listByMailbox(sql: SqlStorage, mailboxId: string): CollectorProfile[] {
		return [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_collector_profiles WHERE mailbox_id = ? ORDER BY name`,
			mailboxId,
		)].map(row);
	},

	findByName(sql: SqlStorage, mailboxId: string, name: string): CollectorProfile | null {
		const rows = [...sql.exec<Record<string, SqlStorageValue>>(
			`SELECT * FROM dc_collector_profiles WHERE mailbox_id = ? AND name = ?`,
			mailboxId, name,
		)];
		return rows.length ? row(rows[0]) : null;
	},

	upsert(sql: SqlStorage, mailboxId: string, profile: CollectorProfile): void {
		const id = nanoid();
		sql.exec(
			`INSERT INTO dc_collector_profiles
				(id, mailbox_id, name, org_no, portal_domains_json, payment_accounts_json,
				 known_emails_json, fingerprints_json, strategy_notes_json, updated_at)
			 VALUES (
				 COALESCE((SELECT id FROM dc_collector_profiles WHERE mailbox_id = ? AND name = ?), ?),
				 ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
			 )
			 ON CONFLICT(mailbox_id, name) DO UPDATE SET
				org_no                = excluded.org_no,
				portal_domains_json   = excluded.portal_domains_json,
				payment_accounts_json = excluded.payment_accounts_json,
				known_emails_json     = excluded.known_emails_json,
				fingerprints_json     = excluded.fingerprints_json,
				strategy_notes_json   = excluded.strategy_notes_json,
				updated_at            = datetime('now')`,
			mailboxId,
			profile.name,
			id,
			mailboxId,
			profile.name,
			profile.orgNo ?? null,
			JSON.stringify(profile.portalDomains),
			JSON.stringify(profile.paymentAccountNumbers),
			JSON.stringify(profile.knownEmailAddresses),
			JSON.stringify(profile.observedFingerprints),
			JSON.stringify(profile.strategyNotes),
		);
	},

	/** Append a new fingerprint to an existing profile (or create profile). */
	appendFingerprint(
		sql: SqlStorage,
		mailboxId: string,
		collectorName: string,
		fingerprint: CollectionAlgorithmFingerprint,
	): void {
		const existing = collectorProfilesRepo.findByName(sql, mailboxId, collectorName);
		const profile: CollectorProfile = existing ?? {
			name: collectorName,
			orgNo: undefined,
			portalDomains: [],
			paymentAccountNumbers: [],
			knownEmailAddresses: [],
			observedFingerprints: [],
			strategyNotes: [],
		};

		// Replace or append fingerprint (keyed by creditorName)
		const idx = profile.observedFingerprints.findIndex(
			(f) => f.creditorName === fingerprint.creditorName || (!f.creditorName && !fingerprint.creditorName),
		);
		if (idx >= 0) {
			profile.observedFingerprints[idx] = fingerprint;
		} else {
			profile.observedFingerprints.push(fingerprint);
		}

		collectorProfilesRepo.upsert(sql, mailboxId, profile);
	},
};
