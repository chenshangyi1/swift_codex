import { ExternalLink, Pencil, RefreshCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  AccountSnapshot,
  ManualUsageInput,
  OperationResult,
  UsageRefreshResult,
  UsageSnapshot
} from '../../../shared/types';

type LogLevel = 'info' | 'success' | 'error' | 'warn';

interface UsageDashboardProps {
  accounts: AccountSnapshot[];
  onLog: (level: LogLevel, message: string) => void;
}

interface ManualFormState {
  accountName: string;
  fiveHourRemainingPercent: string;
  weeklyRemainingPercent: string;
  resetTime: string;
  note: string;
}

const isUsageRefreshResult = (value: UsageRefreshResult | UsageSnapshot): value is UsageRefreshResult =>
  'current' in value && 'accounts' in value;

const isSuccessful = <T,>(result: OperationResult<T>): result is OperationResult<T> & { ok: true; data: T } =>
  result.ok && result.data !== undefined;

const formatDate = (value: string | null): string => {
  if (!value) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
};

const percentText = (value: number | null): string => (value === null ? '未记录' : `${value}%`);

const percentTone = (value: number | null): string => {
  if (value === null) return 'muted';
  if (value <= 20) return 'bad';
  if (value <= 40) return 'warning';
  return 'good';
};

const parsePercent = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
};

