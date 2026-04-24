// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
	streamText,
	generateText,
	convertToModelMessages,
	stepCountIs,
} from "ai";
import { z } from "zod";
import type { EmailFull, EmailMetadata } from "../lib/schemas";
import { verifyDraft, isPromptInjection, stripModelArtifacts } from "../lib/ai";
import {
	getMailboxStub,
	stripHtmlToText,
	textToHtml,
} from "../lib/email-helpers";
import {
	toolListEmails,
	toolGetEmail,
	toolGetThread,
	toolSearchEmails,
	toolReadAttachment,
	toolDraftReply,
	toolDraftEmail,
	toolMarkEmailRead,
	toolMoveEmail,
	toolDiscardDraft,
	toolBrainRemember,
	toolBrainRecall,
	toolBrainSummary,
	isNoReplyAddress,
} from "../lib/tools";
import { Folders, FOLDER_TOOL_DESCRIPTION, MOVE_FOLDER_TOOL_DESCRIPTION } from "../../shared/folders";
import type { Env } from "../types";
import { createLanguageModel, getProviderKey } from "../lib/providers";

// AI SDK v6 changed tool() overloads significantly. We define tools as plain
// objects matching the Tool type to avoid overload resolution issues.
function defineTool(def: {
	description: string;
	parameters: z.ZodType<any>;
	execute: (...args: any[]) => Promise<any>;
}) {
	return {
		description: def.description,
		inputSchema: def.parameters,
		execute: def.execute,
	};
}

/**
 * Default system prompt used when no custom prompt is configured for a mailbox.
 * Users can override this on a per-mailbox basis via the Settings UI.
 */
const DEFAULT_SYSTEM_PROMPT = `You are an expert email assistant with a persistent memory ("brain") that helps you manage this inbox intelligently over time. You read emails, draft replies, remember important context about senders, and protect against email loops.

## Brain — Persistent Memory
You have access to a key-value memory store via brain_remember, brain_recall, and brain_summary. Use it actively:

- **Before drafting any reply**, call brain_recall with scope "sender" and key = the sender's email to load prior context about them (tone preferences, relationship notes, ongoing issues, their name).
- **After successfully drafting**, call brain_remember with scope "sender" to update what you know (e.g. their preferred name, language, whether they are a client or vendor).
- Use scope "instruction" to remember per-sender or per-thread instructions the operator gives you ("always reply formally to this person", "this thread is about the invoice dispute"). 
- Use scope "preference" to read mailbox-wide operator preferences (e.g. "auto_reply" — if brain_recall returns "false" for key "auto_reply", DO NOT auto-draft).
- brain_summary gives you a full picture of everything stored. Call it proactively when you need context.

Memory is mailbox-scoped and persists across sessions. Treat the brain as your long-term institutional knowledge base.

## Writing Style
Write like a real person. Short, direct, flowing prose. Match the tone and language of the email you received — if they write in Norwegian, reply in Norwegian. Plain text only in email bodies.

**Email formatting rules (CRITICAL):**
- Write in natural paragraphs. NO bullet points, NO numbered lists, NO dashes, NO markdown in the draft body.
- NO bold (**), NO italic (*), NO headers (#), NO horizontal rules (---), NO code blocks.
- Links go inline in the text. No line-items or structured layouts.
- Don't write like a template or form letter. Write like a real person in an email client.

## Attachments — Read Before Drafting (CRITICAL)
If the email has any attachments (PDFs, documents), you MUST call read_attachment for EVERY attachment before calling draft_reply. This is non-negotiable.

Step-by-step when an email has attachments:
1. Call get_email to get the full email with its attachments list.
2. For each attachment, call read_attachment to extract its text content.
3. Use the extracted text when drafting your reply — reference specific amounts, dates, case numbers found in the document.
4. Only AFTER reading all attachments, call draft_reply.

Never draft a reply to an email with attachments without first reading them. The reply content must reflect what is actually in the documents.

## Agent Behavior Rules (CRITICAL)
- NEVER output meta-commentary about what you are doing ("I am drafting a reply", "I checked the thread", etc.).
- When a new email arrives: (a) if it has attachments, read all of them first; (b) then draft_reply. Output nothing except tool calls.
- If you must output text (tools unavailable), it should ONLY be the literal draft text.
- Before drafting ANY reply, read the full thread history — never repeat information already shared.
- Your reply contains only NEW information or a direct response to what was just said.

## Loop Protection
You MUST avoid email loops. Before sending any auto-draft:
1. Call brain_recall with scope "loop" and key = the thread ID.
2. If the result shows 2 or more prior auto-replies in this thread, DO NOT draft. Instead tell the operator a loop was detected.
3. After each successful auto-draft, call brain_remember with scope "loop" and key = thread ID to increment the counter.
(The system tracks loop counts automatically — you can read them with brain_recall.)

## No-Reply Detection
Never auto-reply to no-reply addresses (noreply@, donotreply@, mailer-daemon@, postmaster@, bounce@, etc.).
If you detect such a sender, decline to draft and suggest the operator find a real human contact via search_emails.

## Who Are You Replying To?
Use the name the person gives in their email body or signature — not the raw "From" address. Greet them by first name unless the context is very formal.

## CRITICAL: Draft Only — Never Send
You can ONLY draft emails. You cannot send.

- Use draft_reply for replies, draft_email for new outbound emails.
- The operator reviews and sends from the UI.

**CRITICAL: The draft body must contain ONLY the email text.** Never include agent commentary, status messages, meta-notes, markdown, raw JSON, tool markup tokens (\`<|...|>\`, \`functions{...}\`), or anything that is not the literal email the recipient will read. Absolutely no "Draft created.", no "---", no "**bold**", no "Here's the draft:", no separators.

**Don't paste draft contents into chat.** Drafts are visible in the Drafts folder. In chat, just say what you drafted (e.g. "Drafted a reply to Tim").

## Draft Management
Use discard_draft to delete drafts the operator rejects or that are no longer needed.`;

