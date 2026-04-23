// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	ArrowSquareOutIcon,
	BrainIcon,
	CheckIcon,
	CopyIcon,
	EnvelopeIcon,
	PaperclipIcon,
	PlugsIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API unavailable or permission denied — ignore silently
		}
	};

	return (
		<Tooltip content={copied ? "Copied!" : "Copy"} asChild>
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={
					copied ? (
						<CheckIcon size={12} weight="bold" className="text-kumo-success" />
					) : (
						<CopyIcon size={12} />
					)
				}
				onClick={handleCopy}
				aria-label="Copy to clipboard"
			/>
		</Tooltip>
	);
}

function CodeBlock({ code, copyText }: { code: string; copyText?: string }) {
	return (
		<div className="relative group">
			<div className="absolute right-1.5 top-1.5">
				<CopyButton text={copyText ?? code} />
			</div>
			<pre className="bg-kumo-recessed text-kumo-default font-mono text-[11px] px-3 py-2.5 pr-10 rounded-lg border border-kumo-line overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
				{code}
			</pre>
		</div>
	);
}

type ToolGroup = {
	label: string;
	icon: React.ReactNode;
	tools: { name: string; desc: string }[];
};

const TOOL_GROUPS: ToolGroup[] = [
	{
		label: "Mailboxes & Emails",
		icon: <EnvelopeIcon size={12} weight="bold" className="text-kumo-brand shrink-0" />,
		tools: [
			{ name: "list_mailboxes", desc: "List all available mailboxes" },
			{ name: "list_emails",    desc: "List emails in a folder" },
			{ name: "get_email",      desc: "Read a full email with body + attachments" },
			{ name: "get_thread",     desc: "Load all messages in a conversation thread" },
			{ name: "search_emails",  desc: "Full-text search across subject and body" },
			{ name: "mark_email_read", desc: "Mark email as read or unread" },
			{ name: "move_email",     desc: "Move email to inbox, archive, trash, etc." },
		],
	},
	{
		label: "Drafts & Sending",
		icon: <WrenchIcon size={12} weight="bold" className="text-kumo-warning shrink-0" />,
		tools: [
			{ name: "draft_reply",   desc: "Draft a reply — saves to Drafts, does not send" },
			{ name: "create_draft",  desc: "Create a new draft email" },
			{ name: "update_draft",  desc: "Update draft content" },
			{ name: "send_reply",    desc: "Send a reply (requires prior confirmation)" },
			{ name: "send_email",    desc: "Send a new outbound email" },
			{ name: "delete_email",  desc: "Permanently delete an email" },
		],
	},
	{
		label: "Attachments",
		icon: <PaperclipIcon size={12} weight="bold" className="text-kumo-info shrink-0" />,
		tools: [
			{ name: "read_attachment", desc: "Extract text from PDF or plain-text attachments" },
		],
	},
	{
		label: "Brain — Persistent Memory",
		icon: <BrainIcon size={12} weight="bold" className="text-kumo-success shrink-0" />,
		tools: [
			{ name: "brain_remember", desc: "Store a persistent fact (sender, instruction, preference)" },
			{ name: "brain_recall",   desc: "Retrieve stored memories by scope and key" },
			{ name: "brain_summary",  desc: "Get all active memories for a mailbox" },
		],
	},
];