function UsageBar({ label, value }: { label: string; value: number | null }): ReactElement {
  const tone = percentTone(value);
  const width = value ?? 0;

  return (
    <div className="usage-quota-row">
      <div className="usage-meter-row">
        <span>{label}</span>
        <span>{percentText(value)}</span>
      </div>
      <div className={`usage-meter remaining ${tone}`}>
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function UsageCard({
  usage,
  busy,
  canEditManual,
  onRefresh,
  onManualEdit,
  onOpenUsagePage
}: {
  usage: UsageSnapshot;
  busy: boolean;
  canEditManual: boolean;
  onRefresh: () => void;
  onManualEdit: () => void;
  onOpenUsagePage: () => void;
}): ReactElement {
  const tone = usage.usageSupported ? 'good' : usage.canReadAuth ? 'muted' : 'warning';
  const sourceLabel = usage.usageSource === 'manual' ? '手动记录' : usage.usageSource === 'experimental' ? '实验来源' : '未接入';

  return (
    <article className="usage-item">
      <div className="usage-item-head">
        <div className="usage-title">
          <span className={`usage-dot ${tone}`} />
          <div>
            <h4>{usage.accountName}</h4>
            <p>{sourceLabel}</p>
          </div>
        </div>
        <div className="usage-card-actions">
          {canEditManual ? (
            <button className="mini-icon-button" disabled={busy} title="手动更新额度" onClick={onManualEdit}>
              <Pencil size={15} />
            </button>
          ) : null}
          <button className="mini-icon-button" disabled={busy} title="刷新状态" onClick={onRefresh}>
            <RefreshCcw size={15} />
          </button>
        </div>
      </div>

      <div className="usage-quota-stack">
        <UsageBar label="5 小时额度剩余" value={usage.fiveHourRemainingPercent} />
        <UsageBar label="周额度剩余" value={usage.weeklyRemainingPercent} />
      </div>

      <div className="usage-meta-grid">
        <div>
          <small>登录态</small>
          <strong>{usage.hasAuth && usage.canReadAuth ? '可读取' : '不可读取'}</strong>
        </div>
        <div>
          <small>额度来源</small>
          <strong>{sourceLabel}</strong>
        </div>
        <div>
          <small>重置时间</small>
          <strong>{formatDate(usage.resetTime)}</strong>
        </div>
        <div>
          <small>最后刷新</small>
          <strong>{formatDate(usage.lastChecked)}</strong>
        </div>
      </div>

      {usage.note ? <p className="usage-note">{usage.note}</p> : null}

      {usage.errorMessage ? (
        <details className="usage-error">
          <summary>查看说明</summary>
          <p>{usage.errorMessage}</p>
        </details>
      ) : null}

      <button className="usage-link-button" onClick={onOpenUsagePage}>
        <ExternalLink size={15} />
        打开 Codex 额度页面
      </button>
    </article>
  );
}

export function UsageDashboard({ accounts, onLog }: UsageDashboardProps): ReactElement {
  const [currentUsage, setCurrentUsage] = useState<UsageSnapshot | null>(null);
  const [accountUsage, setAccountUsage] = useState<Record<string, UsageSnapshot>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<ManualFormState | null>(null);

  const applyUsageResult = (result: UsageRefreshResult): void => {
    setCurrentUsage(result.current);
    setAccountUsage(
      Object.fromEntries(result.accounts.map((usage) => [usage.accountName, usage] satisfies [string, UsageSnapshot]))
    );
  };

  const refreshAll = async (quiet = false): Promise<void> => {
    setBusyKey('all');
    try {
      const result = await window.codexAccounts.refreshUsage();
      if (isSuccessful(result) && isUsageRefreshResult(result.data)) {
        applyUsageResult(result.data);
        if (!quiet) onLog('success', result.message);
      } else {
        onLog('error', result.message);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const refreshCurrent = async (): Promise<void> => {
    setBusyKey('current');
    try {
      const result = await window.codexAccounts.getCurrentUsage();
      if (isSuccessful(result)) {
        setCurrentUsage(result.data);
        onLog(result.data.usageSupported ? 'success' : 'info', result.message);
      } else {
        onLog('error', result.message);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const refreshAccount = async (name: string): Promise<void> => {
    setBusyKey(name);
    try {
      const result = await window.codexAccounts.getAccountUsage(name);
      if (isSuccessful(result)) {
        setAccountUsage((current) => ({ ...current, [name]: result.data }));
        onLog(result.data.usageSupported ? 'success' : 'info', result.message);
      } else {
        onLog('error', result.message);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const openUsagePage = async (): Promise<void> => {
    const result = await window.codexAccounts.openUsagePage();
    onLog(result.ok ? 'success' : 'error', result.message);
  };

  const startManualEdit = (accountName: string, usage?: UsageSnapshot): void => {
    setManualForm({
      accountName,
      fiveHourRemainingPercent: usage?.fiveHourRemainingPercent?.toString() ?? '',
      weeklyRemainingPercent: usage?.weeklyRemainingPercent?.toString() ?? '',
      resetTime: usage?.resetTime ?? '',
      note: usage?.note ?? ''
    });
  };

  const saveManualUsage = async (): Promise<void> => {
    if (!manualForm) return;

    const input: ManualUsageInput = {
      accountName: manualForm.accountName,
      fiveHourRemainingPercent: parsePercent(manualForm.fiveHourRemainingPercent),
      weeklyRemainingPercent: parsePercent(manualForm.weeklyRemainingPercent),
      resetTime: manualForm.resetTime.trim() || null,
      note: manualForm.note.trim() || null
    };

    setBusyKey(`manual:${manualForm.accountName}`);
    try {
      const result = await window.codexAccounts.saveManualUsage(input);
      if (isSuccessful(result)) {
        setAccountUsage((current) => ({ ...current, [result.data.accountName]: result.data }));
        setManualForm(null);
        onLog('success', result.message);
      } else {
        onLog('error', result.message);
      }
    } finally {
      setBusyKey(null);
    }
  };

  useEffect(() => {
    void refreshAll(true);
  }, [accounts.length]);

  return (
    <section className="card usage-dashboard">
      <div className="card-heading usage-heading">
        <div>
          <p className="eyebrow">Usage Dashboard</p>
          <h3>Codex 账号额度</h3>
        </div>
        <div className="usage-toolbar">
          <button className="ghost-button" disabled={busyKey !== null} onClick={() => void openUsagePage()}>
            <ExternalLink size={16} />
            打开额度页面
          </button>
          <button className="ghost-button" disabled={busyKey !== null} onClick={() => void refreshAll()}>
            <RefreshCcw size={16} />
            刷新全部
          </button>
        </div>
      </div>

      <div className="usage-current">
        {currentUsage ? (
          <UsageCard
            usage={currentUsage}
            busy={busyKey === 'current'}
            canEditManual={false}
            onRefresh={() => void refreshCurrent()}
            onManualEdit={() => undefined}
            onOpenUsagePage={() => void openUsagePage()}
          />
        ) : (
          <div className="usage-placeholder">
            <ShieldAlert size={24} />
            <p>尚未刷新当前账号额度状态。</p>
          </div>
        )}
      </div>

      <div className="usage-list-head">
        <div>
          <p className="eyebrow">已保存账号</p>
          <strong>{accounts.length} 个快照</strong>
        </div>
        <ShieldCheck size={18} />
      </div>

      <div className="usage-list">
        {accounts.length === 0 ? (
          <div className="usage-placeholder">
            <ShieldAlert size={24} />
            <p>暂无账号快照。</p>
          </div>
        ) : (
          accounts.map((account) => {
            const usage = accountUsage[account.name];
            return usage ? (
              <UsageCard
                key={account.name}
                usage={usage}
                busy={busyKey === account.name}
                canEditManual
                onRefresh={() => void refreshAccount(account.name)}
                onManualEdit={() => startManualEdit(account.name, usage)}
                onOpenUsagePage={() => void openUsagePage()}
              />
            ) : (
              <article className="usage-item" key={account.name}>
                <div className="usage-item-head">
                  <div className="usage-title">
                    <span className="usage-dot muted" />
                    <div>
                      <h4>{account.name}</h4>
                      <p>尚未刷新</p>
                    </div>
                  </div>
                  <div className="usage-card-actions">
                    <button
                      className="mini-icon-button"
                      disabled={busyKey !== null}
                      title="手动更新额度"
                      onClick={() => startManualEdit(account.name)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="mini-icon-button"
                      disabled={busyKey !== null}
                      title="刷新状态"
                      onClick={() => void refreshAccount(account.name)}
                    >
                      <RefreshCcw size={15} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {manualForm ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal usage-modal" role="dialog" aria-modal="true" aria-labelledby="manual-usage-title">
            <h3 id="manual-usage-title">手动更新「{manualForm.accountName}」额度</h3>
            <div className="usage-form">
              <label>
                <span>5 小时额度剩余百分比</span>
                <input
                  inputMode="numeric"
                  placeholder="0-100"
                  value={manualForm.fiveHourRemainingPercent}
                  onChange={(event) => setManualForm({ ...manualForm, fiveHourRemainingPercent: event.target.value })}
                />
              </label>
              <label>
                <span>周额度剩余百分比</span>
                <input
                  inputMode="numeric"
                  placeholder="0-100"
                  value={manualForm.weeklyRemainingPercent}
                  onChange={(event) => setManualForm({ ...manualForm, weeklyRemainingPercent: event.target.value })}
                />
              </label>
              <label>
                <span>重置时间</span>
                <input
                  placeholder="例如 2026-04-24 16:00"
                  value={manualForm.resetTime}
                  onChange={(event) => setManualForm({ ...manualForm, resetTime: event.target.value })}
                />
              </label>
              <label>
                <span>备注</span>
                <input
                  placeholder="来自 ChatGPT Codex Usage 页面"
                  value={manualForm.note}
                  onChange={(event) => setManualForm({ ...manualForm, note: event.target.value })}
                />
              </label>
            </div>
            <p className="usage-modal-note">记录会保存到本机 ~/.codex/usage-cache.json，不会上传。</p>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setManualForm(null)}>
                取消
              </button>
              <button className="accent-button" disabled={busyKey !== null} onClick={() => void saveManualUsage()}>
                保存记录
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
