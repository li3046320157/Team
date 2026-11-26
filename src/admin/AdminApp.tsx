import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { apiErrorMessage } from '../data/api-core';
import { validateAdminPassword, type AuthUser } from '../data/auth';
import { useAppStore } from '../store/useAppStore';
import {
  apiAdminCredentials,
  apiAdminOverview,
  apiAdminRevokeSessions,
  apiAdminSecurity,
  apiAdminSetStatus,
  apiAdminUserDetail,
  apiAdminUsers,
  type AdminActivityDay,
  type AdminEvent,
  type AdminOverview,
  type AdminSecurityInfo,
  type AdminUserDetail,
  type AdminUserSummary,
} from './admin-api';
import './admin.css';

type AdminTab = 'overview' | 'users' | 'security';

const TAB_META: Record<AdminTab, { title: string; subtitle: string; kicker: string }> = {
  overview: {
    title: '运行总览',
    subtitle: '账户注册、活跃与登录动态，仅包含账户与使用元数据',
    kicker: 'ACCOUNT OPERATIONS',
  },
  users: {
    title: '用户管理',
    subtitle: '检索账户、查看使用概况、停用账户或撤销登录状态',
    kicker: 'USER DIRECTORY',
  },
  security: {
    title: '安全与账户',
    subtitle: '管理员凭据、会话有效期与安全操作记录',
    kicker: 'SECURITY CONTROL',
  },
};

const EVENT_LABELS: Record<string, string> = {
  register: '注册账户',
  login: '登录',
  username_changed: '修改用户名',
  phone_bound: '绑定手机号',
  phone_unbound: '解除手机号',
  password_changed: '修改密码',
  password_reset: '自助重置密码',
  recovery_updated: '更新找回问题',
  user_disabled: '被管理员停用',
  user_enabled: '被管理员恢复',
  sessions_revoked: '被管理员强制下线',
  admin_credentials_changed: '管理员更新凭据',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDay(day: string): string {
  return day.length >= 10 ? day.slice(5).replace('-', '/') : day;
}

function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}

function percent(value: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return '4%';
  return `${Math.max(4, Math.min(100, (value / max) * 100))}%`;
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="admin-loading">
      <span className="admin-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-error" role="alert">
      <p>{message}</p>
      <button type="button" className="admin-button is-ghost" style={{ marginTop: 8, paddingLeft: 0 }} onClick={onRetry}>
        <RefreshCw size={13} /> 重试
      </button>
    </div>
  );
}

function Panel({ title, subtitle, action, children }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-panel">
      <header className="admin-panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="admin-panel-body">{children}</div>
    </section>
  );
}

function ActivityBars({ days }: { days: AdminActivityDay[] }) {
  const max = Math.max(1, ...days.map((day) => day.activeUsers));
  return (
    <div className="admin-bars">
      {days.map((day, index) => (
        <div className="admin-bar-col" key={day.day}>
          <span className="admin-bar-value">{day.activeUsers}</span>
          <div className="admin-bar-track">
            <span
              className="admin-bar-fill"
              style={{ height: percent(day.activeUsers, max), animationDelay: `${index * 55}ms` }}
              title={`${day.day} · ${day.activeUsers} 位活跃用户 · ${day.views} 次心跳`}
            />
          </div>
          <span className="admin-bar-label">{formatDay(day.day)}</span>
        </div>
      ))}
    </div>
  );
}

