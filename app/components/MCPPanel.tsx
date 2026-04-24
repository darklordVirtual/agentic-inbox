// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Tooltip } from "@cloudflare/kumo";
import {
	ArrowSquareOutIcon,
	BrainIcon,
	CheckIcon,
	CopyIcon,
	EnvelopeIcon,
	KeyIcon,
	LinkIcon,
	PaperclipIcon,
	PlugsIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

// ── Primitives ────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch { /* ignore */ }
	};
	return (
		<Tooltip content={copied ? "Copied!" : "Copy"} asChild>
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={copied
					? <CheckIcon size={12} weight="bold" className="text-emerald-600" />
					: <CopyIcon size={12} />}
				onClick={handleCopy}
				aria-label="Copy to clipboard"
			/>
		</Tooltip>
	);
}

function CodeBlock({ code, lang = "json" }: { code: string; lang?: string }) {
	return (
		<div className="relative group rounded-lg border border-kumo-line overflow-hidden">
			<div className="absolute right-1.5 top-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
				<CopyButton text={code} />
			</div>
			<pre className={`bg-kumo-recessed text-kumo-default font-mono text-[11px] px-3.5 py-3 leading-relaxed overflow-x-auto whitespace-pre-wrap break-all lang-${lang}`}>
				{code}
			</pre>
		</div>
	);
}

function InlineCode({ children }: { children: string }) {
	return (
		<code className="font-mono text-[11px] bg-kumo-fill px-1 py-0.5 rounded text-kumo-default">
			{children}
		</code>
	);
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2.5">
			<div className="flex items-center gap-2.5">
				<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-kumo-brand text-white text-[11px] font-bold leading-none">
					{n}
				</div>
				<h4 className="text-xs font-semibold text-kumo-default">{title}</h4>
			</div>
			<div className="ml-[28px] space-y-2">
				{children}
			</div>
		</div>
	);
}

function SectionHeading({ children }: { children: React.ReactNode }) {
	return (
		<h3 className="text-[11px] font-semibold uppercase tracking-wider text-kumo-subtle pt-1">
			{children}
		</h3>
	);
}

// ── Tool catalogue ────────────────────────────────────────────────

type ToolGroup = { label: string; icon: React.ReactNode; tools: { name: string; desc: string }[] };

const TOOL_GROUPS: ToolGroup[] = [
	{
		label: "Mailboxes & Emails",
		icon: <EnvelopeIcon size={12} weight="bold" className="text-kumo-brand shrink-0" />,
		tools: [
			{ name: "list_mailboxes",  desc: "List all available mailboxes" },
			{ name: "list_emails",     desc: "List emails in a folder" },
			{ name: "get_email",       desc: "Read a full email with body + attachments" },
			{ name: "get_thread",      desc: "Load all messages in a conversation thread" },
			{ name: "search_emails",   desc: "Full-text search across subject and body" },
			{ name: "mark_email_read", desc: "Mark email as read or unread" },
			{ name: "move_email",      desc: "Move email to inbox, archive, trash, etc." },
		],
	},
	{
		label: "Drafts & Sending",
		icon: <WrenchIcon size={12} weight="bold" className="text-amber-500 shrink-0" />,
		tools: [
			{ name: "draft_reply",   desc: "Draft a reply — saves to Drafts, does not send" },
			{ name: "create_draft",  desc: "Create a new draft email" },
			{ name: "update_draft",  desc: "Update draft content" },
			{ name: "send_reply",    desc: "Send a reply (requires confirmation)" },
			{ name: "send_email",    desc: "Send a new outbound email" },
			{ name: "delete_email",  desc: "Permanently delete an email" },
		],
	},
	{
		label: "Attachments",
		icon: <PaperclipIcon size={12} weight="bold" className="text-blue-500 shrink-0" />,
		tools: [
			{ name: "read_attachment", desc: "Extract text from PDF or plain-text attachments" },
		],
	},
	{
		label: "Brain — Persistent Memory",
		icon: <BrainIcon size={12} weight="bold" className="text-emerald-600 shrink-0" />,
		tools: [
			{ name: "brain_remember", desc: "Store a persistent fact (sender, instruction, preference)" },
			{ name: "brain_recall",   desc: "Retrieve stored memories by scope and key" },
			{ name: "brain_summary",  desc: "Get all active memories for a mailbox" },
		],
	},
];

