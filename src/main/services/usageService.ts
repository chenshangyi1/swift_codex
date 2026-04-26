import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ManualUsageInput, ManualUsageRecord, UsageProvider, UsageSnapshot } from '../../shared/types/usage';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const AUTH_PATH = path.join(CODEX_DIR, 'auth.json');
const ACCOUNTS_DIR = path.join(CODEX_DIR, 'accounts');
const USAGE_CACHE_PATH = path.join(CODEX_DIR, 'usage-cache.json');
const CURRENT_ACCOUNT_NAME = 'current-account';
const UNSUPPORTED_MESSAGE =
  '当前应用暂未接入稳定的账号额度查询来源。当前未发现稳定公开的 Codex 账号额度 API。请打开 ChatGPT Codex Usage 页面或 Codex TUI 的 /status 查看。';

interface AuthStatus {
  accountName: string;
  hasAuth: boolean;
  canReadAuth: boolean;
  errorMessage: string | null;
}

interface UsageCacheFile {
  version: 1;
  records: Record<string, ManualUsageRecord>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeAccountName(input: string): string {
  const name = input.trim();

  if (!/^[A-Za-z0-9_-]{1,60}$/u.test(name)) {
    throw new Error('账号名只能包含英文、数字、下划线、短横线，长度 1-60。');
  }

  return name;
}

function accountPathForName(input: string): { name: string; filePath: string } {
  const name = sanitizeAccountName(input);
  const filePath = path.resolve(ACCOUNTS_DIR, `${name}.json`);
  const accountsRoot = path.resolve(ACCOUNTS_DIR);

  if (!filePath.startsWith(`${accountsRoot}${path.sep}`)) {
    throw new Error('账号快照路径无效。');
  }

  return { name, filePath };
}

async function ensureCodexDir(): Promise<void> {
  await mkdir(CODEX_DIR, { recursive: true });
  await mkdir(ACCOUNTS_DIR, { recursive: true });
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function clampPercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeOptionalText(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return text ? text.slice(0, 500) : null;
}

function normalizeResetTime(value: string | null): string | null {
  const text = value?.trim() ?? '';
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text.slice(0, 80) : date.toISOString();
}

function unsupportedSnapshot(auth: AuthStatus): UsageSnapshot {
  return {
    accountName: auth.accountName,
    hasAuth: auth.hasAuth,
    canReadAuth: auth.canReadAuth,
    usageSupported: false,
    usageSource: 'unsupported',
    fiveHourRemainingPercent: null,
    weeklyRemainingPercent: null,
    resetTime: null,
    lastChecked: nowIso(),
    errorMessage: auth.errorMessage ?? UNSUPPORTED_MESSAGE,
    note: null
  };
}

function manualSnapshot(auth: AuthStatus, record: ManualUsageRecord): UsageSnapshot {
  return {
    accountName: auth.accountName,
    hasAuth: auth.hasAuth,
    canReadAuth: auth.canReadAuth,
    usageSupported: true,
    usageSource: 'manual',
    fiveHourRemainingPercent: record.fiveHourRemainingPercent,
    weeklyRemainingPercent: record.weeklyRemainingPercent,
    resetTime: record.resetTime,
    lastChecked: record.updatedAt,
    errorMessage: auth.errorMessage,
    note: record.note
  };
}

class ManualUsageStore {
  async read(): Promise<UsageCacheFile> {
    await ensureCodexDir();

    if (!(await isRegularFile(USAGE_CACHE_PATH))) {
      return { version: 1, records: {} };
    }

    try {
      const raw = await readFile(USAGE_CACHE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<UsageCacheFile>;

      if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object') {
        return { version: 1, records: {} };
      }

      return { version: 1, records: parsed.records };
    } catch {
      return { version: 1, records: {} };
    }
  }

  async saveRecord(input: ManualUsageInput): Promise<ManualUsageRecord> {
    const accountName = sanitizeAccountName(input.accountName);
    const record: ManualUsageRecord = {
      accountName,
      fiveHourRemainingPercent: clampPercent(input.fiveHourRemainingPercent),
      weeklyRemainingPercent: clampPercent(input.weeklyRemainingPercent),
      resetTime: normalizeResetTime(input.resetTime),
      note: normalizeOptionalText(input.note),
      updatedAt: nowIso()
    };
    const cache = await this.read();
    cache.records[accountName] = record;
    await writeFile(USAGE_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8' });
    return record;
  }
}

class UnsupportedUsageProvider implements UsageProvider {
  constructor(private readonly readAuth: (accountName?: string) => Promise<AuthStatus>, private readonly listNames: () => Promise<string[]>) {}

  async getUsageForCurrentAccount(): Promise<UsageSnapshot> {
    return unsupportedSnapshot(await this.readAuth());
  }

  async getUsageForSavedAccount(accountName: string): Promise<UsageSnapshot> {
    return unsupportedSnapshot(await this.readAuth(accountName));
  }

  async getUsageForAllAccounts(): Promise<UsageSnapshot[]> {
    const names = await this.listNames();
    return Promise.all(names.map((name) => this.getUsageForSavedAccount(name)));
  }
}

class ManualUsageProvider implements UsageProvider {
  constructor(
    private readonly store: ManualUsageStore,
    private readonly readAuth: (accountName?: string) => Promise<AuthStatus>,
    private readonly listNames: () => Promise<string[]>
  ) {}

  async getUsageForCurrentAccount(): Promise<UsageSnapshot> {
    return this.getUsage(CURRENT_ACCOUNT_NAME, await this.readAuth());
  }

  async getUsageForSavedAccount(accountName: string): Promise<UsageSnapshot> {
    const auth = await this.readAuth(accountName);
    return this.getUsage(sanitizeAccountName(accountName), auth);
  }

  async getUsageForAllAccounts(): Promise<UsageSnapshot[]> {
    const names = await this.listNames();
    return Promise.all(names.map((name) => this.getUsageForSavedAccount(name)));
  }

  private async getUsage(cacheKey: string, auth: AuthStatus): Promise<UsageSnapshot> {
    const cache = await this.store.read();
    const record = cache.records[cacheKey];
    return record ? manualSnapshot(auth, record) : unsupportedSnapshot(auth);
  }
}

class ExperimentalUsageProvider implements UsageProvider {
  readonly enabled = false;

  async getUsageForCurrentAccount(): Promise<UsageSnapshot> {
    throw new Error('experimentalProvider 默认关闭，尚未接入稳定官方接口。');
  }

  async getUsageForSavedAccount(): Promise<UsageSnapshot> {
    throw new Error('experimentalProvider 默认关闭，尚未接入稳定官方接口。');
  }

  async getUsageForAllAccounts(): Promise<UsageSnapshot[]> {
    throw new Error('experimentalProvider 默认关闭，尚未接入稳定官方接口。');
  }
}

export class UsageService {
  private readonly store = new ManualUsageStore();
  private readonly unsupportedProvider = new UnsupportedUsageProvider(
    (accountName) => this.readAuthStatus(accountName),
    () => this.listAccountNames()
  );
  private readonly manualProvider = new ManualUsageProvider(
    this.store,
    (accountName) => this.readAuthStatus(accountName),
    () => this.listAccountNames()
  );
  private readonly experimentalProvider = new ExperimentalUsageProvider();

  async readAuthForCurrent(): Promise<AuthStatus> {
    return this.readAuthStatus();
  }

  async readAuthForAccount(accountName: string): Promise<AuthStatus> {
    return this.readAuthStatus(accountName);
  }

  async getUsageForCurrentAccount(): Promise<UsageSnapshot> {
    return this.manualProvider.getUsageForCurrentAccount();
  }

  async getUsageForSavedAccount(accountName: string): Promise<UsageSnapshot> {
    return this.manualProvider.getUsageForSavedAccount(accountName);
  }

  async getUsageForAllAccounts(): Promise<UsageSnapshot[]> {
    return this.manualProvider.getUsageForAllAccounts();
  }

  async getCurrentUsage(): Promise<UsageSnapshot> {
    return this.getUsageForCurrentAccount();
  }

  async getAccountUsage(accountName: string): Promise<UsageSnapshot> {
    return this.getUsageForSavedAccount(accountName);
  }

  async getAllAccountsUsage(): Promise<UsageSnapshot[]> {
    return this.getUsageForAllAccounts();
  }

  async refreshUsage(accountName?: string): Promise<UsageSnapshot | UsageSnapshot[]> {
    if (accountName?.trim()) {
      return this.getUsageForSavedAccount(accountName);
    }

    return this.getUsageForAllAccounts();
  }

  async saveManualUsage(input: ManualUsageInput): Promise<UsageSnapshot> {
    const record = await this.store.saveRecord(input);
    const auth = record.accountName === CURRENT_ACCOUNT_NAME
      ? await this.readAuthStatus()
      : await this.readAuthStatus(record.accountName);
    return manualSnapshot(auth, record);
  }

  getUnsupportedProvider(): UsageProvider {
    return this.unsupportedProvider;
  }

  getManualProvider(): UsageProvider {
    return this.manualProvider;
  }

  getExperimentalProvider(): UsageProvider {
    return this.experimentalProvider;
  }

  private async listAccountNames(): Promise<string[]> {
    await ensureCodexDir();
    const entries = await readdir(ACCOUNTS_DIR, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter((name) => /^[A-Za-z0-9_-]{1,60}$/u.test(name))
      .sort((a, b) => a.localeCompare(b));
  }

  private async readAuthStatus(accountName?: string): Promise<AuthStatus> {
    const target = accountName ? accountPathForName(accountName) : { name: CURRENT_ACCOUNT_NAME, filePath: AUTH_PATH };
    const accountLabel = accountName ? target.name : '当前账号';

    if (!(await isRegularFile(target.filePath))) {
      return {
        accountName: accountLabel,
        hasAuth: false,
        canReadAuth: false,
        errorMessage: '登录态不存在。'
      };
    }

    try {
      JSON.parse(await readFile(target.filePath, 'utf8')) as unknown;
      return {
        accountName: accountLabel,
        hasAuth: true,
        canReadAuth: true,
        errorMessage: null
      };
    } catch (error) {
      return {
        accountName: accountLabel,
        hasAuth: true,
        canReadAuth: false,
        errorMessage: error instanceof Error ? `读取登录态失败：${error.message}` : '读取登录态失败。'
      };
    }
  }
}
