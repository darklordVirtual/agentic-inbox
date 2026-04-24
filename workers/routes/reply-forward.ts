// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { sendEmail } from "../email-sender";
import { storeAttachments } from "../lib/attachments";
import type { EmailFull } from "../lib/schemas";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildReferencesChain,
	buildThreadingHeaders,
	resolveOriginalEmail,
} from "../lib/email-helpers";
import { SendEmailRequestSchema } from "../lib/schemas";
import { Folders } from "../../shared/folders";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;
type RateLimitStub = { checkSendRateLimit: () => Promise<string | null> };

export async function handleReplyEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const id = c.req.param("id") ?? "";

	let body: ReturnType<typeof SendEmailRequestSchema.parse>;
	try {
		body = SendEmailRequestSchema.parse(await c.req.json());
	} catch (e) {
		console.error(`[reply] Schema validation failed (emailId=${id}, mailbox=${mailboxId}):`, (e as Error).message);
		return c.json({ error: "Invalid request body", details: (e as Error).message }, 400);
	}
	const { to, cc, bcc, from, subject, html, text, attachments } = body;

	console.log(`[reply] from=${JSON.stringify(from)} to=${JSON.stringify(to)} inReplyTo=${id} mailbox=${mailboxId}`);

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	const { originalMsgId, references, threadId: thread_id } = buildReferencesChain(originalEmail);

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) {
			console.warn(`[reply] Sender validation failed: ${(e as Error).message} (mailbox=${mailboxId})`);
			return c.json({ error: e.message }, 400);
		}
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const rateLimitError = await (stub as unknown as RateLimitStub).checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(),
			body: html || text || "",
			in_reply_to: originalMsgId,
			email_references: JSON.stringify(references),
			thread_id: thread_id,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
				...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
				...(originalMsgId ? [{ key: "in-reply-to", value: `<${originalMsgId}>` }] : []),
				...(references.length > 0 ? [{ key: "references", value: references.map((r: string) => `<${r}>`).join(" ") }] : []),
			]),
		},
		attachmentData,
	);

	await stub.markThreadRead(thread_id);

	console.log(`[reply] Email persisted, enqueueing delivery via EMAIL binding (messageId=${messageId}, to=${toStr})`);

	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition,
				contentId: att.contentId,
			})),
			headers: buildThreadingHeaders(originalMsgId, references),
		}).then(() => {
			console.log(`[reply] EMAIL binding delivery succeeded (messageId=${messageId})`);
		}).catch((e) => {
			console.error(`[reply] EMAIL binding delivery failed (messageId=${messageId}, to=${toStr}):`, (e as Error).message, { code: (e as any).code });
		}),
	);

	return c.json({ id: messageId, status: "sent" }, 202);
}

export async function handleForwardEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const id = c.req.param("id") ?? "";

	let body: ReturnType<typeof SendEmailRequestSchema.parse>;
	try {
		body = SendEmailRequestSchema.parse(await c.req.json());
	} catch (e) {
		console.error(`[forward] Schema validation failed (emailId=${id}, mailbox=${mailboxId}):`, (e as Error).message);
		return c.json({ error: "Invalid request body", details: (e as Error).message }, 400);
	}
	const { to, cc, bcc, from, subject, html, text, attachments } = body;

	console.log(`[forward] from=${JSON.stringify(from)} to=${JSON.stringify(to)} originalId=${id} mailbox=${mailboxId}`);

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	await resolveOriginalEmail(stub, rawOriginal);

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) {
			console.warn(`[forward] Sender validation failed: ${(e as Error).message} (mailbox=${mailboxId})`);
			return c.json({ error: e.message }, 400);
		}
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

	const rateLimitError = await (stub as unknown as RateLimitStub).checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(),
			body: html || text || "",
			in_reply_to: null,
			email_references: null,
			thread_id: messageId,
			message_id: outgoingMessageId,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
				...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
				{ key: "subject", value: subject },
				{ key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
			]),
		},
		attachmentData,
	);

	console.log(`[forward] Email persisted, enqueueing delivery via EMAIL binding (messageId=${messageId}, to=${toStr})`);

	c.executionCtx.waitUntil(
		sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition,
				contentId: att.contentId,
			})),
		}).then(() => {
			console.log(`[forward] EMAIL binding delivery succeeded (messageId=${messageId})`);
		}).catch((e) => {
			console.error(`[forward] EMAIL binding delivery failed (messageId=${messageId}, to=${toStr}):`, (e as Error).message, { code: (e as any).code });
		}),
	);

	return c.json({ id: messageId, status: "sent" }, 202);
}