function OverviewPanel({ onInspectUser }: { onInspectUser: (id: string) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiAdminOverview()
      .then((next) => setData(next))
      .catch((err) => setError(apiErrorMessage(err, '读取运行总览失败')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) return <LoadingBlock label="正在汇总账户数据…" />;
  if (error && !data) return <ErrorBlock message={error} onRetry={load} />;
  if (!data) return null;

  const { stats } = data;
  return (
    <div className="admin-page" data-testid="admin-overview">
      <div className="admin-stat-grid">
        <div className="admin-stat" data-testid="admin-stat-total">
          <span className="admin-stat-label"><Users size={12} /> 普通用户</span>
          <p className="admin-stat-value">{stats.totalUsers}</p>
          <p className="admin-stat-note">不含管理员账户</p>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label"><Activity size={12} /> 今日活跃</span>
          <p className="admin-stat-value">{stats.activeToday}</p>
          <p className="admin-stat-note">按上海时区统计</p>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label"><Clock size={12} /> 近 7 天活跃</span>
          <p className="admin-stat-value">{stats.active7d}</p>
          <p className="admin-stat-note">至少打开过一次账本</p>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label"><UserRound size={12} /> 近 7 天新增</span>
          <p className="admin-stat-value">{stats.newUsers7d}</p>
          <p className="admin-stat-note">滚动 7 天注册量</p>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-label"><AlertTriangle size={12} /> 已停用</span>
          <p className="admin-stat-value">{stats.disabledUsers}</p>
          <p className="admin-stat-note">停用后立即失去登录态</p>
        </div>
      </div>

      <div className="admin-section-head">
        <div>
          <h2>近 7 天使用动态</h2>
          <p>仅统计账户活跃与心跳次数，不包含任何账目、金额或分类信息。</p>
        </div>
        <button type="button" className="admin-button" onClick={load} disabled={loading}>
          <RefreshCw size={13} /> {loading ? '刷新中…' : '刷新数据'}
        </button>
      </div>

      {error && <ErrorBlock message={error} onRetry={load} />}

      <div className="admin-grid-2">
        <Panel title="活跃用户趋势" subtitle="柱高代表每天打开账本的去重用户数">
          <ActivityBars days={data.activity.days} />
          {!data.activity.complete && <p className="admin-note" style={{ marginTop: 12 }}>数据量较大，趋势仅展示前 5000 条使用记录。</p>}
        </Panel>
        <Panel title="最近登录" subtitle="最新 8 次普通用户登录">
          <div className="admin-list">
            {data.recentLogins.length === 0 && <p className="admin-empty">暂无登录记录</p>}
            {data.recentLogins.map((event) => (
              <div className="admin-list-row" key={event.id}>
                <div className="admin-list-main">
                  <strong>{event.username}</strong>
                  <span>{event.userAgent ?? '未知设备'}</span>
                </div>
                <div className="admin-list-side">{formatDateTime(event.at)}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="admin-section-head">
        <div>
          <h2>最近注册</h2>
          <p>点击用户可进入详细账户与使用概览。</p>
        </div>
      </div>
      <Panel title="新账户" subtitle="按注册时间倒序">
        <div className="admin-list">
          {data.recentUsers.length === 0 && <p className="admin-empty">还没有普通用户注册</p>}
          {data.recentUsers.map((user) => (
            <button
              type="button"
              className="admin-list-row"
              key={user.id}
              onClick={() => onInspectUser(user.id)}
              style={{ width: '100%', background: 'none', borderLeft: 0, borderRight: 0, borderTop: 0, textAlign: 'left', cursor: 'pointer' }}
            >
              <div className="admin-list-main">
                <strong>{user.username}</strong>
                <span>{user.phoneMasked ?? '未绑定手机号'} · 注册于 {formatDateTime(user.createdAt)}</span>
              </div>
              <div className="admin-list-side">
                <span className={`admin-badge ${user.status === 'active' ? 'is-active' : 'is-disabled'}`}>
                  {user.status === 'active' ? '正常' : '已停用'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function UserDetailDrawer({ id, onClose, onChanged }: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'disable' | 'revoke' | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = useAppStore((s) => s.notify);

  const load = () => {
    setLoading(true);
    setError(null);
    apiAdminUserDetail(id)
      .then((next) => setDetail(next))
      .catch((err) => setError(apiErrorMessage(err, '读取用户详情失败')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const changeStatus = async (status: 'active' | 'disabled') => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await apiAdminSetStatus(id, status);
      setDetail((current) => current ? {
        ...current,
        user: { ...current.user, status: result.user.status },
        activeSessions: status === 'disabled' ? 0 : current.activeSessions,
      } : current);
      setConfirm(null);
      notify(status === 'disabled' ? '账户已停用，登录状态已撤销' : '账户已恢复', 'success');
      onChanged();
    } catch (err) {
      setActionError(apiErrorMessage(err, '更新账户状态失败'));
    } finally {
      setBusy(false);
    }
  };

  const revokeSessions = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await apiAdminRevokeSessions(id);
      setDetail((current) => current ? { ...current, activeSessions: 0 } : current);
      setConfirm(null);
      notify(`已撤销 ${result.sessionsRevoked} 个登录会话`, 'success');
      onChanged();
    } catch (err) {
      setActionError(apiErrorMessage(err, '撤销登录状态失败'));
    } finally {
      setBusy(false);
    }
  };

  const usageMax = detail ? Math.max(1, ...detail.usage.daily.map((day) => day.views)) : 1;

  return (
    <div className="admin-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label="用户详情" data-testid="admin-user-detail">
        <header className="admin-drawer-head">
          <div style={{ minWidth: 0 }}>
            <span className="admin-topbar-kicker">USER PROFILE</span>
            <h2>{detail?.user.username ?? '用户详情'}</h2>
            <p>账户资料与使用元数据 · 不包含账本流水</p>
          </div>
          <button type="button" className="admin-icon-button" onClick={onClose} aria-label="关闭详情">
            <X size={17} />
          </button>
        </header>

        <div className="admin-drawer-body">
          {loading && !detail && <LoadingBlock label="正在读取用户详情…" />}
          {error && !detail && <ErrorBlock message={error} onRetry={load} />}
          {detail && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span className={`admin-badge ${detail.user.status === 'active' ? 'is-active' : 'is-disabled'}`}>
                  {detail.user.status === 'active' ? '账户正常' : '已停用'}
                </span>
                <span className="admin-badge">{detail.activeSessions} 个有效会话</span>
                <span className="admin-badge is-amber">{detail.usage.activeDays30d} 天有使用</span>
              </div>

              {actionError && <div className="admin-error" role="alert">{actionError}</div>}

              <div className="admin-detail-grid">
                <div className="admin-detail-cell"><span>完整手机号</span><strong>{detail.user.phone ?? '未绑定'}</strong></div>
                <div className="admin-detail-cell"><span>登录次数</span><strong>{detail.user.loginCount}</strong></div>
                <div className="admin-detail-cell"><span>注册时间</span><strong>{formatDateTime(detail.user.createdAt)}</strong></div>
                <div className="admin-detail-cell"><span>最近登录</span><strong>{formatDateTime(detail.user.lastLoginAt)}</strong></div>
                <div className="admin-detail-cell"><span>最近活跃</span><strong>{formatDateTime(detail.user.lastActiveAt)}</strong></div>
                <div className="admin-detail-cell"><span>账号 ID</span><strong>{detail.user.id}</strong></div>
              </div>

              <Panel title="近 14 天使用" subtitle={`30 天共 ${detail.usage.totalViews30d} 次心跳 · 最近活跃 ${formatDateTime(detail.usage.lastSeenAt)}`}>
                <div className="admin-usage-bar" aria-hidden="true">
                  {detail.usage.daily.map((day) => (
                    <span className="admin-usage-day" key={day.day} title={`${day.day} · ${day.views} 次`}>
                      <span style={{ height: percent(day.views, usageMax) }} />
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, color: 'var(--admin-dim)', fontSize: 9 }}>
                  <span>{formatDay(detail.usage.daily[0]?.day ?? '')}</span>
                  <span>今天</span>
                </div>
              </Panel>

              <Panel title="账户操作" subtitle="操作会立即作用于该用户当前所有设备">
                {confirm === 'disable' && (
                  <div className="admin-confirm">
                    <p>确认停用「{detail.user.username}」？系统会立即撤销其全部登录会话，用户将无法继续登录。</p>
                    <div className="admin-confirm-actions">
                      <button type="button" className="admin-button" onClick={() => setConfirm(null)} disabled={busy}>取消</button>
                      <button type="button" className="admin-button is-danger" onClick={() => void changeStatus('disabled')} disabled={busy}>
                        {busy ? '处理中…' : '确认停用'}
                      </button>
                    </div>
                  </div>
                )}
                {confirm === 'revoke' && (
                  <div className="admin-confirm">
                    <p>确认强制「{detail.user.username}」退出所有设备？账户仍可重新登录。</p>
                    <div className="admin-confirm-actions">
                      <button type="button" className="admin-button" onClick={() => setConfirm(null)} disabled={busy}>取消</button>
                      <button type="button" className="admin-button is-danger" onClick={() => void revokeSessions()} disabled={busy}>
                        {busy ? '处理中…' : '确认撤销'}
                      </button>
                    </div>
                  </div>
                )}
                {!confirm && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      className={`admin-button ${detail.user.status === 'active' ? 'is-danger' : 'is-primary'}`}
                      data-testid="admin-toggle-status"
                      onClick={() => { if (detail.user.status === 'active') setConfirm('disable'); else void changeStatus('active'); }}
                      disabled={busy}
                    >
                      {detail.user.status === 'active' ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                      {detail.user.status === 'active' ? '停用账户' : '恢复账户'}
                    </button>
                    <button
                      type="button"
                      className="admin-button"
                      data-testid="admin-revoke-sessions"
                      onClick={() => setConfirm('revoke')}
                      disabled={busy || detail.activeSessions === 0}
                    >
                      <LogOut size={13} /> 强制下线
                    </button>
                  </div>
                )}
                <p className="admin-note" style={{ marginTop: 12 }}>
                  停用或撤销会话不会删除该用户的云端账户，也不会影响其保存在本机的账本数据。
                </p>
              </Panel>

              <Panel title="账户事件" subtitle="最近 20 条账户安全记录">
                {detail.events.length === 0 && <p className="admin-empty">暂无事件记录</p>}
                <div className="admin-timeline">
                  {detail.events.map((event) => (
                    <div className="admin-timeline-item" key={event.id}>
                      <strong>{eventLabel(event.kind)}</strong>
                      {event.actorName && <span>操作人：{event.actorName}</span>}
                      <span>{formatDateTime(event.at)} · {event.userAgent ?? '未知设备'}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function UsersPanel({ initialUserId, onInitialConsumed }: {
  initialUserId: string | null;
  onInitialConsumed: () => void;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialUserId);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (initialUserId) {
      setDetailId(initialUserId);
      onInitialConsumed();
    }
  }, [initialUserId, onInitialConsumed]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiAdminUsers(page, query)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setTruncated(data.truncated);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, '读取用户列表失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page, query, reloadToken]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setQuery(input.trim());
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="admin-page" data-testid="admin-users">
      <div className="admin-section-head">
        <div>
          <h2>账户目录</h2>
          <p>支持用户名前缀与手机号前缀检索；详细数据按需读取。</p>
        </div>
        <button type="button" className="admin-button" onClick={() => setReloadToken((value) => value + 1)} disabled={loading}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>

      <Panel title="检索用户" subtitle="默认按注册时间倒序">
        <form className="admin-toolbar" onSubmit={submitSearch}>
          <div className="admin-search">
            <Search size={15} />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="输入用户名或手机号前缀"
              maxLength={40}
              data-testid="admin-user-search"
              aria-label="搜索用户"
            />
          </div>
          <button type="submit" className="admin-button is-primary">搜索</button>
          {(query || input) && (
            <button type="button" className="admin-button is-ghost" onClick={() => { setInput(''); setQuery(''); setPage(1); }}>
              清空
            </button>
          )}
        </form>
        {truncated && <p className="admin-note" style={{ marginTop: 10 }}>搜索结果超过 200 条，已截取最近注册的账户；请输入更精确的前缀。</p>}
      </Panel>

      <div style={{ marginTop: 14 }}>
        <Panel title={`用户列表 · ${total}`} subtitle={`第 ${page} / ${totalPages} 页`}>
          {error && <ErrorBlock message={error} onRetry={() => setReloadToken((value) => value + 1)} />}
          {!error && loading && items.length === 0 && <LoadingBlock label="正在读取账户目录…" />}
          {!error && !loading && items.length === 0 && <p className="admin-empty">没有匹配的账户</p>}
          {items.length > 0 && (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>状态</th>
                      <th>注册时间</th>
                      <th>最近登录</th>
                      <th>登录次数</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((user) => (
                      <tr
                        key={user.id}
                        tabIndex={0}
                        onClick={() => setDetailId(user.id)}
                        onKeyDown={(event) => { if (event.key === 'Enter') setDetailId(user.id); }}
                        data-testid="admin-user-row"
                      >
                        <td>
                          <span className="admin-user-cell">{user.username}</span>
                          <span className="admin-row-sub">{user.phoneMasked ?? '未绑定手机号'}</span>
                        </td>
                        <td><span className={`admin-badge ${user.status === 'active' ? 'is-active' : 'is-disabled'}`}>{user.status === 'active' ? '正常' : '已停用'}</span></td>
                        <td>{formatDateTime(user.createdAt)}</td>
                        <td>{formatDateTime(user.lastLoginAt)}</td>
                        <td>{user.loginCount}</td>
                        <td style={{ textAlign: 'right' }}><ChevronRight size={14} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-pagination">
                <span>共 {total} 个普通用户 · 每页 20 条</span>
                <div className="admin-pagination-actions">
                  <button type="button" className="admin-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
                    <ChevronLeft size={13} /> 上一页
                  </button>
                  <button type="button" className="admin-button" onClick={() => setPage((value) => value + 1)} disabled={!hasMore || loading}>
                    下一页 <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      {detailId && (
        <UserDetailDrawer
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => setReloadToken((value) => value + 1)}
        />
      )}
    </div>
  );
}

function CredentialsForm({ admin, onUpdated }: { admin: AuthUser; onUpdated: (user: AuthUser) => void }) {
  const [username, setUsername] = useState(admin.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const notify = useAppStore((s) => s.notify);

  useEffect(() => {
    setUsername(admin.username);
  }, [admin.username]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(null);
    if (!currentPassword) {
      setError('请填写当前管理员密码');
      return;
    }
    const nextName = username.trim();
    if (!nextName) {
      setError('管理员用户名不能为空');
      return;
    }
    const usernameChanged = nextName !== admin.username;
    if (newPassword) {
      const passwordError = validateAdminPassword(newPassword);
      if (passwordError) {
        setError(passwordError);
        return;
      }
      if (newPassword !== confirm) {
        setError('两次输入的新密码不一致');
        return;
      }
    } else if (confirm) {
      setError('请填写完整的新密码');
      return;
    }
    if (!usernameChanged && !newPassword) {
      setError('用户名与新密码均未变化');
      return;
    }
    setBusy(true);
    try {
      const result = await apiAdminCredentials({
        currentPassword,
        username: usernameChanged ? nextName : undefined,
        newPassword: newPassword || undefined,
      });
      onUpdated(result.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      const note = newPassword
        ? `管理员凭据已更新${result.otherSessionsRevoked > 0 ? `，并撤销 ${result.otherSessionsRevoked} 个其他会话` : ''}`
        : '管理员用户名已更新';
      setSaved(note);
      notify(note, 'success');
    } catch (err) {
      setError(apiErrorMessage(err, '更新管理员凭据失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} data-testid="admin-credentials">
      <label className="admin-field">
        <span className="admin-label">管理员用户名</span>
        <input className="admin-input" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={20} autoComplete="username" />
      </label>
      <label className="admin-field">
        <span className="admin-label">当前管理员密码（用于验证身份）</span>
        <span className="admin-password-wrap">
          <input
            className="admin-input"
            type={showCurrent ? 'text' : 'password'}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
          <button type="button" className="admin-password-toggle" onClick={() => setShowCurrent((value) => !value)} aria-label={showCurrent ? '隐藏密码' : '显示密码'}>
            {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </span>
      </label>
      <div className="admin-form-grid" style={{ marginTop: 12 }}>
        <label className="admin-field">
          <span className="admin-label">新密码（可选）</span>
          <input
            className="admin-input"
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="至少 10 位，含字母和数字"
          />
        </label>
        <label className="admin-field">
          <span className="admin-label">确认新密码</span>
          <input
            className="admin-input"
            type={showNew ? 'text' : 'password'}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, color: 'var(--admin-muted)', fontSize: 10.5 }}>
        <input type="checkbox" checked={showNew} onChange={(event) => setShowNew(event.target.checked)} />
        显示新密码
      </label>
      {error && <div className="admin-error" style={{ marginTop: 12 }} role="alert">{error}</div>}
      {saved && <div className="admin-note" style={{ marginTop: 12 }}>{saved}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="submit" className="admin-button is-primary" disabled={busy} data-testid="admin-save-credentials">
          <KeyRound size={13} /> {busy ? '保存中…' : '保存管理员凭据'}
        </button>
      </div>
    </form>
  );
}

function SecurityPanel() {
  const user = useAppStore((s) => s.user);
  const applyUser = useAppStore((s) => s.applyUser);
  const [data, setData] = useState<AdminSecurityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    apiAdminSecurity()
      .then((next) => setData(next))
      .catch((err) => setError(apiErrorMessage(err, '读取安全信息失败')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (!user) return null;

  return (
    <div className="admin-page" data-testid="admin-security">
      <div className="admin-section-head">
        <div>
          <h2>管理员安全</h2>
          <p>管理员仅能查看账户与使用元数据，不能读取任何用户的账本流水。</p>
        </div>
        <button type="button" className="admin-button" onClick={load} disabled={loading}>
          <RefreshCw size={13} /> 刷新
        </button>
      </div>

      {error && <ErrorBlock message={error} onRetry={load} />}
      {loading && !data && <LoadingBlock label="正在读取安全信息…" />}

      <div className="admin-grid-2">
        <Panel title="管理员凭据" subtitle="修改后立即生效，其他管理员会话会被撤销">
          <CredentialsForm
            admin={user}
            onUpdated={(next) => {
              applyUser(next);
              load();
            }}
          />
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title="当前账户" subtitle="管理员视角与普通用户界面完全隔离">
            <div className="admin-detail-grid">
              <div className="admin-detail-cell"><span>用户名</span><strong>{user.username}</strong></div>
              <div className="admin-detail-cell"><span>角色</span><strong>ADMIN / ROOT</strong></div>
              <div className="admin-detail-cell"><span>最近登录</span><strong>{formatDateTime(user.lastLoginAt)}</strong></div>
              <div className="admin-detail-cell"><span>当前会话到期</span><strong>{formatDateTime(data?.session.expiresAt)}</strong></div>
              <div className="admin-detail-cell"><span>有效会话</span><strong>{data?.activeSessions ?? '—'}</strong></div>
              <div className="admin-detail-cell"><span>登录次数</span><strong>{data?.admin.loginCount ?? '—'}</strong></div>
            </div>
            {data && (
              <p className="admin-note" style={{ marginTop: 12 }}>
                管理员会话有效期较短；密码修改后，除当前设备外的其他会话会立即失效。
              </p>
            )}
          </Panel>

          <Panel title="管理员安全记录" subtitle="最近 10 条">
            {data && data.events.length === 0 && <p className="admin-empty">暂无记录</p>}
            <div className="admin-timeline">
              {data?.events.map((event: AdminEvent) => (
                <div className="admin-timeline-item" key={event.id}>
                  <strong>{eventLabel(event.kind)}</strong>
                  <span>{formatDateTime(event.at)} · {event.userAgent ?? '未知设备'}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="admin-section-head">
        <div>
          <h2>隐私边界</h2>
          <p>管理员视角不会展示用户的本机账本数据。</p>
        </div>
      </div>
      <Panel title="数据可见范围" subtitle="账户元数据与账本数据分离">
        <div className="admin-detail-grid">
          <div className="admin-detail-cell"><span>可见</span><strong>用户名 / 手机号 / 注册与登录时间 / 会话数 / 使用天数与心跳</strong></div>
          <div className="admin-detail-cell"><span>不可见</span><strong>账本流水 / 金额 / 分类 / 目标 / 预测 / AI 对话 / 本机备份</strong></div>
        </div>
        <p className="admin-note" style={{ marginTop: 12 }}>
          用户账本使用本机 IndexedDB 保存，不经过账户服务；管理员无法通过控制台读取或导出这些数据。
        </p>
      </Panel>
    </div>
  );
}

function AdminGate({ admin, onLogout }: { admin: AuthUser; onLogout: () => void }) {
  const applyUser = useAppStore((s) => s.applyUser);
  const notify = useAppStore((s) => s.notify);
  const [username, setUsername] = useState(admin.username);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!currentPassword) {
      setError('请填写当前管理员密码');
      return;
    }
    const nextName = username.trim();
    if (!nextName) {
      setError('管理员用户名不能为空');
      return;
    }
    const passwordError = validateAdminPassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密码不能与当前密码相同');
      return;
    }
    setBusy(true);
    try {
      const result = await apiAdminCredentials({
        currentPassword,
        username: nextName !== admin.username ? nextName : undefined,
        newPassword,
      });
      applyUser(result.user);
      notify('管理员初始密码已更新，控制台已解锁', 'success');
    } catch (err) {
      setError(apiErrorMessage(err, '更新管理员凭据失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-root">
      <div className="admin-gate" data-testid="admin-gate">
        <section className="admin-gate-card">
          <div className="admin-gate-brand">
            <div className="admin-brand-mark">¥</div>
            <div className="admin-brand-copy">
              <strong>金钱流水 · 管理中枢</strong>
              <span>ADMIN CONSOLE</span>
            </div>
          </div>
          <p className="admin-topbar-kicker">FIRST-RUN SECURITY</p>
          <h1 className="admin-gate-title" style={{ marginTop: 7 }}>先为管理员账户设置安全凭据</h1>
          <p className="admin-gate-sub">
            这是该管理员账户首次进入控制台。完成修改前，账户管理接口保持锁定，用户数据不可读取。
          </p>
          <div className="admin-gate-warning">
            <Lock size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>初始密码只用于首次接管。请设置独立的高强度密码，并确认管理员用户名不易被猜到。</span>
          </div>
          <form onSubmit={(event) => void submit(event)} data-testid="admin-gate-form">
            <label className="admin-field">
              <span className="admin-label">管理员用户名</span>
              <input
                className="admin-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={20}
                autoComplete="username"
                data-testid="admin-gate-username"
              />
            </label>
            <label className="admin-field">
              <span className="admin-label">当前密码</span>
              <input
                className="admin-input"
                type={showPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                data-testid="admin-gate-current"
              />
            </label>
            <div className="admin-form-grid" style={{ marginTop: 12 }}>
              <label className="admin-field">
                <span className="admin-label">新密码（至少 10 位，含字母和数字）</span>
                <input
                  className="admin-input"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  data-testid="admin-gate-password"
                />
              </label>
              <label className="admin-field">
                <span className="admin-label">确认新密码</span>
                <input
                  className="admin-input"
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  data-testid="admin-gate-confirm"
                />
              </label>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, color: 'var(--admin-muted)', fontSize: 10.5 }}>
              <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
              显示新密码
            </label>
            {error && <div className="admin-error" style={{ marginTop: 12 }} role="alert">{error}</div>}
            <div className="admin-gate-actions">
              <button type="button" className="admin-button is-ghost" onClick={onLogout} disabled={busy} data-testid="admin-gate-logout">
                <LogOut size={13} /> 退出登录
              </button>
              <button type="submit" className="admin-button is-primary" disabled={busy} data-testid="admin-gate-submit">
                <ShieldCheck size={14} /> {busy ? '正在保存…' : '保存并进入控制台'}
              </button>
            </div>
          </form>
          <p className="admin-footnote">管理员凭据不会写入前端代码或浏览器存储；会话使用 HttpOnly 安全 Cookie。</p>
        </section>
      </div>
    </div>
  );
}

export function AdminApp() {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const meta = TAB_META[tab];
  const initial = useMemo(() => user?.username.slice(0, 1).toUpperCase() ?? 'A', [user?.username]);

  if (!user || user.role !== 'admin') return null;

  const signOut = async () => {
    setSigningOut(true);
    await logout();
    setSigningOut(false);
  };

  if (user.mustChangePassword) {
    return <AdminGate admin={user} onLogout={() => void signOut()} />;
  }

  const nav = (
    <>
      <button type="button" className={`admin-nav-item ${tab === 'overview' ? 'is-active' : ''}`} onClick={() => setTab('overview')} aria-current={tab === 'overview' ? 'page' : undefined} data-testid="admin-nav-overview">
        <LayoutDashboard size={16} /> 运行总览
      </button>
      <button type="button" className={`admin-nav-item ${tab === 'users' ? 'is-active' : ''}`} onClick={() => setTab('users')} aria-current={tab === 'users' ? 'page' : undefined} data-testid="admin-nav-users">
        <Users size={16} /> 用户管理
      </button>
      <button type="button" className={`admin-nav-item ${tab === 'security' ? 'is-active' : ''}`} onClick={() => setTab('security')} aria-current={tab === 'security' ? 'page' : undefined} data-testid="admin-nav-security">
        <ShieldCheck size={16} /> 安全与账户
      </button>
    </>
  );

  return (
    <div className="admin-root" data-testid="admin-root">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <div className="admin-brand-mark">¥</div>
            <div className="admin-brand-copy">
              <strong>金钱流水</strong>
              <span>ADMIN CONSOLE</span>
            </div>
          </div>
          <nav className="admin-nav" aria-label="管理员导航">
            <p className="admin-nav-label">CONTROL / 控制台</p>
            {nav}
          </nav>
          <div className="admin-sidebar-foot">
            <strong>数据边界</strong>
            仅查看账户与使用元数据。用户账本、流水与 AI 对话始终留在用户本机，不进入管理员视图。
          </div>
        </aside>

        <main className="admin-main">
          <header className="admin-topbar">
            <div>
              <p className="admin-topbar-kicker">{meta.kicker}</p>
              <h1 className="admin-topbar-title">{meta.title}</h1>
              <p className="admin-topbar-sub">{meta.subtitle}</p>
            </div>
            <div className="admin-identity">
              <div className="admin-avatar" aria-hidden="true">{initial}</div>
              <div className="admin-identity-copy">
                <strong>{user.username}</strong>
                <span>ADMINISTRATOR</span>
              </div>
              <button type="button" className="admin-icon-button is-danger" onClick={() => void signOut()} disabled={signingOut} aria-label="退出管理员登录" data-testid="admin-logout">
                <LogOut size={16} />
              </button>
            </div>
          </header>

          <nav className="admin-mobile-nav" aria-label="管理员导航（移动端）">
            {nav}
          </nav>

          <div key={tab} style={{ marginTop: 4 }}>
            {tab === 'overview' && (
              <OverviewPanel
                onInspectUser={(id) => {
                  setInspectId(id);
                  setTab('users');
                }}
              />
            )}
            {tab === 'users' && (
              <UsersPanel initialUserId={inspectId} onInitialConsumed={() => setInspectId(null)} />
            )}
            {tab === 'security' && <SecurityPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}