import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { eventsRepo } from "../../storage/repos/events.repo";
import { collectorProfilesRepo } from "../../storage/repos/collector-profiles.repo";
import { buildCollectionFingerprint, buildCollectorProfile } from "../../domain/collection-fingerprint-engine";

type C = Context<MailboxContext>;

export const collectorHandlers = {
	/** GET /collectors — list all collector profiles for this mailbox */
	async list(c: C) {
		const stub       = c.var.mailboxStub;
		const sql        = await stub.getSql();
		const mailboxId  = c.req.param("mailboxId")!;

		const profiles = collectorProfilesRepo.listByMailbox(sql, mailboxId);
		return c.json({ profiles });
	},

	/** GET /collectors/:name/fingerprint — build fresh fingerprint for a collector */
	async fingerprint(c: C) {
		const stub          = c.var.mailboxStub;
		const sql           = await stub.getSql();
		const mailboxId     = c.req.param("mailboxId")!;
		const collectorName = decodeURIComponent(c.req.param("name")!);

		// Gather all cases for this collector
		const allCases = casesRepo.listByMailbox(sql, mailboxId).filter(
			(ca) => ca.creditor === collectorName,
		);

		// Load events for each case
		const eventsByCaseId = new Map(
			allCases.map((ca) => [ca.id, eventsRepo.findByCaseId(sql, ca.id)]),
		);

		const fingerprint = buildCollectionFingerprint(collectorName, allCases, eventsByCaseId);

		// Persist updated profile
		collectorProfilesRepo.appendFingerprint(sql, mailboxId, collectorName, fingerprint);

		return c.json({ fingerprint });
	},
};
