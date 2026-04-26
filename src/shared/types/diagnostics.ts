export interface SwitchStepTiming {
  name:
    | 'validateAccountName'
    | 'ensureDirectories'
    | 'readSourceSnapshot'
    | 'backupCurrentAuth'
    | 'copySnapshotToAuth'
    | 'verifyAuthExists'
    | 'totalSwitchTime';
  durationMs: number;
  ok: boolean;
  detail?: string;
}

export interface SwitchTiming {
  accountName: string;
  startedAt: string;
  finishedAt: string;
  steps: SwitchStepTiming[];
  backupPath: string | null;
  sourceExists: boolean;
  authExistsAfterSwitch: boolean;
  totalMs: number;
}

export interface SnapshotIntegrity {
  exists: boolean;
  jsonValid: boolean;
  looksLikeCodexAuth: boolean;
  sizeBytes: number;
  modifiedAt: string | null;
  possiblyExpired: boolean;
  warning: string | null;
}

export interface ProxyDiagnostics {
  detected: boolean;
  variables: string[];
  unsetCommand: string;
}

export interface McpDiagnostics {
  configExists: boolean;
  configPath: string;
  hasMcpServers: boolean;
  serverCount: number;
}

export interface GitRepositoryDiagnostics {
  isGitRepo: boolean;
  root: string | null;
  trackedFiles: number | null;
  largeRepo: boolean;
}

export interface NetworkCheckResult {
  host: string;
  ok: boolean;
  durationMs: number;
  errorMessage: string | null;
}

export interface AuthReadinessDiagnostics {
  authPath: string;
  authExists: boolean;
  jsonValid: boolean;
  hasTokenField: boolean;
}

export interface CodexAppRuntimeDiagnostics {
  appSupportDir: string;
  runningProcessCount: number | null;
  appServerRunning: boolean | null;
  hasCookies: boolean;
  hasSessionStorage: boolean;
  hasLocalStorage: boolean;
  cacheItems: CodexAppCacheItem[];
  warning: string | null;
}

export interface CodexAppCacheItem {
  name: string;
  path: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'other' | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
}

export interface CodexAppSessionResetResult {
  appSupportDir: string;
  backupDir: string | null;
  movedItems: CodexAppCacheItem[];
  skippedItems: CodexAppCacheItem[];
  runningProcessCount: number | null;
  appServerRunning: boolean | null;
}

export interface StartupDiagnostics {
  accountName: string | null;
  checkedAt: string;
  ready: boolean;
  auth: AuthReadinessDiagnostics;
  mcp: McpDiagnostics;
  proxy: ProxyDiagnostics;
  git: GitRepositoryDiagnostics;
  codexApp: CodexAppRuntimeDiagnostics;
  network: NetworkCheckResult[];
  lastSwitchTiming: SwitchTiming | null;
  warnings: string[];
  suggestions: string[];
}
