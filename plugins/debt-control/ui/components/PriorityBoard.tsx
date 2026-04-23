import { Link } from "react-router";
import type { DebtCase } from "../../types";

const COLUMNS: Array<{ priority: string; label: string; color: string }> = [
	{ priority: "pay_now",               label: "Betal nå",       color: "border-red-300" },
	{ priority: "object_now",            label: "Bestrid nå",     color: "border-orange-300" },
	{ priority: "investigate_first",     label: "Undersøk",       color: "border-yellow-300" },
	{ priority: "already_paid_possible", label: "Mulig betalt",   color: "border-green-300" },
	{ priority: "waiting_response",      label: "Venter svar",    color: "border-blue-300" },
	{ priority: "low",                   label: "Lav prioritet",  color: "border-gray-200" },
];

interface Props {
	cases: DebtCase[];
	mailboxId: string;
}

export function PriorityBoard({ cases, mailboxId }: Props) {
	const byPriority = Object.fromEntries(
		COLUMNS.map((col) => [
			col.priority,
			cases.filter((c) => c.priority === col.priority),
		]),
	);

	const used = COLUMNS.filter((col) => byPriority[col.priority]?.length > 0);

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{used.map((col) => (
				<div key={col.priority} className={`border-l-4 ${col.color} bg-white rounded-xl p-4 space-y-2 shadow-sm`}>
					<h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
						{col.label}{" "}
						<span className="text-gray-400">({byPriority[col.priority].length})</span>
					</h3>
					{byPriority[col.priority].map((c) => (
						<CaseCard key={c.id} c={c} mailboxId={mailboxId} />
					))}
				</div>
			))}
		</div>
	);
}

function CaseCard({ c, mailboxId }: { c: DebtCase; mailboxId: string }) {
	return (
		<Link
			to={`/mailbox/${mailboxId}/debt/cases/${c.id}`}
			className="block rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 hover:bg-gray-100 transition-colors"
		>
			<p className="text-sm font-medium text-gray-900 truncate">{c.creditor}</p>
			<div className="flex items-center justify-between mt-0.5 text-xs text-gray-400">
				{c.amountDue != null && (
					<span>{c.amountDue.toLocaleString("nb-NO")} {c.currency}</span>
				)}
				{c.dueDate && (
					<span>{new Date(c.dueDate).toLocaleDateString("nb-NO")}</span>
				)}
			</div>
		</Link>
	);
}
