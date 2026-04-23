import { useParams, Link } from "react-router";
import { useDebtCases } from "../queries";
import { PriorityBoard } from "../components/PriorityBoard";
import type { DebtCase } from "../../types";

const PRIORITY_LABELS: Record<string, string> = {
	pay_now:               "Betal nå",
	object_now:            "Bestrid nå",
	investigate_first:     "Undersøk",
	waiting_response:      "Venter svar",
	already_paid_possible: "Mulig betalt",
	low:                   "Lav prioritet",
};

export default function DebtDashboard() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { data, isLoading, error } = useDebtCases(mailboxId);

	if (isLoading) return <div className="p-6 text-sm text-gray-500">Laster saker…</div>;
	if (error)     return <div className="p-6 text-sm text-red-500">Feil ved henting av saker.</div>;

	const cases  = Array.isArray(data) ? data : [];
	const open   = cases.filter((c) => c.status === "open" || c.status === "disputed");
	const closed = cases.filter((c) => c.status === "paid" || c.status === "closed");

	return (
		<div className="p-6 max-w-4xl mx-auto">
			<div className="flex items-center justify-between mb-6">
				<h1 className="text-xl font-semibold text-gray-900">Gjeldsoversikt</h1>
				<Link
					to={`/mailbox/${mailboxId}/debt/settings`}
					className="text-sm text-blue-600 hover:underline"
				>
					Innstillinger
				</Link>
			</div>

			{open.length === 0 ? (
				<p className="text-sm text-gray-500">Ingen åpne saker.</p>
			) : (
				<PriorityBoard cases={open} mailboxId={mailboxId!} />
			)}

			{closed.length > 0 && (
				<div className="mt-8">
					<h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
						Lukkede saker
					</h2>
					<ul className="space-y-2">
						{closed.map((c) => (
							<CaseRow key={c.id} c={c} mailboxId={mailboxId!} />
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function CaseRow({ c, mailboxId }: { c: DebtCase; mailboxId: string }) {
	return (
		<li className="flex items-center justify-between bg-white border rounded-lg px-4 py-3 text-sm">
			<div>
				<span className="font-medium">{c.creditor}</span>
				{c.reference && (
					<span className="ml-2 text-gray-400 text-xs font-mono">{c.reference}</span>
				)}
			</div>
			<div className="flex items-center gap-4 text-gray-500">
				{c.amountDue != null && (
					<span>{c.amountDue.toLocaleString("nb-NO")} {c.currency}</span>
				)}
				<Link
					to={`/mailbox/${mailboxId}/debt/cases/${c.id}`}
					className="text-blue-600 hover:underline"
				>
					Åpne
				</Link>
			</div>
		</li>
	);
}