export default function MCPPanel() {
	const baseUrl =
		typeof window !== "undefined" ? window.location.origin : "https://your-app.workers.dev";
	const mcpUrl = `${baseUrl}/mcp`;

	const claudeConfig = JSON.stringify(
		{
			mcpServers: {
				"agentic-inbox": {
					type: "http",
					url: mcpUrl,
				},
			},
		},
		null,
		2,
	);

	const cursorConfig = JSON.stringify(
		{
			mcpServers: {
				"agentic-inbox": {
					url: mcpUrl,
					transport: "http",
				},
			},
		},
		null,
		2,
	);

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
				{/* Header */}
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-kumo-brand/10">
							<PlugsIcon size={20} weight="duotone" className="text-kumo-brand" />
						</div>
						<div>
							<h3 className="text-sm font-semibold text-kumo-default">
								Connect via MCP
							</h3>
							<p className="text-xs text-kumo-subtle">Model Context Protocol</p>
						</div>
					</div>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						This inbox exposes an MCP server so AI assistants (Claude, Cursor,
						Windsurf, etc.) can read emails, search threads, draft replies, and
						manage your mailbox using natural language.
					</p>
				</div>

				{/* Server URL */}
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-kumo-strong block">
						Server URL
					</label>
					<div className="relative group">
						<div className="absolute right-1.5 top-1/2 -translate-y-1/2">
							<CopyButton text={mcpUrl} />
						</div>
						<div className="bg-kumo-recessed text-kumo-default font-mono text-[11px] px-3 py-2.5 pr-10 rounded-lg border border-kumo-line break-all leading-relaxed">
							{mcpUrl}
						</div>
					</div>
					<p className="text-[11px] text-kumo-subtle">
						Transport: <span className="font-mono">HTTP / SSE</span>. If your
						deployment is behind Cloudflare Access, include a valid{" "}
						<span className="font-mono">CF-Authorization: Bearer &lt;jwt&gt;</span>{" "}
						header. See your Access policy for how to obtain a service token.
					</p>
				</div>

				{/* Setup — Claude Desktop */}
				<div className="space-y-2">
					<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
						Claude Desktop
					</h4>
					<p className="text-[11px] text-kumo-subtle leading-relaxed">
						Add this to{" "}
						<span className="font-mono">~/Library/Application Support/Claude/claude_desktop_config.json</span>{" "}
						(macOS) or{" "}
						<span className="font-mono">%APPDATA%\Claude\claude_desktop_config.json</span>{" "}
						(Windows).
					</p>
					<CodeBlock code={claudeConfig} />
				</div>

				{/* Setup — Cursor */}
				<div className="space-y-2">
					<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
						Cursor / Windsurf
					</h4>
					<p className="text-[11px] text-kumo-subtle leading-relaxed">
						In your project or global{" "}
						<span className="font-mono">.cursor/mcp.json</span> (or Windsurf
						equivalent):
					</p>
					<CodeBlock code={cursorConfig} />
				</div>

				{/* Setup — CLI */}
				<div className="space-y-2">
					<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
						CLI / Custom Client
					</h4>
					<p className="text-[11px] text-kumo-subtle leading-relaxed">
						Use any MCP-compatible HTTP client. The server accepts POST to{" "}
						<span className="font-mono">/mcp</span> with{" "}
						<span className="font-mono">Content-Type: application/json</span>.
						Connections also support long-lived SSE streams for streaming
						responses.
					</p>
					<CodeBlock
						code={`# List all tools
curl -s "${mcpUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`}
					/>
					<a
						href="https://modelcontextprotocol.io/docs"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 text-[11px] text-kumo-brand hover:underline"
					>
						MCP documentation
						<ArrowSquareOutIcon size={11} />
					</a>
				</div>

				{/* Available tools */}
				<div className="space-y-3">
					<h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
						Available Tools ({TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0)})
					</h4>
					{TOOL_GROUPS.map((group) => (
						<div key={group.label} className="space-y-1">
							<p className="text-[11px] font-semibold text-kumo-strong flex items-center gap-1.5 px-0.5">
								{group.icon}
								{group.label}
							</p>
							<div className="border border-kumo-line rounded-lg divide-y divide-kumo-line">
								{group.tools.map((tool) => (
									<div
										key={tool.name}
										className="flex items-center gap-2.5 px-3 py-2"
									>
										<div className="min-w-0 flex-1">
											<span className="text-xs font-mono font-medium text-kumo-default">
												{tool.name}
											</span>
										</div>
										<span className="text-[11px] text-kumo-subtle shrink-0 text-right max-w-[180px]">
											{tool.desc}
										</span>
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
