import type { Context } from "hono";
import type { MailboxContext } from "../../../../workers/lib/mailbox";
import { casesRepo } from "../../storage/repos/cases.repo";
import { generateLetter, generateAllLetters } from "../../domain/letter-templates";
import type { LetterKind } from "../../types";

type C = Context<MailboxContext>;

export const lettersHandlers = {
	/**
	 * POST /cases/:id/generate-letter
	 * Body: { kind: LetterKind; recipientName?: string }
	 */
	async generate(c: C) {
		const stub = c.var.mailboxStub;
		const sql  = await stub.getSql();
		const id   = c.req.param("id")!;

		const debtCase = casesRepo.findById(sql, id);
		if (!debtCase) return c.json({ error: "Case not found" }, 404);

		const body = await c.req.json<{ kind?: LetterKind; recipientName?: string }>();
		const name = body?.recipientName ?? undefined;

		if (!body?.kind) {
			// Return all generated letters
			const letters = generateAllLetters(debtCase, name);
			return c.json({ letters });
		}

		const letter = generateLetter(body.kind, debtCase, name);
		return c.json({ letter });
	},
};
