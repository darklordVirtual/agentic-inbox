import { Badge } from "@cloudflare/kumo";
import {
	IdentificationCardIcon,
	SpinnerGapIcon,
	EnvelopeIcon,
	BuildingsIcon,
	MapPinIcon,
	ClockIcon,
} from "@phosphor-icons/react";
import { useParams } from "react-router";
import { useSenderReports } from "~/queries/agents";

const RELATIONSHIP_COLORS: Record<string, string> = {
	key_customer:    "bg-green-100 text-green-700",
	regular_contact: "bg-blue-100 text-blue-700",
	vendor:          "bg-purple-100 text-purple-700",
	cold_contact:    "bg-gray-100 text-gray-700",
	unknown:         "bg-gray-100 text-gray-500",
};

export default function SenderReportsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { data, isLoading } = useSenderReports(mailboxId, 50);

	const reports = data?.reports ?? [];

	return (
		<div className="h-full overflow-y-auto">
		<div className="max-w-4xl mx-auto py-10 px-6 space-y-6">
			<div>
				<h1 className="text-2xl font-bold text-kumo-default flex items-center gap-2">
					<IdentificationCardIcon size={24} />
					Sender Intelligence Reports
				</h1>
				<p className="text-kumo-subtle mt-1 text-sm">
					AI-generated profiles of senders who have contacted this mailbox.
				</p>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-12">
					<SpinnerGapIcon size={24} className="animate-spin text-kumo-subtle" />
				</div>
			) : reports.length === 0 ? (
				<div className="text-center py-16 border border-dashed border-kumo-line rounded-lg">
					<IdentificationCardIcon size={40} className="text-kumo-subtle mx-auto mb-3" />
					<p className="text-kumo-subtle text-sm">
						No sender reports yet. Enable a <strong>Researcher</strong> agent to automatically profile senders.
					</p>
				</div>
			) : (
				<div className="space-y-4">
					{reports.map((report) => (
						<div
							key={report.id}
							className="border border-kumo-line rounded-lg bg-kumo-surface p-5"
						>
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1 min-w-0">
									{/* Header */}
									<div className="flex items-center gap-2 flex-wrap">
										<span className="font-semibold text-kumo-default">
											{report.data?.name || report.emailAddress}
										</span>
										{report.data?.relationshipValue && (
											<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RELATIONSHIP_COLORS[report.data.relationshipValue] ?? RELATIONSHIP_COLORS.unknown}`}>
												{report.data.relationshipValue.replace(/_/g, " ")}
											</span>
										)}
									</div>

									{/* Meta */}
									<div className="flex items-center gap-3 mt-1 text-sm text-kumo-subtle flex-wrap">
										<span className="flex items-center gap-1">
											<EnvelopeIcon size={14} />
											{report.emailAddress}
										</span>
										{report.data?.organization && (
											<span className="flex items-center gap-1">
												<BuildingsIcon size={14} />
												{report.data.organization}
												{report.data.role ? ` · ${report.data.role}` : ""}
											</span>
										)}
										{report.data?.location && (
											<span className="flex items-center gap-1">
												<MapPinIcon size={14} />
												{report.data.location}
											</span>
										)}
									</div>

									{/* Summary */}
									<p className="mt-3 text-sm text-kumo-default leading-relaxed">
										{report.summary}
									</p>

									{/* Topics */}
									{(report.data?.topics ?? []).length > 0 && (
										<div className="mt-2 flex gap-1.5 flex-wrap">
											{report.data.topics!.map((topic) => (
												<Badge key={topic} variant="secondary" className="text-xs">{topic}</Badge>
											))}
										</div>
									)}
								</div>

								{/* Stats */}
								<div className="text-right shrink-0 text-xs text-kumo-subtle space-y-0.5">
									{report.emailCount && (
										<div>{report.emailCount} email{report.emailCount !== 1 ? "s" : ""}</div>
									)}
									{report.lastSeenAt && (
										<div className="flex items-center gap-1 justify-end">
											<ClockIcon size={12} />
											Last: {new Date(report.lastSeenAt).toLocaleDateString()}
										</div>
									)}
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
		</div>
	);
}
