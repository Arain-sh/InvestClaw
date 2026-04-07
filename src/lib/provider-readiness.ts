import type { ProviderAccount, ProviderWithKeyInfo } from '@/lib/providers';
import { hasConfiguredCredentials } from '@/lib/provider-accounts';

export function hasAvailableProvider(
  accounts: ProviderAccount[] | null | undefined,
  statuses: ProviderWithKeyInfo[] | null | undefined,
): boolean {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const safeStatuses = Array.isArray(statuses) ? statuses : [];
  const statusMap = new Map(safeStatuses.map((status) => [status.id, status]));

  if (safeAccounts.length > 0) {
    return safeAccounts.some((account) => (
      account.enabled !== false
      && hasConfiguredCredentials(account, statusMap.get(account.id))
    ));
  }

  return safeStatuses.some((status) => status.enabled !== false && status.hasKey);
}
