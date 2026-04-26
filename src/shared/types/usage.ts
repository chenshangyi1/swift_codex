export type UsageSource = 'unsupported' | 'manual' | 'experimental';

export interface UsageSnapshot {
  accountName: string;
  hasAuth: boolean;
  canReadAuth: boolean;
  usageSupported: boolean;
  usageSource: UsageSource;
  fiveHourRemainingPercent: number | null;
  weeklyRemainingPercent: number | null;
  resetTime: string | null;
  lastChecked: string;
  errorMessage: string | null;
  note: string | null;
}

export interface ManualUsageInput {
  accountName: string;
  fiveHourRemainingPercent: number | null;
  weeklyRemainingPercent: number | null;
  resetTime: string | null;
  note: string | null;
}

export interface ManualUsageRecord extends ManualUsageInput {
  updatedAt: string;
}

export interface UsageRefreshResult {
  current: UsageSnapshot;
  accounts: UsageSnapshot[];
}

export interface UsageProvider {
  getUsageForCurrentAccount(): Promise<UsageSnapshot>;
  getUsageForSavedAccount(accountName: string): Promise<UsageSnapshot>;
  getUsageForAllAccounts(): Promise<UsageSnapshot[]>;
}