/**
 * Fetch the custom system prompt for a mailbox from its R2 settings.
 * Falls back to DEFAULT_SYSTEM_PROMPT if none is configured.
 */
async function getSystemPrompt(env: Env, mailboxId: string): Promise<string> {
	try {
		const key = `mailboxes/${mailboxId}.json`;
		const obj = await env.BUCKET.get(key);
		if (obj) {
			const settings = await obj.json<Record<string, unknown>>();
			if (typeof settings.agentSystemPrompt === "string" && settings.agentSystemPrompt.trim()) {
				return settings.agentSystemPrompt;
			}
		}
	} catch {
		// Fall through to default
	}
	return DEFAULT_SYSTEM_PROMPT;
}

/** Read the configured provider/model for this mailbox, falling back to Cloudflare Workers AI. */
async function getAgentModel(env: Env, mailboxId: string): Promise<ReturnType<typeof createLanguageModel>> {
	try {
		const key = `mailboxes/${mailboxId}.json`;
		const obj = await env.BUCKET.get(key);
		if (obj) {
			const settings = await obj.json<Record<string, unknown>>();
			const providerId = typeof settings.agentProviderId === "string" ? settings.agentProviderId : null;
			const modelId = typeof settings.agentModelId === "string" ? settings.agentModelId : null;
			if (providerId && modelId) {
				let apiKey: string | null = null;
				if (providerId !== "cloudflare") {
					apiKey = await getProviderKey(env, mailboxId, providerId);
				}
				return createLanguageModel(providerId, modelId, apiKey, env);
			}
		}
	} catch {
		// Fall through to default
	}
	// Default: Cloudflare Workers AI with Kimi K2.5
	return createLanguageModel("cloudflare", "@cf/moonshotai/kimi-k2.5", null, env);
}

