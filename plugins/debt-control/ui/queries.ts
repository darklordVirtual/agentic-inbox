import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

const KEYS = {
	settings: (mailboxId: string) => ["debt-control", "settings", mailboxId],
	bankStatus: (mailboxId: string) => ["debt-control", "bank", mailboxId],
	cases: (mailboxId: string, status?: string) => ["debt-control", "cases", mailboxId, status ?? "all"],
	case: (mailboxId: string, caseId: string) => ["debt-control", "case", mailboxId, caseId],
};

export function useDebtSettings(mailboxId: string | undefined) {
	return useQuery({
		queryKey: mailboxId ? KEYS.settings(mailboxId) : ["disabled"],
		queryFn: () => api.getSettings(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useUpdateDebtSettings(
	mailboxId: string,
	callbacks?: { onSuccess?: () => void; onError?: (err: Error) => void },
) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: Parameters<typeof api.updateSettings>[1]) =>
			api.updateSettings(mailboxId, patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: KEYS.settings(mailboxId) });
			callbacks?.onSuccess?.();
		},
		onError: (err: Error) => callbacks?.onError?.(err),
	});
}

export function useBankStatus(mailboxId: string | undefined) {
	return useQuery({
		queryKey: mailboxId ? KEYS.bankStatus(mailboxId) : ["disabled"],
		queryFn: () => api.getBankStatus(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useTestBankConnection(mailboxId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.testBankConnection(mailboxId),
		onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.bankStatus(mailboxId) }),
	});
}

export function useTriggerSync(mailboxId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.triggerBankSync(mailboxId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: KEYS.bankStatus(mailboxId) });
			qc.invalidateQueries({ queryKey: KEYS.cases(mailboxId) });
		},
	});
}

export function useDebtCases(mailboxId: string | undefined, status?: string) {
	return useQuery({
		queryKey: mailboxId ? KEYS.cases(mailboxId, status) : ["disabled"],
		queryFn: () => api.listCases(mailboxId!, status),
		enabled: !!mailboxId,
	});
}

export function useDebtCase(mailboxId: string | undefined, caseId: string | undefined) {
	return useQuery({
		queryKey: mailboxId && caseId ? KEYS.case(mailboxId, caseId) : ["disabled"],
		queryFn: () => api.getCase(mailboxId!, caseId!),
		enabled: !!mailboxId && !!caseId,
	});
}

export function useReconcileCase(mailboxId: string, caseId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api.reconcileCase(mailboxId, caseId),
		onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.case(mailboxId, caseId) }),
	});
}

export function useDraftObjection(mailboxId: string, caseId: string) {
	return useMutation({
		mutationFn: (params: { kind?: string; senderName?: string }) =>
			api.draftObjection(mailboxId, caseId, params.kind, params.senderName),
	});
}

export function useRequestMoreInfo(mailboxId: string, caseId: string) {
	return useMutation({
		mutationFn: (params: { senderName?: string }) =>
			api.requestMoreInfo(mailboxId, caseId, params.senderName),
	});
}
