import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  XCircle,
  Zap
} from 'lucide-react';
import type { AccountSnapshot, CodexStatus, OperationResult } from '../../shared/types';
import { UsageDashboard } from './components/UsageDashboard';
import { StartupDiagnosticsPanel } from './components/StartupDiagnosticsPanel';

type LogLevel = 'info' | 'success' | 'error' | 'warn';

interface LogEntry {
  id: string;
  at: string;
  level: LogLevel;
  message: string;
}

interface PendingAction {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  run: () => Promise<void>;
}

const formatDate = (value: string | null): string => {
  if (!value) return '无记录';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function isSuccessful<T>(result: OperationResult<T>): result is OperationResult<T> & { ok: true } {
  return result.ok;
}

export function App(): ReactElement {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountSnapshot[]>([]);
  const [selectedName, setSelectedName] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnosticsAccount, setDiagnosticsAccount] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.name === selectedName) ?? accounts[0] ?? null,
    [accounts, selectedName]
  );

  const pushLog = (level: LogLevel, message: string): void => {
    setLogs((current) =>
      [
        {
          id: crypto.randomUUID(),
          at: new Intl.DateTimeFormat('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }).format(new Date()),
          level,
          message
        },
        ...current
      ].slice(0, 80)
    );
  };

  const refresh = async (quiet = false): Promise<void> => {
    setBusy(true);
    try {
      if (!window.codexAccounts) {
        throw new Error('主进程桥接未加载，请重新启动应用。');
      }

      const [statusResult, accountsResult] = await Promise.all([
        window.codexAccounts.getCodexStatus(),
        window.codexAccounts.listAccounts()
      ]);

      if (isSuccessful(statusResult) && statusResult.data) {
        setStatus(statusResult.data);
      } else {
        pushLog('error', statusResult.message);
      }

      if (isSuccessful(accountsResult) && accountsResult.data) {
        setAccounts(accountsResult.data);
        if (!accountsResult.data.some((account) => account.name === selectedName)) {
          setSelectedName(accountsResult.data[0]?.name ?? '');
        }
      } else {
        pushLog('error', accountsResult.message);
      }

      if (!quiet) {
        pushLog('info', '已刷新本地 Codex 状态。');
      }
    } catch (error) {
      pushLog('error', error instanceof Error ? error.message : '刷新本地 Codex 状态失败。');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh(true);
  }, []);

  const runOperation = async <T,>(
    operation: () => Promise<OperationResult<T>>,
    after?: (result: OperationResult<T>) => void
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await operation();
      pushLog(result.ok ? 'success' : 'error', result.message);
      if (result.ok) {
        after?.(result);
        await refresh(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentAccount = async (): Promise<void> => {
    if (!newName.trim()) {
      pushLog('warn', '请先输入账号昵称，再保存当前快照。');
      return;
    }

    await runOperation(
      () => window.codexAccounts.saveCurrentAccount(newName),
      () => setNewName('')
    );
  };

  const requestSwitch = (account: AccountSnapshot): void => {
    setPending({
      title: `切换到「${account.name}」`,
      body: '当前 auth.json 会先自动备份，再由所选快照覆盖。切换完成后需要重启 Codex CLI / Codex App / IDE 插件。',
      confirmLabel: '确认切换',
      danger: true,
      run: () =>
        runOperation(
          () => window.codexAccounts.switchAccount(account.name),
          () => setDiagnosticsAccount(account.name)
        )
    });
  };

  const requestDelete = (account: AccountSnapshot): void => {
    setPending({
      title: `删除「${account.name}」`,
      body: '此操作只会删除 accounts 目录里的本地快照，不会删除当前 auth.json。删除后无法从应用内恢复。',
      confirmLabel: '删除快照',
      danger: true,
      run: () =>
        runOperation(
          () => window.codexAccounts.deleteAccount(account.name),
          () => setSelectedName('')
        )
    });
  };

  const confirmPending = async (): Promise<void> => {
    if (!pending) return;
    const action = pending;
    setPending(null);
    await action.run();
  };

  const openCodexDir = async (): Promise<void> => {
    await runOperation(() => window.codexAccounts.openCodexDir());
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1>Codex 账号</h1>
            <p>本地快照切换器</p>
          </div>
        </div>

        <div className="add-panel">
          <label htmlFor="account-name">添加当前账号</label>
          <p className="add-help">先给当前登录态取个昵称，例如 work 或 personal。</p>
          <div className="add-row">
            <input
              id="account-name"
              value={newName}
              maxLength={60}
              placeholder="英文/数字/_/-"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy) {
                  void saveCurrentAccount();
                }
              }}
            />
            <button
              className="save-button primary"
              disabled={busy}
              title={newName.trim() ? '保存当前 auth.json 快照' : '请先输入昵称'}
              onClick={() => void saveCurrentAccount()}
            >
              <Plus size={18} />
              保存
            </button>
          </div>
          {!newName.trim() ? <p className="field-note">昵称为空时不会创建快照。</p> : null}
        </div>

        <div className="account-list" aria-label="账号列表">
          {accounts.length === 0 ? (
            <div className="empty-state">暂无账号快照</div>
          ) : (
            accounts.map((account) => (
              <button
                key={account.fileName}
                className={`account-item ${selectedAccount?.name === account.name ? 'active' : ''}`}
                onClick={() => setSelectedName(account.name)}
              >
                <span className="avatar">
                  <UserRound size={18} />
                </span>
                <span className="account-text">
                  <strong>{account.name}</strong>
                  <small>{formatDate(account.updatedAt)}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local Only</p>
            <h2>OpenAI Codex CLI 登录态快照</h2>
          </div>
          <div className="toolbar">
            <button className="ghost-button" disabled={busy} onClick={() => void refresh()}>
              <RefreshCcw size={16} />
              刷新
            </button>
            <button className="ghost-button" disabled={busy} onClick={() => void openCodexDir()}>
              <FolderOpen size={16} />
              打开目录
            </button>
          </div>
        </header>

          <div className="grid">
          <section className="card status-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">当前 Codex 状态</p>
                <h3>{status ? (status.hasAuth ? '已发现 auth.json' : '未发现 auth.json') : '尚未读取 Codex 状态'}</h3>
              </div>
              {status?.hasAuth ? <CheckCircle2 className="ok" size={26} /> : <XCircle className="bad" size={26} />}
            </div>
            <dl className="facts">
              <div>
                <dt>认证文件</dt>
                <dd>{status?.authPath ?? '~/.codex/auth.json'}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{formatDate(status?.authUpdatedAt ?? null)}</dd>
              </div>
              <div>
                <dt>快照目录</dt>
                <dd>{status?.accountsDir ?? '~/.codex/accounts'}</dd>
              </div>
              <div>
                <dt>备份目录</dt>
                <dd>{status?.backupsDir ?? '~/.codex/backups'}</dd>
              </div>
            </dl>
          </section>

          <section className="card detail-card">
            {selectedAccount ? (
              <>
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">选中快照</p>
                    <h3>{selectedAccount.name}</h3>
                  </div>
                  <span className="file-pill">{formatSize(selectedAccount.sizeBytes)}</span>
                </div>
                <dl className="facts">
                  <div>
                    <dt>文件名</dt>
                    <dd>{selectedAccount.fileName}</dd>
                  </div>
                  <div>
                    <dt>保存位置</dt>
                    <dd>{selectedAccount.filePath}</dd>
                  </div>
                  <div>
                    <dt>更新时间</dt>
                    <dd>{formatDate(selectedAccount.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>快照完整性</dt>
                    <dd>
                      {selectedAccount.integrity.exists ? '文件存在' : '文件缺失'} /{' '}
                      {selectedAccount.integrity.jsonValid ? 'JSON 有效' : 'JSON 无效'} /{' '}
                      {selectedAccount.integrity.looksLikeCodexAuth ? '像 Codex auth' : '需检查'}
                    </dd>
                  </div>
                  <div>
                    <dt>过期提示</dt>
                    <dd>{selectedAccount.integrity.possiblyExpired ? '快照较久未更新，可能需要重新登录' : '暂无明显过期提示'}</dd>
                  </div>
                  {selectedAccount.integrity.warning ? (
                    <div>
                      <dt>提示</dt>
                      <dd>{selectedAccount.integrity.warning}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="action-row">
                  <button className="accent-button" disabled={busy} onClick={() => requestSwitch(selectedAccount)}>
                    <Zap size={16} />
                    切换到此账号
                  </button>
                  <button className="danger-button" disabled={busy} onClick={() => requestDelete(selectedAccount)}>
                    <Trash2 size={16} />
                    删除快照
                  </button>
                  <button className="ghost-button" disabled={busy} onClick={() => setDiagnosticsAccount(selectedAccount.name)}>
                    <RefreshCcw size={16} />
                    诊断启动慢
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-detail">
                <UserRound size={34} />
                <h3>选择或添加一个账号快照</h3>
                <p>应用只复制本机 JSON 文件，不读取、不展示、不上传敏感内容。</p>
              </div>
            )}
          </section>
          </div>

          <UsageDashboard accounts={accounts} onLog={pushLog} />

          <StartupDiagnosticsPanel accountName={diagnosticsAccount} onLog={pushLog} />

          <section className="card log-card">
          <div className="card-heading compact">
            <div>
              <p className="eyebrow">操作日志</p>
              <h3>最近记录</h3>
            </div>
          </div>
          <div className="log-list">
            {logs.length === 0 ? (
              <div className="empty-state">暂无操作记录</div>
            ) : (
              logs.map((log) => (
                <div className={`log-entry ${log.level}`} key={log.id}>
                  <span>{log.at}</span>
                  <p>{log.message}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </section>

      {pending ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="modal-icon danger">
              <AlertTriangle size={24} />
            </div>
            <h3 id="confirm-title">{pending.title}</h3>
            <p>{pending.body}</p>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setPending(null)}>
                取消
              </button>
              <button className={pending.danger ? 'danger-button' : 'accent-button'} onClick={() => void confirmPending()}>
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
