/**
 * DebtSidebarCard — shown in the email sidebar when the email
 * belongs to a known debt case.
 */

import { Link } from "react-router";
import { useDebtCases } from "../queries";

interface Props {
	mailboxId: string;
	emailId: string;
}

export function DebtSidebarCard({ mailboxId, emailId }: Props) {
	const { data: cases = [] } = useDebtCases(mailboxId);

	// Find cases where this email is the first or last linked email
	const linked = cases.filter(
		(c) => c.firstEmailId === emailId || c.lastEmailId === emailId,
	);

	if (linked.length === 0) return null;

	const c = linked[0];

	const PRIORITY_COLOR: Record<string, string> = {
		pay_now:               "text-red-600",
		object_now:            "text-orange-500",
		investigate_first:     "text-yellow-600",
		already_paid_possible: "text-green-600",
		waiting_response:      "text-blue-500",
		low:                   "text-gray-400",
	};

	return (
		<div className="border rounded-xl bg-white p-4 shadow-sm text-sm">
			<p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
				Debt Control
			</p>
			<p className="font-medium text-gray-900">{c.creditor}</p>
			{c.amountDue != null && (
				<p className="text-gray-500 text-xs mt-0.5">
					{c.amountDue.toLocaleString("nb-NO")} {c.currency}
					{c.dueDate && ` · forfall ${new Date(c.dueDate).toLocaleDateString("nb-NO")}`}
				</p>
			)}
			<p className={`mt-1 text-xs font-medium ${PRIORITY_COLOR[c.priority] ?? "text-gray-400"}`}>
				{c.priority.replace(/_/g, " ")}
			</p>
			<Link
				to={`/mailbox/${mailboxId}/debt/cases/${c.id}`}
				className="mt-3 block text-center rounded-lg bg-blue-600 text-white py-1.5 text-xs font-medium hover:bg-blue-700 transition-colors"
			>
				Åpne sak
			</Link>
		</div>
	);
}
