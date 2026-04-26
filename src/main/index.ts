import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { mkdir, readdir, stat, lstat, copyFile, unlink, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AccountSnapshot,
  CodexAppSessionResetResult,
  CodexStatus,
  ManualUsageInput,
  OperationResult,
  StartupDiagnostics,
  SwitchAccountResult,
  SwitchStepTiming,
  SwitchTiming,
  UsageRefreshResult,
  UsageSnapshot
} from '../shared/types';
import { UsageService } from './services/usageService';
import { DiagnosticsService } from './services/diagnosticsService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODEX_DIR = path.join(os.homedir(), '.codex');
const AUTH_PATH = path.join(CODEX_DIR, 'auth.json');
const ACCOUNTS_DIR = path.join(CODEX_DIR, 'accounts');
const BACKUPS_DIR = path.join(CODEX_DIR, 'backups');
const CODEX_USAGE_URL = 'https://chatgpt.com/codex/settings/usage';
const usageService = new UsageService();
const diagnosticsService = new DiagnosticsService();
let lastSwitchTiming: SwitchTiming | null = null;

function isAllowedRendererNavigation(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    const devUrl = process.env.ELECTRON_RENDERER_URL;

    if (devUrl) {
      return parsed.origin === new URL(devUrl).origin;
    }

    const rendererRoot = path.resolve(__dirname, '../../dist/renderer');
    const targetPath = fileURLToPath(parsed);
    return parsed.protocol === 'file:' && path.resolve(targetPath).startsWith(`${rendererRoot}${path.sep}`);
  } catch {
    return false;
  }
}

function toIsoOrNull(mtimeMs?: number): string | null {
  return typeof mtimeMs === 'number' ? new Date(mtimeMs).toISOString() : null;
}

function timestampForFile(): string {
  const now = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '-',
    pad(now.getMilliseconds(), 3)
  ].join('');
}

async function ensureCodexDirs(): Promise<void> {
  await mkdir(CODEX_DIR, { recursive: true });
  await mkdir(ACCOUNTS_DIR, { recursive: true });
  await mkdir(BACKUPS_DIR, { recursive: true });
}

function normalizeAccountName(input: string): string {
  const name = input.trim();

  if (!name) {
    throw new Error('账号昵称不能为空。');
  }

  if (!/^[A-Za-z0-9_-]{1,60}$/u.test(name)) {
    throw new Error('账号昵称只能包含英文、数字、下划线、短横线，长度 1-60。');
  }

  return name;
}

function accountPathForName(input: string): { name: string; fileName: string; filePath: string } {
  const name = normalizeAccountName(input);
  const fileName = `${name}.json`;
  const filePath = path.resolve(ACCOUNTS_DIR, fileName);
  const accountsRoot = path.resolve(ACCOUNTS_DIR);

  if (!filePath.startsWith(`${accountsRoot}${path.sep}`)) {
    throw new Error('账号快照路径无效。');
  }

  return { name, fileName, filePath };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  if (!(await isRegularFile(filePath))) {
    throw new Error(`${label} 不是普通文件或不存在。`);
  }
}

async function backupCurrentAuthIfPresent(): Promise<string | null> {
  if (!(await fileExists(AUTH_PATH))) {
    return null;
  }

  await assertRegularFile(AUTH_PATH, '~/.codex/auth.json');
  await mkdir(BACKUPS_DIR, { recursive: true });
  const backupPath = path.join(BACKUPS_DIR, `auth-${timestampForFile()}.json`);
  await copyFile(AUTH_PATH, backupPath, constants.COPYFILE_EXCL);
  return backupPath;
}

function failure<T = undefined>(message: string): OperationResult<T> {
  return { ok: false, message };
}