const totalTools = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);

// ── Main component ────────────────────────────────────────────────

export default function MCPPanel() {
	const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-app.workers.dev";
	const mcpUrl = `${baseUrl}/mcp`;
	const openApiUrl = `${baseUrl}/api/v1/openapi.json`;

	const isAccess = typeof window !== "undefined"
		? !window.location.hostname.includes("localhost") && !window.location.hostname.includes("127.0.0.1")
		: false;

	const claudeConfig = JSON.stringify(
		{
			mcpServers: {
				"agentic-inbox": {
					type: "http",
					url: mcpUrl,
					...(isAccess ? { headers: { "CF-Authorization": "Bearer <your-service-token>" } } : {}),
				},
			},
		},
		null, 2,
	);

	const cursorConfig = JSON.stringify(
		{
			mcpServers: {
				"agentic-inbox": {
					url: mcpUrl,
					transport: "http",
					...(isAccess ? { headers: { "CF-Authorization": "Bearer <your-service-token>" } } : {}),
				},
			},
		},
		null, 2,
	);

	const curlExample =
`curl -s "${mcpUrl}" \\
  -H "Content-Type: application/json"${isAccess ? ` \\
  -H "CF-Authorization: Bearer <your-service-token>"` : ""} \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">

				{/* ── Header ── */}
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-kumo-brand/10">
						<PlugsIcon size={18} weight="duotone" className="text-kumo-brand" />
					</div>
					<div>
						<h2 className="text-sm font-bold text-kumo-default leading-tight">Connect via MCP</h2>
						<p className="text-[11px] text-kumo-subtle">Model Context Protocol · {totalTools} tools</p>
					</div>
				</div>

				<p className="text-xs text-kumo-subtle leading-relaxed">
					This inbox exposes an MCP server so AI assistants (Claude Desktop, Cursor, Windsurf, etc.) can
					read emails, search threads, draft replies, and manage your mailbox using natural language.
					Follow the three steps below to connect.
				</p>

				{/* ── Step 1: Server URL ── */}
				<Step n={1} title="Copy the server URL">
					<div className="flex items-center gap-2 rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2.5">
						<LinkIcon size={12} className="text-kumo-subtle shrink-0" />
						<span className="flex-1 font-mono text-[11px] text-kumo-default break-all">{mcpUrl}</span>
						<CopyButton text={mcpUrl} />
					</div>
					<p className="text-[11px] text-kumo-subtle leading-relaxed">
						Transport: <InlineCode>HTTP / SSE</InlineCode>. The server accepts{" "}
						<InlineCode>POST</InlineCode> requests and supports long-lived SSE streams for streaming
						responses.
					</p>
				</Step>

				{/* ── Step 2: Auth ── */}
				<Step n={2} title="Authenticate">
					{isAccess ? (
						<div className="space-y-2">
							<div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
								<KeyIcon size={13} weight="fill" className="text-amber-500 shrink-0 mt-0.5" />
								<p className="text-[11px] text-amber-800 leading-relaxed">
									Your deployment is behind <strong>Cloudflare Access</strong>. Every MCP request must
									include a service token as a header:
								</p>
							</div>
							<CodeBlock code={`CF-Authorization: Bearer <your-service-token>`} lang="http" />
							<p className="text-[11px] text-kumo-subtle leading-relaxed">
								To get a service token: go to your{" "}
								<a
									href="https://one.dash.cloudflare.com/"
									target="_blank"
									rel="noopener noreferrer"
									className="text-kumo-brand hover:underline inline-flex items-center gap-0.5"
								>
									Zero Trust dashboard
									<ArrowSquareOutIcon size={10} />
								</a>
								{" "}→ <strong>Access → Service Auth → Create Service Token</strong>. Use the
								resulting <InlineCode>Client ID</InlineCode> and <InlineCode>Client Secret</InlineCode>{" "}
								as the Bearer value (format: <InlineCode>clientId.clientSecret</InlineCode>).
							</p>
						</div>
					) : (
						<div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
							<CheckIcon size={13} weight="bold" className="text-emerald-600 shrink-0 mt-0.5" />
							<p className="text-[11px] text-emerald-800 leading-relaxed">
								Running locally — no authentication required. In production deployments protected
								by Cloudflare Access, you will need a service token header.
							</p>
						</div>
					)}
				</Step>

				{/* ── Step 3: Configure your client ── */}
				<Step n={3} title="Configure your AI client">

					{/* Claude Desktop */}
					<div className="space-y-1.5">
						<p className="text-[11px] font-semibold text-kumo-default">Claude Desktop</p>
						<p className="text-[11px] text-kumo-subtle leading-relaxed">
							Edit <InlineCode>~/Library/Application Support/Claude/claude_desktop_config.json</InlineCode>{" "}
							(macOS) or <InlineCode>%APPDATA%\Claude\claude_desktop_config.json</InlineCode> (Windows):
						</p>
						<CodeBlock code={claudeConfig} />
					</div>

					{/* Cursor / Windsurf */}
					<div className="space-y-1.5">
						<p className="text-[11px] font-semibold text-kumo-default">Cursor / Windsurf</p>
						<p className="text-[11px] text-kumo-subtle leading-relaxed">
							Add to <InlineCode>.cursor/mcp.json</InlineCode> in your project root, or the global
							settings file for Windsurf:
						</p>
						<CodeBlock code={cursorConfig} />
					</div>

					{/* CLI */}
					<div className="space-y-1.5">
						<p className="text-[11px] font-semibold text-kumo-default">CLI / Custom client</p>
						<p className="text-[11px] text-kumo-subtle leading-relaxed">
							Any MCP-compatible HTTP client works. Example — list all available tools:
						</p>
						<CodeBlock code={curlExample} lang="bash" />
					</div>
				</Step>

				{/* ── OpenAPI spec ── */}
				<div className="space-y-2 pt-1">
					<SectionHeading>OpenAPI / REST spec</SectionHeading>
					<div className="flex items-center justify-between gap-3 rounded-lg border border-kumo-line bg-kumo-surface px-3 py-2.5">
						<div className="min-w-0">
							<p className="text-xs font-medium text-kumo-default">OpenAPI 3.1 spec</p>
							<p className="text-[11px] text-kumo-subtle font-mono truncate">{openApiUrl}</p>
						</div>
						<div className="flex items-center gap-1 shrink-0">
							<CopyButton text={openApiUrl} />
							<a
								href={openApiUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Button variant="ghost" shape="square" size="sm" icon={<ArrowSquareOutIcon size={12} />} aria-label="Open spec" />
							</a>
						</div>
					</div>
					<p className="text-[11px] text-kumo-subtle leading-relaxed">
						Import the spec into Postman, Insomnia, or any OpenAPI-compatible tool to explore all
						REST endpoints directly.
					</p>
				</div>

				{/* ── Available tools ── */}
				<div className="space-y-3 pt-1">
					<SectionHeading>Available Tools ({totalTools})</SectionHeading>
					{TOOL_GROUPS.map((group) => (
						<div key={group.label} className="space-y-1">
							<p className="text-[11px] font-semibold text-kumo-strong flex items-center gap-1.5">
								{group.icon}
								{group.label}
							</p>
							<div className="border border-kumo-line rounded-lg divide-y divide-kumo-line overflow-hidden">
								{group.tools.map((tool) => (
									<div key={tool.name} className="flex items-center gap-3 px-3 py-2 bg-kumo-surface">
										<code className="shrink-0 font-mono text-[11px] font-medium text-kumo-default">
											{tool.name}
										</code>
										<span className="text-[11px] text-kumo-subtle text-right ml-auto">{tool.desc}</span>
									</div>
								))}
							</div>
						</div>
					))}
				</div>

				{/* ── Footer link ── */}
				<a
					href="https://modelcontextprotocol.io/docs"
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 text-[11px] text-kumo-brand hover:underline pb-2"
				>
					MCP documentation
					<ArrowSquareOutIcon size={10} />
				</a>

			</div>
		</div>
	);
}