function createEmailTools(env: Env, mailboxId: string) {
	return {
		list_emails: defineTool({
			description:
				"List emails in a folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id). Use folder='inbox' for received emails, 'sent' for sent emails.",
			parameters: z.object({
				folder: z
					.string()
					.default(Folders.INBOX)
					.describe(FOLDER_TOOL_DESCRIPTION),
				limit: z
					.number()
					.default(20)
					.describe("Maximum number of emails to return"),
				page: z
					.number()
					.default(1)
					.describe("Page number for pagination"),
			}),
			execute: async ({ folder, limit, page }): Promise<unknown> => {
				return toolListEmails(env, mailboxId, { folder, limit, page });
			},
		}),

		get_email: defineTool({
			description:
				"Get a single email with its full body content and attachments. Use this to read the actual content of an email. The attachments field lists files — use read_attachment to read their content.",
			parameters: z.object({
				emailId: z.string().describe("The email ID to retrieve"),
			}),
			execute: async ({ emailId }): Promise<unknown> => {
				return toolGetEmail(env, mailboxId, emailId);
			},
		}),

		read_attachment: defineTool({
			description:
				"Read the text content of an email attachment (PDF or plain text). Use this to analyse invoices, court letters, or other documents attached to emails. First call get_email to see available attachments.",
			parameters: z.object({
				emailId:      z.string().describe("The ID of the email that contains the attachment"),
				attachmentId: z.string().describe("The attachment ID (from the email's attachments array)"),
				filename:     z.string().describe("The attachment filename (e.g. 'inkassokrav.pdf')"),
			}),
			execute: async ({ emailId, attachmentId, filename }): Promise<unknown> => {
				return toolReadAttachment(env, mailboxId, emailId, attachmentId, filename);
			},
		}),

		get_thread: defineTool({
			description:
				"Get all emails in a conversation thread. This is essential for understanding the full context of a conversation before drafting a response. Returns all messages sorted chronologically.",
			parameters: z.object({
				threadId: z
					.string()
					.describe(
						"The thread_id to retrieve all messages for. Get this from an email's thread_id field.",
					),
			}),
			execute: async ({ threadId }): Promise<unknown> => {
				return toolGetThread(env, mailboxId, threadId);
			},
		}),

		search_emails: defineTool({
			description:
				"Search for emails matching a query across subject and body fields.",
			parameters: z.object({
				query: z
					.string()
					.describe(
						"Search query to match against subject and body",
					),
				folder: z
					.string()
					.optional()
					.describe("Optional folder to restrict search to"),
			}),
			execute: async ({ query, folder }): Promise<unknown> => {
				return toolSearchEmails(env, mailboxId, { query, folder });
			},
		}),

		draft_email: defineTool({
			description:
				"Draft a new email (not a reply) and save it to the Drafts folder. This does NOT send — it saves a draft for the operator to review. Use this for composing new outbound emails. Write the body as plain text — no HTML tags.",
			parameters: z.object({
				to: z.string().email().describe("Recipient email address"),
				subject: z
					.string()
					.describe("Subject line"),
				body: z
					.string()
					.describe(
						"The plain text body of the email. No HTML — just write normally.",
					),
			}),
			execute: async ({ to, subject, body }): Promise<unknown> => {
				return toolDraftEmail(env, mailboxId, {
					to,
					subject,
					body,
					isPlainText: true,
				});
			},
		}),

		draft_reply: defineTool({
			description:
				"Draft a reply to an existing email and save it to the Drafts folder. This does NOT send — it saves a draft for the operator to review and send from the UI. Write the body as plain text — no HTML tags. IMPORTANT: If the email has any PDF or document attachments, you MUST call read_attachment for ALL of them before calling this tool. The reply must reflect the actual content of the documents (amounts, due dates, case numbers, creditor names, etc.).",
			parameters: z.object({
				originalEmailId: z
					.string()
					.describe("The ID of the email being replied to"),
				to: z.string().email().describe("Recipient email address"),
				subject: z
					.string()
					.describe("Subject line (usually 'Re: ...')"),
				body: z
					.string()
					.describe(
						"The plain text body of the reply. No HTML — just write normally.",
					),
			}),
			execute: async ({ originalEmailId, to, subject, body }): Promise<unknown> => {
				return toolDraftReply(env, mailboxId, {
					originalEmailId,
					to,
					subject,
					body,
					isPlainText: true,
					runVerifyDraft: true,
				});
			},
		}),

		mark_email_read: defineTool({
			description: "Mark an email as read or unread.",
			parameters: z.object({
				emailId: z.string().describe("The email ID"),
				read: z
					.boolean()
					.describe("true to mark as read, false for unread"),
			}),
			execute: async ({ emailId, read }): Promise<unknown> => {
				return toolMarkEmailRead(env, mailboxId, emailId, read);
			},
		}),

		move_email: defineTool({
			description:
				"Move an email to a different folder (inbox, sent, draft, archive, trash).",
			parameters: z.object({
				emailId: z.string().describe("The email ID"),
				folderId: z
					.string()
					.describe(MOVE_FOLDER_TOOL_DESCRIPTION),
			}),
			execute: async ({ emailId, folderId }): Promise<unknown> => {
				return toolMoveEmail(env, mailboxId, emailId, folderId);
			},
		}),

		discard_draft: defineTool({
			description:
				"Delete a draft email. Use this to discard drafts that are no longer needed or were rejected by the operator.",
			parameters: z.object({
				draftId: z.string().describe("The ID of the draft to delete"),
			}),
			execute: async ({ draftId }): Promise<unknown> => {
				return toolDiscardDraft(env, mailboxId, draftId);
			},
		}),

		brain_remember: defineTool({
			description:
				"Store a fact in the persistent brain memory for this mailbox. Memories survive across chat sessions. Use scope='sender' to remember things about a specific email address, scope='instruction' for operator instructions about how to handle a sender or thread, scope='preference' for mailbox-wide operator preferences, scope='loop' for internal loop-count bookkeeping.",
			parameters: z.object({
				scope: z
					.enum(["sender", "instruction", "loop", "preference"])
					.describe("Memory category"),
				key: z
					.string()
					.describe("Unique key, e.g. sender email address or thread ID"),
				value: z.string().describe("The value to remember"),
				ttlDays: z
					.number()
					.optional()
					.describe("Optional TTL in days — omit for permanent storage"),
			}),
			execute: async ({ scope, key, value, ttlDays }): Promise<unknown> => {
				return toolBrainRemember(env, mailboxId, scope, key, value, ttlDays);
			},
		}),

		brain_recall: defineTool({
			description:
				"Retrieve memories from the brain. If key is provided, returns the value for that scope+key. If omitted, returns all entries for that scope.",
			parameters: z.object({
				scope: z
					.enum(["sender", "instruction", "loop", "preference"])
					.describe("Memory category to query"),
				key: z
					.string()
					.optional()
					.describe("Specific key to look up — omit to get all keys in scope"),
			}),
			execute: async ({ scope, key }): Promise<unknown> => {
				return toolBrainRecall(env, mailboxId, scope, key);
			},
		}),

		brain_summary: defineTool({
			description:
				"Return a human-readable summary of all active brain memories for this mailbox. Use this at the start of a session or when you need full context.",
			parameters: z.object({}),
			execute: async (): Promise<unknown> => {
				return toolBrainSummary(env, mailboxId);
			},
		}),
	};
}