function success<T>(message: string, data?: T): OperationResult<T> {
  return { ok: true, message, data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误。';
}

function elapsedMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

async function timedStep<T>(
  steps: SwitchStepTiming[],
  name: SwitchStepTiming['name'],
  action: () => Promise<T>,
  detail?: string
): Promise<T> {
  const start = performance.now();
  try {
    const result = await action();
    steps.push({ name, durationMs: elapsedMs(start), ok: true, detail });
    return result;
  } catch (error) {
    steps.push({ name, durationMs: elapsedMs(start), ok: false, detail: errorMessage(error) });
    throw error;
  }
}

async function getCodexStatus(): Promise<OperationResult<CodexStatus>> {
  try {
    await ensureCodexDirs();
    const authStats = (await isRegularFile(AUTH_PATH)) ? await stat(AUTH_PATH).catch(() => null) : null;

    return success('已读取 Codex 本地状态。', {
      codexDir: CODEX_DIR,
      authPath: AUTH_PATH,
      accountsDir: ACCOUNTS_DIR,
      backupsDir: BACKUPS_DIR,
      hasAuth: Boolean(authStats?.isFile()),
      authUpdatedAt: toIsoOrNull(authStats?.mtimeMs)
    });
  } catch (error) {
    return failure(`读取 Codex 状态失败：${errorMessage(error)}`);
  }
}

async function listAccounts(): Promise<OperationResult<AccountSnapshot[]>> {
  try {
    await ensureCodexDirs();
    const entries = await readdir(ACCOUNTS_DIR, { withFileTypes: true });
    const accounts: AccountSnapshot[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const name = entry.name.slice(0, -'.json'.length);

      try {
        normalizeAccountName(name);
      } catch {
        continue;
      }

      const filePath = path.join(ACCOUNTS_DIR, entry.name);
      if (!(await isRegularFile(filePath))) {
        continue;
      }

      const stats = await stat(filePath);

      accounts.push({
        name,
        fileName: entry.name,
        filePath,
        updatedAt: new Date(stats.mtimeMs).toISOString(),
        sizeBytes: stats.size,
        integrity: await diagnosticsService.inspectSnapshot(filePath)
      });
    }

    accounts.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return success('已读取账号快照列表。', accounts);
  } catch (error) {
    return failure(`读取账号列表失败：${errorMessage(error)}`);
  }
}

async function saveCurrentAccount(nameInput: string): Promise<OperationResult<AccountSnapshot>> {
  try {
    await ensureCodexDirs();

    if (!(await isRegularFile(AUTH_PATH))) {
      return failure('当前不存在 ~/.codex/auth.json，请先完成 Codex 登录后再添加快照。');
    }

    const account = accountPathForName(nameInput);

    if (await fileExists(account.filePath)) {
      return failure('同名账号快照已存在，请换一个昵称或先删除旧快照。');
    }

    await copyFile(AUTH_PATH, account.filePath, constants.COPYFILE_EXCL);
    const stats = await stat(account.filePath);

    return success(`已将当前登录态保存为「${account.name}」。`, {
      name: account.name,
      fileName: account.fileName,
      filePath: account.filePath,
      updatedAt: new Date(stats.mtimeMs).toISOString(),
      sizeBytes: stats.size,
      integrity: await diagnosticsService.inspectSnapshot(account.filePath)
    });
  } catch (error) {
    return failure(`保存账号快照失败：${errorMessage(error)}`);
  }
}

async function switchAccount(nameInput: string): Promise<OperationResult<SwitchAccountResult>> {
  const startedAt = new Date();
  const totalStart = performance.now();
  const steps: SwitchStepTiming[] = [];
  let backupPath: string | null = null;
  let accountName = nameInput.trim();

  try {
    const appRuntimeBeforeSwitch = await diagnosticsService.checkCodexAppRuntime();
    const account = await timedStep(steps, 'validateAccountName', async () => accountPathForName(nameInput));
    accountName = account.name;

    await timedStep(steps, 'ensureDirectories', ensureCodexDirs);

    await timedStep(steps, 'readSourceSnapshot', async () => {
      await assertRegularFile(account.filePath, `账号快照「${account.name}」`);
      JSON.parse(await readFile(account.filePath, 'utf8')) as unknown;
    }, 'source snapshot exists and parses as JSON');

    backupPath = await timedStep(steps, 'backupCurrentAuth', backupCurrentAuthIfPresent);
    await timedStep(steps, 'copySnapshotToAuth', async () => copyFile(account.filePath, AUTH_PATH));
    const authExistsAfterSwitch = await timedStep(steps, 'verifyAuthExists', async () => isRegularFile(AUTH_PATH));
    const totalMs = elapsedMs(totalStart);
    const timing: SwitchTiming = {
      accountName: account.name,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      steps: [...steps, { name: 'totalSwitchTime', durationMs: totalMs, ok: true }],
      backupPath,
      sourceExists: true,
      authExistsAfterSwitch,
      totalMs
    };
    lastSwitchTiming = timing;

    const backupMs = timing.steps.find((step) => step.name === 'backupCurrentAuth')?.durationMs ?? 0;
    const copyMs = timing.steps.find((step) => step.name === 'copySnapshotToAuth')?.durationMs ?? 0;

    const appWarning = appRuntimeBeforeSwitch.runningProcessCount && appRuntimeBeforeSwitch.runningProcessCount > 0
      ? '检测到 Codex App/app-server 切换时仍在运行，可能继续持有旧 Cookie/Session；请完全退出后再打开。'
      : '请重新打开 Codex CLI / Codex App / IDE 插件以确保新登录态生效。';

    return success(
      `已切换到「${account.name}」。文件复制 ${copyMs}ms，备份 ${backupMs}ms，总耗时 ${totalMs}ms。Codex 启动耗时不属于切换器控制范围。${appWarning}`,
      { backupPath, switchedTo: account.name, timing }
    );
  } catch (error) {
    const totalMs = elapsedMs(totalStart);
    lastSwitchTiming = {
      accountName,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      steps: [...steps, { name: 'totalSwitchTime', durationMs: totalMs, ok: false, detail: errorMessage(error) }],
      backupPath,
      sourceExists: steps.some((step) => step.name === 'readSourceSnapshot' && step.ok),
      authExistsAfterSwitch: await isRegularFile(AUTH_PATH),
      totalMs
    };
    return failure(`切换账号失败：${errorMessage(error)}`);
  }
}

async function deleteAccount(nameInput: string): Promise<OperationResult> {
  try {
    await ensureCodexDirs();
    const account = accountPathForName(nameInput);

    await assertRegularFile(account.filePath, `账号快照「${account.name}」`);

    await unlink(account.filePath);
    return success(`已删除账号快照「${account.name}」。`);
  } catch (error) {
    return failure(`删除账号快照失败：${errorMessage(error)}`);
  }
}

async function openCodexDir(): Promise<OperationResult> {
  try {
    await ensureCodexDirs();
    const openError = await shell.openPath(CODEX_DIR);

    if (openError) {
      return failure(`打开配置目录失败：${openError}`);
    }

    return success('已打开 ~/.codex/ 配置目录。');
  } catch (error) {
    return failure(`打开配置目录失败：${errorMessage(error)}`);
  }
}

async function getCurrentUsage(): Promise<OperationResult<UsageSnapshot>> {
  try {
    const usage = await usageService.getCurrentUsage();
    return success('已刷新当前账号额度状态。', usage);
  } catch (error) {
    return failure(`刷新当前账号额度失败：${errorMessage(error)}`);
  }
}

async function getAccountUsage(name: string): Promise<OperationResult<UsageSnapshot>> {
  try {
    const usage = await usageService.getAccountUsage(name);
    return success(`已刷新「${usage.accountName}」额度状态。`, usage);
  } catch (error) {
    return failure(`刷新账号额度失败：${errorMessage(error)}`);
  }
}

async function getAllAccountsUsage(): Promise<OperationResult<UsageSnapshot[]>> {
  try {
    const usage = await usageService.getAllAccountsUsage();
    return success('已刷新全部账号额度状态。', usage);
  } catch (error) {
    return failure(`刷新全部账号额度失败：${errorMessage(error)}`);
  }
}

async function refreshUsage(name?: string): Promise<OperationResult<UsageRefreshResult | UsageSnapshot>> {
  try {
    if (name?.trim()) {
      const usage = await usageService.getAccountUsage(name);
      return success(`已刷新「${usage.accountName}」额度状态。`, usage);
    }

    const [current, accounts] = await Promise.all([usageService.getCurrentUsage(), usageService.getAllAccountsUsage()]);
    return success('已刷新 Usage Dashboard。', { current, accounts });
  } catch (error) {
    return failure(`刷新额度状态失败：${errorMessage(error)}`);
  }
}

async function saveManualUsage(input: ManualUsageInput): Promise<OperationResult<UsageSnapshot>> {
  try {
    const usage = await usageService.saveManualUsage(input);
    return success(`已保存「${usage.accountName}」手动额度记录。`, usage);
  } catch (error) {
    return failure(`保存手动额度失败：${errorMessage(error)}`);
  }
}

async function openUsagePage(): Promise<OperationResult> {
  try {
    await shell.openExternal(CODEX_USAGE_URL);
    return success('已打开 ChatGPT Codex Usage 页面。');
  } catch (error) {
    return failure(`打开 Codex 额度页面失败：${errorMessage(error)}`);
  }
}

async function runStartupDiagnostics(accountName?: string): Promise<OperationResult<StartupDiagnostics>> {
  try {
    const diagnostics = await diagnosticsService.runStartupDiagnostics(accountName, lastSwitchTiming);
    return success('已完成 Codex 启动慢诊断。', diagnostics);
  } catch (error) {
    return failure(`启动诊断失败：${errorMessage(error)}`);
  }
}

async function getLastSwitchTiming(): Promise<OperationResult<SwitchTiming | null>> {
  return success(lastSwitchTiming ? '已读取最近一次切换耗时。' : '暂无切换耗时记录。', lastSwitchTiming);
}

async function openConfigFile(): Promise<OperationResult> {
  try {
    const openError = await shell.openPath(path.join(CODEX_DIR, 'config.toml'));
    if (openError) {
      return failure(`打开 config.toml 失败：${openError}`);
    }
    return success('已打开 ~/.codex/config.toml。');
  } catch (error) {
    return failure(`打开 config.toml 失败：${errorMessage(error)}`);
  }
}

async function backupAndResetCodexAppSession(): Promise<OperationResult<CodexAppSessionResetResult>> {
  try {
    const result = await diagnosticsService.backupAndResetCodexAppSession();

    if (result.runningProcessCount && result.runningProcessCount > 0) {
      return failure(
        `Codex App 仍在运行（${result.runningProcessCount} 个相关进程）。请先手动完全退出 Codex App，再重试备份并重置会话缓存。`
      );
    }

    if (!result.movedItems.length) {
      return success('未发现需要重置的 Codex App 会话缓存。', result);
    }

    const movedNames = result.movedItems.map((item) => item.name).join(', ');
    const skippedText = result.skippedItems.length ? `，${result.skippedItems.length} 项移动失败` : '';
    return success(`已备份并重置 Codex App 会话缓存：${movedNames}${skippedText}。请重新打开 Codex App。`, result);
  } catch (error) {
    return failure(`重置 Codex App 会话缓存失败：${errorMessage(error)}`);
  }
}

function registerIpc(): void {
  ipcMain.handle('codex:get-status', getCodexStatus);
  ipcMain.handle('codex:list-accounts', listAccounts);
  ipcMain.handle('codex:save-current-account', (_event, name: string) => saveCurrentAccount(name));
  ipcMain.handle('codex:switch-account', (_event, name: string) => switchAccount(name));
  ipcMain.handle('codex:delete-account', (_event, name: string) => deleteAccount(name));
  ipcMain.handle('codex:open-dir', openCodexDir);
  ipcMain.handle('codex:get-current-usage', getCurrentUsage);
  ipcMain.handle('codex:get-account-usage', (_event, name: string) => getAccountUsage(name));
  ipcMain.handle('codex:get-all-accounts-usage', getAllAccountsUsage);
  ipcMain.handle('codex:refresh-usage', (_event, name?: string) => refreshUsage(name));
  ipcMain.handle('codex:save-manual-usage', (_event, input: ManualUsageInput) => saveManualUsage(input));
  ipcMain.handle('codex:open-usage-page', openUsagePage);
  ipcMain.handle('codex:run-startup-diagnostics', (_event, accountName?: string) => runStartupDiagnostics(accountName));
  ipcMain.handle('codex:get-last-switch-timing', getLastSwitchTiming);
  ipcMain.handle('codex:open-config-file', openConfigFile);
  ipcMain.handle('codex:backup-reset-app-session', backupAndResetCodexAppSession);
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, '../preload/index.mjs');
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    title: 'Codex 本地账号切换器',
    backgroundColor: '#f5f7fb',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(url)) {
      event.preventDefault();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
