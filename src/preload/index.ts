import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountSnapshot,
  CodexAppSessionResetResult,
  CodexStatus,
  ManualUsageInput,
  OperationResult,
  StartupDiagnostics,
  SwitchAccountResult,
  SwitchTiming,
  UsageRefreshResult,
  UsageSnapshot
} from '../shared/types';

const api = {
  getCodexStatus: (): Promise<OperationResult<CodexStatus>> => ipcRenderer.invoke('codex:get-status'),
  listAccounts: (): Promise<OperationResult<AccountSnapshot[]>> => ipcRenderer.invoke('codex:list-accounts'),
  saveCurrentAccount: (name: string): Promise<OperationResult<AccountSnapshot>> =>
    ipcRenderer.invoke('codex:save-current-account', name),
  switchAccount: (name: string): Promise<OperationResult<SwitchAccountResult>> =>
    ipcRenderer.invoke('codex:switch-account', name),
  deleteAccount: (name: string): Promise<OperationResult> => ipcRenderer.invoke('codex:delete-account', name),
  openCodexDir: (): Promise<OperationResult> => ipcRenderer.invoke('codex:open-dir'),
  getCurrentUsage: (): Promise<OperationResult<UsageSnapshot>> => ipcRenderer.invoke('codex:get-current-usage'),
  getAccountUsage: (name: string): Promise<OperationResult<UsageSnapshot>> =>
    ipcRenderer.invoke('codex:get-account-usage', name),
  getAllAccountsUsage: (): Promise<OperationResult<UsageSnapshot[]>> =>
    ipcRenderer.invoke('codex:get-all-accounts-usage'),
  refreshUsage: (name?: string): Promise<OperationResult<UsageRefreshResult | UsageSnapshot>> =>
    ipcRenderer.invoke('codex:refresh-usage', name),
  saveManualUsage: (input: ManualUsageInput): Promise<OperationResult<UsageSnapshot>> =>
    ipcRenderer.invoke('codex:save-manual-usage', input),
  openUsagePage: (): Promise<OperationResult> => ipcRenderer.invoke('codex:open-usage-page'),
  runStartupDiagnostics: (accountName?: string): Promise<OperationResult<StartupDiagnostics>> =>
    ipcRenderer.invoke('codex:run-startup-diagnostics', accountName),
  getLastSwitchTiming: (): Promise<OperationResult<SwitchTiming | null>> =>
    ipcRenderer.invoke('codex:get-last-switch-timing'),
  openConfigFile: (): Promise<OperationResult> => ipcRenderer.invoke('codex:open-config-file'),
  backupAndResetCodexAppSession: (): Promise<OperationResult<CodexAppSessionResetResult>> =>
    ipcRenderer.invoke('codex:backup-reset-app-session')
};

contextBridge.exposeInMainWorld('codexAccounts', api);

export type CodexAccountsApi = typeof api;