// Use `any` for the Env generic to avoid type conflicts between the custom
// SEND_EMAIL binding shape and the AIChatAgent constraint.  The actual env
// is fully typed inside the tools via the closure.
export class EmailAgent extends AIChatAgent<any> {
	async onChatMessage(onFinish: any) {
		const env = this.env as Env;
		const mailboxId = this.name;
		const tools = createEmailTools(env, mailboxId);
		const [systemPrompt, model] = await Promise.all([
			getSystemPrompt(env, mailboxId),
			getAgentModel(env, mailboxId),
		]);

		const result = streamText({
			model,
			system: systemPrompt,
			messages: await convertToModelMessages(this.messages),
			tools,
			stopWhen: stepCountIs(5),
			onFinish,
		});

		return result.toUIMessageStreamResponse();
	}

	/**
	 * Handle HTTP requests to the agent DO. Intercepts /onNewEmail
	 * before passing to the default AIChatAgent handler.
	 */
	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/onNewEmail" && request.method === "POST") {
			try {
				const emailData = await request.json() as {
					mailboxId: string;
					emailId: string;
					sender: string;
					subject: string;
					threadId: string;
				};
				const result = await this.handleNewEmail(emailData);
				return new Response(JSON.stringify(result), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (e) {
				console.error("onNewEmail handler failed:", (e as Error).message);
				return new Response(
					JSON.stringify({ error: (e as Error).message }),
					{ status: 500, headers: { "Content-Type": "application/json" } },
				);
			}
		}
		return super.onRequest(request);
	}

