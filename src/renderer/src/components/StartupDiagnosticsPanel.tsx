import { Clipboard, FileCog, RefreshCcw, ShieldAlert, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { OperationResult, StartupDiagnostics, SwitchStepTiming } from '../../../shared/types';

type LogLevel = 'info' | 'success' | 'error' | 'warn';

interface StartupDiagnosticsPanelProps {
  accountName: string | null;
  onLog: (level: LogLevel, message: string) => void;
}

const isSuccessful = <T,>(result: OperationResult<T>): result is OperationResult<T> & { ok: true; data: T } =>
  result.ok && result.data !== undefined;

const formatDate = (value: string | null): string => {
  if (!value) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value));
};

function stepLabel(step: SwitchStepTiming): string {
  const labels: Record<SwitchStepTiming['name'], string> = {
    validateAccountName: '校验账号名',
    ensureDirectories: '确保目录存在',
    readSourceSnapshot: '读取快照',
    backupCurrentAuth: '备份当前 auth',
    copySnapshotToAuth: '复制快照',
    verifyAuthExists: '验证 auth 存在',
    totalSwitchTime: '总耗时'
  };

  return labels[step.name];
}

export function StartupDiagnosticsPanel({ accountName, onLog }: StartupDiagnosticsPanelProps): ReactElement {
  const [diagnostics, setDiagnostics] = useState<StartupDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  const runDiagnostics = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.codexAccounts.runStartupDiagnostics(accountName ?? undefined);
      if (isSuccessful(result)) {
        setDiagnostics(result.data);
        onLog(result.data.ready ? 'success' : 'warn', result.message);
      } else {
        onLog('error', result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const openConfig = async (): Promise<void> => {
    const result = await window.codexAccounts.openConfigFile();
    onLog(result.ok ? 'success' : 'error', result.message);
  };

  const copyUnsetCommand = async (command: string): Promise<void> => {
    await navigator.clipboard.writeText(command);
    onLog('success', '已复制代理排查命令。');
  };

  const resetCodexAppSession = async (): Promise<void> => {
    const confirmed = window.confirm(
      '这会把 Codex App 的本地 Cookies/Session/Local Storage 移动到 ~/.codex/app-session-backups/ 作为备份。不会读取、显示、上传内容。请确认你已经手动完全退出 Codex App。'
    );

    if (!confirmed) return;

    setBusy(true);
    try {
      const result = await window.codexAccounts.backupAndResetCodexAppSession();
      onLog(result.ok ? 'success' : 'error', result.message);
      if (result.ok) {
        await runDiagnostics();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card diagnostics-card">
      <div className="card-heading usage-heading">
        <div>
          <p className="eyebrow">Startup Diagnostics</p>
          <h3>切换后启动优化 / 诊断</h3>
        </div>
        <button className="ghost-button" disabled={busy} onClick={() => void runDiagnostics()}>
          <Stethoscope size={16} />
          诊断启动慢
        </button>
      </div>

      <p className="diagnostics-intro">
        账号快照切换只是本地文件复制。若 Codex 重新进入较慢，通常是 Codex 初始化、MCP、网络或工作区扫描导致。
      </p>

      {diagnostics ? (
        <div className="diagnostics-grid">
          <div className="diagnostics-section">
            <h4>切换器耗时</h4>
            {diagnostics.lastSwitchTiming ? (
              <>
                <p className="diagnostics-muted">
                  {diagnostics.lastSwitchTiming.accountName}，总耗时 {diagnostics.lastSwitchTiming.totalMs}ms
                </p>
                <div className="timing-list">
                  {diagnostics.lastSwitchTiming.steps.map((step) => (
                    <div key={step.name}>
                      <span>{stepLabel(step)}</span>
                      <strong>{step.durationMs}ms</strong>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="diagnostics-muted">暂无最近切换记录。</p>
            )}
          </div>

          <div className="diagnostics-section">
            <h4>auth 文件状态</h4>
            <div className="diagnostics-facts">
              <span>存在：{diagnostics.auth.authExists ? '是' : '否'}</span>
              <span>JSON：{diagnostics.auth.jsonValid ? '有效' : '无效'}</span>
              <span>token 字段：{diagnostics.auth.hasTokenField ? '存在' : '未发现'}</span>
            </div>
          </div>

          <div className="diagnostics-section">
            <h4>MCP 配置</h4>
            <p className="diagnostics-muted">
              {diagnostics.mcp.hasMcpServers
                ? `检测到 MCP 配置${diagnostics.mcp.serverCount ? `，约 ${diagnostics.mcp.serverCount} 个 server` : ''}。`
                : diagnostics.mcp.configExists
                  ? 'config.toml 存在，未发现 MCP server 配置。'
                  : '未发现 config.toml。'}
            </p>
            {diagnostics.mcp.configExists ? (
              <button className="ghost-button compact-button" onClick={() => void openConfig()}>
                <FileCog size={15} />
                打开 config.toml
              </button>
            ) : null}
          </div>

          <div className="diagnostics-section">
            <h4>代理环境</h4>
            <p className="diagnostics-muted">
              {diagnostics.proxy.detected ? `检测到：${diagnostics.proxy.variables.join(', ')}` : '未检测到常见代理环境变量。'}
            </p>
            {diagnostics.proxy.detected ? (
              <button className="ghost-button compact-button" onClick={() => void copyUnsetCommand(diagnostics.proxy.unsetCommand)}>
                <Clipboard size={15} />
                复制 unset 命令
              </button>
            ) : null}
          </div>

          <div className="diagnostics-section">
            <h4>Git 工作区</h4>
            <p className="diagnostics-muted">
              {diagnostics.git.isGitRepo
                ? `${diagnostics.git.root}，tracked files：${diagnostics.git.trackedFiles ?? '未知'}`
                : '当前启动目录不是 Git 仓库。'}
            </p>
          </div>

          <div className="diagnostics-section">
            <h4>Codex App 会话</h4>
            <div className="diagnostics-facts">
              <span>运行中进程：{diagnostics.codexApp.runningProcessCount ?? '未知'}</span>
              <span>app-server：{diagnostics.codexApp.appServerRunning === null ? '未知' : diagnostics.codexApp.appServerRunning ? '运行中' : '未运行'}</span>
              <span>Cookies：{diagnostics.codexApp.hasCookies ? '存在' : '未发现'}</span>
              <span>Session Storage：{diagnostics.codexApp.hasSessionStorage ? '存在' : '未发现'}</span>
              <span>Local Storage：{diagnostics.codexApp.hasLocalStorage ? '存在' : '未发现'}</span>
            </div>
            {diagnostics.codexApp.cacheItems.length ? (
              <div className="cache-list">
                {diagnostics.codexApp.cacheItems.map((item) => (
                  <span key={item.name}>
                    {item.name}: {item.exists ? `${item.kind === 'directory' ? '目录' : '文件'}，${formatDate(item.modifiedAt)}` : '未发现'}
                  </span>
                ))}
              </div>
            ) : null}
            {diagnostics.codexApp.warning ? <p className="diagnostics-muted">{diagnostics.codexApp.warning}</p> : null}
            <button className="danger-button compact-button" disabled={busy} onClick={() => void resetCodexAppSession()}>
              <ShieldAlert size={15} />
              备份并重置 App 会话缓存
            </button>
            <p className="diagnostics-muted">
              只移动本机缓存到 ~/.codex/app-session-backups/。如果 Codex App 仍在运行，应用会拒绝执行。
            </p>
          </div>

          <div className="diagnostics-section">
            <h4>网络连通性</h4>
            <div className="diagnostics-facts">
              {diagnostics.network.map((item) => (
                <span key={item.host}>
                  {item.host}: {item.ok ? `可连接 ${item.durationMs}ms` : item.errorMessage ?? '失败'}
                </span>
              ))}
            </div>
          </div>

          <div className="diagnostics-section full-span">
            <h4>建议</h4>
            {diagnostics.warnings.length ? (
              <ul className="diagnostics-list">
                {diagnostics.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="diagnostics-muted">未发现明显本地风险。</p>
            )}
            {diagnostics.suggestions.length ? (
              <ul className="diagnostics-list">
                {diagnostics.suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            ) : null}
            <p className="diagnostics-muted">检查时间：{formatDate(diagnostics.checkedAt)}</p>
          </div>
        </div>
      ) : (
        <div className="diagnostics-empty">
          <RefreshCcw size={20} />
          <span>切换账号后可运行诊断，查看文件切换耗时和启动慢的常见原因。</span>
        </div>
      )}
    </section>
  );
}
