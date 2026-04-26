import type { SnapshotIntegrity, SwitchTiming } from './types/diagnostics';

export interface CodexStatus {
  codexDir: string;
  authPath: string;
  accountsDir: string;
  backupsDir: string;
  hasAuth: boolean;
  authUpdatedAt: string | null;
}

export interface AccountSnapshot {
  name: string;
  fileName: string;
  filePath: string;
  updatedAt: string;
  sizeBytes: number;
  integrity: SnapshotIntegrity;
}

export interface OperationResult<T = undefined> {
  ok: boolean;
  message: string;
  data?: T;
}

export interface SwitchAccountResult {
  backupPath: string | null;
  switchedTo: string;
  timing: SwitchTiming;
}

export type {
  AuthReadinessDiagnostics,
  CodexAppCacheItem,
  GitRepositoryDiagnostics,
  McpDiagnostics,
  NetworkCheckResult,
  ProxyDiagnostics,
  SnapshotIntegrity,
  StartupDiagnostics,
  CodexAppSessionResetResult,
  SwitchStepTiming,
  SwitchTiming
} from './types/diagnostics';

export type {
  ManualUsageInput,
  ManualUsageRecord,
  UsageProvider,
  UsageRefreshResult,
  UsageSnapshot,
  UsageSource
} from './types/usage';