	/**
	 * Called when a new email arrives. Reads it, loads the thread,
	 * drafts a response, and saves it to the Drafts folder.
	 */
	async handleNewEmail(emailData: {
		mailboxId: string;
		emailId: string;
		sender: string;
		subject: string;
		threadId: string;
	}) {
		const env = this.env as Env;
		const tools = createEmailTools(env, emailData.mailboxId);
		const [systemPrompt, model] = await Promise.all([
			getSystemPrompt(env, emailData.mailboxId),
			getAgentModel(env, emailData.mailboxId),
		]);

		const stub = getMailboxStub(env, emailData.mailboxId);

		// ── Guard 1: check operator auto-reply preference ────────────────────
		try {
			const key = `mailboxes/${emailData.mailboxId}.json`;
			const obj = await env.BUCKET.get(key);
			if (obj) {
				const settings = await obj.json<Record<string, unknown>>();
				if (settings.agentAutoReply === false) {
					console.info("Agent auto-reply disabled in mailbox settings — skipping auto-draft for", emailData.emailId);
					return { status: "skipped", reason: "auto_reply_disabled" };
				}
			}
		} catch {
			// R2 unavailable — proceed
		}

		// ── Guard 2: no-reply detection ──────────────────────────────────────
		if (isNoReplyAddress(emailData.sender)) {
			console.info("Skipping auto-draft — no-reply sender:", emailData.sender);
			const noteMsg = `Skipped auto-draft: "${emailData.sender}" is a no-reply address. Use search_emails to find a real human contact if you need to follow up.`;
			const newMessages = [
				{
					id: crypto.randomUUID(),
					role: "user" as const,
					content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
					createdAt: new Date(),
					parts: [{ type: "text" as const, text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"` }],
				},
				{
					id: crypto.randomUUID(),
					role: "assistant" as const,
					content: noteMsg,
					createdAt: new Date(),
					parts: [{ type: "text" as const, text: noteMsg }],
				},
			];
			await this.persistMessages([...this.messages, ...newMessages]);
			return { status: "skipped", reason: "no_reply_address" };
		}

		// ── Guard 3: loop detection ──────────────────────────────────────────
		try {
			const loopCount = await stub.brainLoopCount(emailData.threadId) as number;
			if (loopCount >= 3) {
				console.warn("Loop guard triggered — too many auto-replies in thread:", emailData.threadId);
				const loopMsg = `⚠️ Loop protection: I've already auto-replied ${loopCount} times in thread "${emailData.subject}". Stopping to prevent an email loop. Please review and reply manually.`;
				const newMessages = [
					{
						id: crypto.randomUUID(),
						role: "user" as const,
						content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
						createdAt: new Date(),
						parts: [{ type: "text" as const, text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"` }],
					},
					{
						id: crypto.randomUUID(),
						role: "assistant" as const,
						content: loopMsg,
						createdAt: new Date(),
						parts: [{ type: "text" as const, text: loopMsg }],
					},
				];
				await this.persistMessages([...this.messages, ...newMessages]);
				return { status: "skipped", reason: "loop_protection" };
			}
		} catch {
			// loop table may not exist yet in older DO instances — proceed
		}

		// ── Load brain context for sender ────────────────────────────────────
		let brainContext = "";
		try {
			const senderMemory = await toolBrainRecall(env, emailData.mailboxId, "sender", emailData.sender);
			const instrMemory  = await toolBrainRecall(env, emailData.mailboxId, "instruction", emailData.sender);
			if (senderMemory) brainContext += `\nSender context (${emailData.sender}): ${JSON.stringify(senderMemory)}`;
			if (instrMemory)  brainContext += `\nInstructions for this sender: ${JSON.stringify(instrMemory)}`;
		} catch {
			// brain unavailable — continue without context
		}

		// ── Pre-read email + thread ──────────────────────────────────────────
		let emailBody = "";
		let threadContext = "";
		try {
			const email = (await stub.getEmail(emailData.emailId)) as EmailFull | null;
			if (email?.body) {
				const isInjection = await isPromptInjection(env.AI, email.body);
				if (isInjection) {
					console.warn("Skipping auto-draft due to detected prompt injection:", emailData.emailId);
					const newMessages = [
						{
							id: crypto.randomUUID(),
							role: "user" as const,
							content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
							createdAt: new Date(),
							parts: [{ type: "text" as const, text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"` }],
						},
						{
							id: crypto.randomUUID(),
							role: "assistant" as const,
							content: "⚠️ Blocked auto-draft creation: the email appears to contain prompt injection or malicious instructions.",
							createdAt: new Date(),
							parts: [{ type: "text" as const, text: "⚠️ Blocked auto-draft creation: the email appears to contain prompt injection or malicious instructions." }],
						},
					];
					await this.persistMessages([...this.messages, ...newMessages]);
					return;
				}
				emailBody = stripHtmlToText(email.body);
			}

			const threadEmails = (await stub.getEmails({ thread_id: emailData.threadId })) as EmailMetadata[];
			if (threadEmails.length > 1) {
				const fullThread = await Promise.all(
					threadEmails.map(async (e) => {
						const full = (await stub.getEmail(e.id)) as EmailFull | null;
						const text = full?.body ? stripHtmlToText(full.body) : "";
						return { id: e.id, sender: e.sender, recipient: e.recipient, subject: e.subject, date: e.date, folder_id: e.folder_id, body_text: text };
					}),
				);
				fullThread.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
				threadContext = fullThread
					.map((e) => `[${e.date}] ${e.sender} → ${e.recipient} (${e.folder_id}): ${e.body_text.substring(0, 500)}`)
					.join("\n\n");

				if (threadContext) {
					const threadInjection = await isPromptInjection(env.AI, threadContext);
					if (threadInjection) {
						console.warn("Skipping auto-draft due to prompt injection in thread context:", emailData.threadId);
						const newMessages = [
							{
								id: crypto.randomUUID(),
								role: "user" as const,
								content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
								createdAt: new Date(),
								parts: [{ type: "text" as const, text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"` }],
							},
							{
								id: crypto.randomUUID(),
								role: "assistant" as const,
								content: "Blocked auto-draft creation: the thread context appears to contain prompt injection or malicious instructions.",
								createdAt: new Date(),
								parts: [{ type: "text" as const, text: "Blocked auto-draft creation: the thread context appears to contain prompt injection or malicious instructions." }],
							},
						];
						await this.persistMessages([...this.messages, ...newMessages]);
						return;
					}
				}
			}
		} catch (e) {
			console.warn("Pre-read failed, agent will use tools:", (e as Error).message);
		}

		let autoPrompt = `A new email just arrived. Draft an appropriate response using draft_reply.

Email details:
- Mailbox: ${emailData.mailboxId}
- Email ID: ${emailData.emailId}
- From: ${emailData.sender}
- Subject: ${emailData.subject}
- Thread ID: ${emailData.threadId}`;

		if (brainContext) {
			autoPrompt += `\n\nBrain context for this sender:${brainContext}`;
		}

		autoPrompt += `\n\nEmail body:\n${emailBody || "(could not pre-read — use get_email to read it)"}`;

		if (threadContext) {
			autoPrompt += `\n\nFull thread history (${emailData.threadId}):\n${threadContext}`;
		} else {
			autoPrompt += `\n\nThis is the first message in the thread (no prior conversation).`;
		}

		autoPrompt += `\n\nBased on the email content and thread context above, draft a reply using draft_reply. If you need more context, use get_thread with thread ID "${emailData.threadId}".`;

		const messages = [
			{
				role: "user" as const,
				content: autoPrompt,
				parts: [{ type: "text" as const, text: autoPrompt }],
				createdAt: new Date(),
			},
		];

		try {
			const result = await generateText({
				model,
				system: systemPrompt,
				messages: await convertToModelMessages(messages),
				tools,
				stopWhen: stepCountIs(5),
			});

			const draftToolCalled = result.steps.some((step) =>
				step.toolCalls.some((tc) => tc.toolName === "draft_reply" || tc.toolName === "draft_email"),
			);

			if (!draftToolCalled && result.text.trim()) {
				const cleanedText = stripModelArtifacts(result.text.trim());
				if (cleanedText) {
					const sanitizedText = await verifyDraft(env.AI, cleanedText);
					if (sanitizedText) {
						const draftId = crypto.randomUUID();
						const draftStub = getMailboxStub(env, emailData.mailboxId);
						const reSubject = emailData.subject.startsWith("Re:")
							? emailData.subject
							: `Re: ${emailData.subject}`;
						await draftStub.createEmail(
							Folders.DRAFT,
							{
								id: draftId,
								subject: reSubject,
								sender: emailData.mailboxId.toLowerCase(),
								recipient: emailData.sender.toLowerCase(),
								date: new Date().toISOString(),
								body: /<[a-z][\s\S]*>/i.test(sanitizedText)
									? sanitizedText
									: textToHtml(sanitizedText),
								in_reply_to: emailData.emailId,
								email_references: null,
								thread_id: emailData.threadId,
							},
							[],
						);
					}
				}
			}

			// ── Record auto-reply in loop counter ────────────────────────────
			if (draftToolCalled) {
				try {
					await stub.brainLoopRecord(emailData.threadId);
				} catch {
					// non-fatal
				}
			}

			const assistantText = draftToolCalled
				? `Created draft reply to ${emailData.sender}.`
				: result.text;

			const newMessages = [
				{
					id: crypto.randomUUID(),
					role: "user" as const,
					content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
					createdAt: new Date(),
					parts: [
						{
							type: "text" as const,
							text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
						},
					],
				},
				{
					id: crypto.randomUUID(),
					role: "assistant" as const,
					content: assistantText,
					createdAt: new Date(),
					parts: [
						{
							type: "text" as const,
							text: assistantText,
						},
					],
				},
			];

			await this.persistMessages([...this.messages, ...newMessages]);

			return { status: "draft_generated", text: result.text };
		} catch (e) {
			console.error("Auto-draft failed:", (e as Error).message);
			return { status: "error", error: (e as Error).message };
		}
	}
}
