import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, rename, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AuthReadinessDiagnostics,
  CodexAppCacheItem,
  CodexAppRuntimeDiagnostics,
  CodexAppSessionResetResult,
  GitRepositoryDiagnostics,
  McpDiagnostics,
  NetworkCheckResult,
  ProxyDiagnostics,
  SnapshotIntegrity,
  StartupDiagnostics,
  SwitchTiming
} from '../../shared/types/diagnostics';

const execFileAsync = promisify(execFile);

const CODEX_DIR = path.join(os.homedir(), '.codex');
const AUTH_PATH = path.join(CODEX_DIR, 'auth.json');
const CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const CODEX_APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Codex');
const CODEX_APP_SESSION_BACKUPS_DIR = path.join(CODEX_DIR, 'app-session-backups');
const TOKEN_FIELD_NAMES = ['access_token', 'accessToken', 'id_token', 'refresh_token'];
const CODEX_APP_SESSION_ITEMS = [
  'Cookies',
  'Cookies-journal',
  'Session Storage',
  'Local Storage',
  'Network Persistent State',
  'Service Worker'
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function elapsedMs(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
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

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function hasSensitiveTokenField(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (TOKEN_FIELD_NAMES.some((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return true;
  }

  return Object.values(record).some(hasSensitiveTokenField);
}

async function readJsonShape(filePath: string): Promise<{ ok: boolean; hasTokenField: boolean }> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return { ok: true, hasTokenField: hasSensitiveTokenField(parsed) };
  } catch {
    return { ok: false, hasTokenField: false };
  }
}

export class DiagnosticsService {
  async inspectSnapshot(filePath: string): Promise<SnapshotIntegrity> {
    const exists = await isRegularFile(filePath);
    if (!exists) {
      return {
        exists: false,
        jsonValid: false,
        looksLikeCodexAuth: false,
        sizeBytes: 0,
        modifiedAt: null,
        possiblyExpired: false,
        warning: '快照文件不存在。'
      };
    }

    const [stats, jsonShape] = await Promise.all([stat(filePath), readJsonShape(filePath)]);
    const ageDays = (Date.now() - stats.mtimeMs) / 86400000;
    const possiblyExpired = ageDays > 30;

    return {
      exists: true,
      jsonValid: jsonShape.ok,
      looksLikeCodexAuth: jsonShape.hasTokenField,
      sizeBytes: stats.size,
      modifiedAt: new Date(stats.mtimeMs).toISOString(),
      possiblyExpired,
      warning: !jsonShape.ok
        ? 'JSON 无法解析。'
        : !jsonShape.hasTokenField
          ? '未发现常见 token 字段，可能不是 Codex auth 快照。'
          : possiblyExpired
            ? '快照较久未更新，登录态可能已过期。'
            : null
    };
  }

  async runStartupDiagnostics(accountName: string | undefined, lastSwitchTiming: SwitchTiming | null): Promise<StartupDiagnostics> {
    const [auth, mcp, proxy, git, codexApp, network] = await Promise.all([
      this.checkAuth(),
      this.checkMcp(),
      this.checkProxy(),
      this.checkGitRepository(),
      this.checkCodexAppRuntime(),
      Promise.all([this.checkTcpConnectivity('auth.openai.com'), this.checkTcpConnectivity('api.openai.com')])
    ]);

    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (!auth.authExists) {
      warnings.push('未发现 ~/.codex/auth.json。');
      suggestions.push('请先完成 codex login，或切换到一个有效账号快照。');
    } else if (!auth.jsonValid) {
      warnings.push('auth.json 不是有效 JSON。');
      suggestions.push('请重新 codex login，或从有效快照切换恢复。');
    } else if (!auth.hasTokenField) {
      warnings.push('auth.json 未发现常见 token 字段。');
      suggestions.push('请确认这是 Codex 登录态文件，必要时重新 codex login。');
    }

    if (mcp.hasMcpServers) {
      warnings.push('检测到 MCP 配置。Codex 启动时可能会初始化 MCP，这会增加进入时间。');
      suggestions.push('可打开 config.toml 检查 MCP server 是否过多、是否有慢启动命令。');
    }

    if (proxy.detected) {
      warnings.push('检测到代理环境变量。Codex 启动和 token 刷新速度可能受代理/TUN/证书影响。');
      suggestions.push(`如需临时排查代理影响，可复制执行：${proxy.unsetCommand}`);
    }

    if (git.largeRepo) {
      warnings.push('当前目录像是大型 Git 仓库，Codex 启动时扫描 workspace 可能更慢。');
      suggestions.push('可在较小目录启动 Codex，或减少启动时打开的大型工作区。');
    }

    if (codexApp.runningProcessCount && codexApp.runningProcessCount > 0) {
      warnings.push('检测到 Codex App 或 app-server 仍在运行。切换器只覆盖 auth.json，正在运行的 App 可能继续持有旧会话。');
      suggestions.push('切换账号前请完全退出 Codex App，确认 app-server 也退出后再切换；否则 Electron Cookies/Session 可能与 auth.json 不匹配。');
    }

    if (codexApp.hasCookies || codexApp.hasSessionStorage || codexApp.hasLocalStorage) {
      suggestions.push('Codex App 有独立的 Cookies/Session/Local Storage。auth-only 快照切换主要适合 CLI；Codex App 多账号可能需要独立管理 App 会话缓存。');
      suggestions.push('如果某个账号卡在 Codex 封面动画，可在完全退出 Codex App 后使用“备份并重置 App 会话缓存”，让 App 下次按当前 auth.json 重新建立会话。');
    }

    for (const item of network) {
      if (!item.ok) {
        warnings.push(`${item.host} 连通性检查失败。`);
      }
    }

    if (network.some((item) => !item.ok)) {
      suggestions.push('请检查网络、代理/TUN、证书或公司网络策略。连通性检查不携带 token。');
    }

    if (lastSwitchTiming) {
      suggestions.push('文件切换已完成；Codex 重新进入慢通常来自初始化、MCP、网络或工作区扫描。');
    }

    return {
      accountName: accountName ?? null,
      checkedAt: nowIso(),
      ready: auth.authExists && auth.jsonValid && auth.hasTokenField,
      auth,
      mcp,
      proxy,
      git,
      codexApp,
      network,
      lastSwitchTiming,
      warnings,
      suggestions
    };
  }

  private async checkAuth(): Promise<AuthReadinessDiagnostics> {
    const authExists = await isRegularFile(AUTH_PATH);
    if (!authExists) {
      return {
        authPath: AUTH_PATH,
        authExists: false,
        jsonValid: false,
        hasTokenField: false
      };
    }

    const jsonShape = await readJsonShape(AUTH_PATH);
    return {
      authPath: AUTH_PATH,
      authExists,
      jsonValid: jsonShape.ok,
      hasTokenField: jsonShape.hasTokenField
    };
  }

  private async checkMcp(): Promise<McpDiagnostics> {
    const configExists = await isRegularFile(CONFIG_PATH);
    if (!configExists) {
      return {
        configExists,
        configPath: CONFIG_PATH,
        hasMcpServers: false,
        serverCount: 0
      };
    }

    const content = await readFile(CONFIG_PATH, 'utf8').catch(() => '');
    const serverMatches = [...content.matchAll(/^\s*\[mcp_servers(?:\.([A-Za-z0-9_-]+))?\]\s*$/gm)];
    const hasInlineMcp = /^\s*mcp_servers\s*=/m.test(content);
    const serverCount = serverMatches.filter((match) => Boolean(match[1])).length;

    return {
      configExists,
      configPath: CONFIG_PATH,
      hasMcpServers: serverMatches.length > 0 || hasInlineMcp,
      serverCount
    };
  }

  private checkProxy(): ProxyDiagnostics {
    const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
    const variables = names.filter((name) => Boolean(process.env[name]));

    return {
      detected: variables.length > 0,
      variables,
      unsetCommand: 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy'
    };
  }

  private async checkGitRepository(): Promise<GitRepositoryDiagnostics> {
    try {
      const { stdout: rootOut } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        timeout: 5000,
        maxBuffer: 256 * 1024
      });
      const root = rootOut.trim();
      const { stdout: filesOut } = await execFileAsync('git', ['ls-files'], {
        cwd: root,
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024
      });
      const trackedFiles = filesOut ? filesOut.split('\n').filter(Boolean).length : 0;

      return {
        isGitRepo: true,
        root,
        trackedFiles,
        largeRepo: trackedFiles > 5000
      };
    } catch {
      return {
        isGitRepo: false,
        root: null,
        trackedFiles: null,
        largeRepo: false
      };
    }
  }

  async checkCodexAppRuntime(): Promise<CodexAppRuntimeDiagnostics> {
    const [hasCookies, hasSessionStorage, hasLocalStorage, cacheItems, processInfo] = await Promise.all([
      isRegularFile(path.join(CODEX_APP_SUPPORT_DIR, 'Cookies')),
      this.pathExists(path.join(CODEX_APP_SUPPORT_DIR, 'Session Storage')),
      this.pathExists(path.join(CODEX_APP_SUPPORT_DIR, 'Local Storage')),
      Promise.all(CODEX_APP_SESSION_ITEMS.map((name) => this.inspectCodexAppCacheItem(name))),
      this.getCodexProcesses()
    ]);

    const runningProcessCount = processInfo?.runningProcessCount ?? null;
    const appServerRunning = processInfo?.appServerRunning ?? null;
    const warning =
      runningProcessCount && runningProcessCount > 0
        ? 'Codex App 仍在运行，可能持有旧账号会话缓存。'
        : hasCookies || hasSessionStorage || hasLocalStorage
          ? 'Codex App 存在独立 Cookies/Session 缓存；auth-only 切换可能不足以切换 App 内账号。'
          : null;

    return {
      appSupportDir: CODEX_APP_SUPPORT_DIR,
      runningProcessCount,
      appServerRunning,
      hasCookies,
      hasSessionStorage,
      hasLocalStorage,
      cacheItems,
      warning
    };
  }

  async backupAndResetCodexAppSession(): Promise<CodexAppSessionResetResult> {
    const processInfo = await this.getCodexProcesses();
    const runningProcessCount = processInfo?.runningProcessCount ?? null;
    const appServerRunning = processInfo?.appServerRunning ?? null;
    const items = await Promise.all(CODEX_APP_SESSION_ITEMS.map((name) => this.inspectCodexAppCacheItem(name)));
    const existingItems = items.filter((item) => item.exists);

    if (runningProcessCount && runningProcessCount > 0) {
      return {
        appSupportDir: CODEX_APP_SUPPORT_DIR,
        backupDir: null,
        movedItems: [],
        skippedItems: existingItems,
        runningProcessCount,
        appServerRunning
      };
    }

    if (existingItems.length === 0) {
      return {
        appSupportDir: CODEX_APP_SUPPORT_DIR,
        backupDir: null,
        movedItems: [],
        skippedItems: [],
        runningProcessCount,
        appServerRunning
      };
    }

    await mkdir(CODEX_APP_SESSION_BACKUPS_DIR, { recursive: true });
    const backupDir = path.join(CODEX_APP_SESSION_BACKUPS_DIR, `codex-app-session-${timestampForFile()}`);
    await mkdir(backupDir, { recursive: true });

    const movedItems: CodexAppCacheItem[] = [];
    const skippedItems: CodexAppCacheItem[] = [];

    for (const item of existingItems) {
      const sourcePath = path.join(CODEX_APP_SUPPORT_DIR, item.name);
      const targetPath = path.join(backupDir, item.name);

      try {
        await rename(sourcePath, targetPath);
        movedItems.push({ ...item, path: targetPath });
      } catch {
        skippedItems.push(item);
      }
    }

    return {
      appSupportDir: CODEX_APP_SUPPORT_DIR,
      backupDir,
      movedItems,
      skippedItems,
      runningProcessCount,
      appServerRunning
    };
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await lstat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async inspectCodexAppCacheItem(name: string): Promise<CodexAppCacheItem> {
    const itemPath = path.join(CODEX_APP_SUPPORT_DIR, name);

    try {
      const stats = await lstat(itemPath);
      return {
        name,
        path: itemPath,
        exists: true,
        kind: stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other',
        sizeBytes: stats.size,
        modifiedAt: new Date(stats.mtimeMs).toISOString()
      };
    } catch {
      return {
        name,
        path: itemPath,
        exists: false,
        kind: null,
        sizeBytes: null,
        modifiedAt: null
      };
    }
  }

  private async getCodexProcesses(): Promise<{ runningProcessCount: number; appServerRunning: boolean } | null> {
    try {
      const { stdout } = await execFileAsync('pgrep', ['-fl', 'Codex|codex app-server'], {
        timeout: 3000,
        maxBuffer: 256 * 1024
      });
      const lines = stdout.split('\n').filter((line) => /\/Applications\/Codex\.app|codex app-server/.test(line));

      return {
        runningProcessCount: lines.length,
        appServerRunning: lines.some((line) => line.includes('codex app-server'))
      };
    } catch {
      return {
        runningProcessCount: 0,
        appServerRunning: false
      };
    }
  }

  private async checkTcpConnectivity(host: string): Promise<NetworkCheckResult> {
    const start = performance.now();

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port: 443 });
      const finish = (ok: boolean, errorMessage: string | null) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve({
          host,
          ok,
          durationMs: elapsedMs(start),
          errorMessage
        });
      };

      socket.setTimeout(5000);
      socket.once('connect', () => finish(true, null));
      socket.once('timeout', () => finish(false, '连接超时。'));
      socket.once('error', (error) => finish(false, error.message));
    });
  }
}
