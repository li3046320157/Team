import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, ShieldCheck, User } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { cn } from './ui';

const COINS = [
  { left: '6%', delay: '0s', duration: '11s', size: 22 },
  { left: '16%', delay: '2.4s', duration: '13s', size: 16 },
  { left: '28%', delay: '5s', duration: '10s', size: 26 },
  { left: '44%', delay: '1.2s', duration: '14s', size: 18 },
  { left: '58%', delay: '3.6s', duration: '12s', size: 24 },
  { left: '72%', delay: '6.4s', duration: '11s', size: 15 },
  { left: '84%', delay: '0.8s', duration: '15s', size: 28 },
  { left: '93%', delay: '4.2s', duration: '12s', size: 19 },
];

export function AuthPage() {
  const login = useAppStore((s) => s.login);
  const register = useAppStore((s) => s.register);
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const switchTab = (next: 'login' | 'register') => {
    setTab(next);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (tab === 'register' && password !== confirm) {
      setError('两次输入的密码不一致');
      setShakeKey((k) => k + 1);
      return;
    }
    setBusy(true);
    const failure = tab === 'login' ? await login(username, password) : await register(username, password);
    setBusy(false);
    if (failure) {
      setError(failure);
      setShakeKey((k) => k + 1);
    }
  };

  return (
    <div className="auth-scene" data-testid="auth-page">
      <div className="auth-blob auth-blob-teal" aria-hidden="true" />
      <div className="auth-blob auth-blob-amber" aria-hidden="true" />
      {COINS.map((coin, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="auth-coin"
          style={{ left: coin.left, animationDelay: coin.delay, animationDuration: coin.duration, width: coin.size, height: coin.size, fontSize: coin.size * 0.55 }}
        >
          ¥
        </span>
      ))}

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="auth-card card w-full max-w-[420px] p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0E7568] text-xl font-bold text-white shadow-[0_10px_22px_-10px_rgba(14,117,104,0.9)]">¥</div>
            <div>
              <p className="text-[18px] font-semibold tracking-tight">MoneyFlow 钱流</p>
              <p className="mt-0.5 text-[11px] tracking-[0.14em] text-[#8A887F]">看清现金流向，再做消费决定</p>
            </div>
          </div>

          <div className="auth-tabs mt-6" role="tablist" aria-label="登录或注册">
            <span className={cn('auth-tab-indicator', tab === 'register' && 'auth-tab-indicator-right')} aria-hidden="true" />
            <button type="button" role="tab" aria-selected={tab === 'login'} data-testid="auth-tab-login" className={cn('auth-tab', tab === 'login' && 'auth-tab-active')} onClick={() => switchTab('login')}>
              登录
            </button>
            <button type="button" role="tab" aria-selected={tab === 'register'} data-testid="auth-tab-register" className={cn('auth-tab', tab === 'register' && 'auth-tab-active')} onClick={() => switchTab('register')}>
              注册
            </button>
          </div>

          <form className="mt-5 space-y-3.5" onSubmit={(e) => void submit(e)}>
            <label className="block">
              <span className="label">用户名</span>
              <div className="relative">
                <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                <input
                  className="input !pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="2–20 个字符，如：xiaoming"
                  maxLength={20}
                  autoComplete="username"
                  data-testid="auth-username"
                />
              </div>
            </label>
            <label className="block">
              <span className="label">密码</span>
              <div className="relative">
                <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                <input
                  className="input !pl-9 !pr-10"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位，建议字母加数字"
                  maxLength={64}
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  data-testid="auth-password"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#A3A097] hover:text-[#3A3D37]" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
            {tab === 'register' && (
              <label className="block fade-in">
                <span className="label">确认密码</span>
                <div className="relative">
                  <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                  <input
                    className="input !pl-9"
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="再输入一次密码"
                    maxLength={64}
                    autoComplete="new-password"
                    data-testid="auth-confirm"
                  />
                </div>
              </label>
            )}

            {error && (
              <p key={shakeKey} className="shake rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]" role="alert" data-testid="auth-error">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary w-full !py-3" disabled={busy} data-testid="auth-submit">
              {busy ? '请稍候…' : tab === 'login' ? '登录并进入账本' : '注册并开始记账'}
              {!busy && <ArrowRight size={15} />}
            </button>
          </form>

          <div className="mt-5 flex items-start gap-2 rounded-lg border border-[#E4E0D8] bg-[#FAF8F3] px-3 py-2.5 text-[11px] leading-relaxed text-[#6B6A63]">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#0B6357]" />
            <span>
              本地账户：密码加盐哈希后只保存在本机浏览器，账本按用户隔离、不上传服务器。换电脑或清除浏览器数据前，请先在「数据中心」导出备份。
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}