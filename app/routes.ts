// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	index,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("mailbox/:mailboxId", "routes/mailbox.tsx", [
		index("routes/mailbox-index.tsx"),
		route("emails/:folder", "routes/email-list.tsx"),
		route("settings", "routes/settings.tsx"),
		route("search", "routes/search-results.tsx"),
		// Debt Control plugin routes
		route("debt", "../plugins/debt-control/ui/routes/debt-dashboard.tsx"),
		route("debt/cases/:caseId", "../plugins/debt-control/ui/routes/debt-case.tsx"),
		route("debt/settings", "../plugins/debt-control/ui/routes/debt-settings.tsx"),
		route("debt/bank", "../plugins/debt-control/ui/routes/bank-settings.tsx"),
	]),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
