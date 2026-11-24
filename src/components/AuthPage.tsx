import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck, User, UserPlus } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

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

function AuthScene({ children }: { children: ReactNode }) {
  return (
    <div className="auth-scene" data-testid="auth-page">
      <div className="auth-blob auth-blob-teal" aria-hidden="true" />
      <div className="auth-blob auth-blob-amber" aria-hidden="true" />
      <svg className="auth-waves" viewBox="0 0 1440 360" preserveAspectRatio="none" aria-hidden="true">
        <path className="auth-wave auth-wave-teal" d="M0,210 C180,150 320,260 520,210 C720,160 860,270 1060,220 C1240,175 1340,240 1440,200" />
        <path className="auth-wave auth-wave-amber" d="M0,260 C200,210 360,300 560,255 C760,210 900,310 1100,265 C1280,225 1360,285 1440,250" />
      </svg>
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
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">{children}</div>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  testId,
  show,
  onToggle,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  testId: string;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
      <input
        className="input !pl-9 !pr-10"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={64}
        autoComplete={autoComplete}
        data-testid={testId}
      />
      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#A3A097] hover:text-[#3A3D37]" onClick={onToggle} aria-label={show ? '隐藏密码' : '显示密码'}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const login = useAppStore((s) => s.login);
  const register = useAppStore((s) => s.register);
  const navigate = useNavigate();
  const location = useLocation();
  const registeredName = (location.state as { registeredName?: string } | null)?.registeredName ?? '';

  const [username, setUsername] = useState(mode === 'login' ? registeredName : '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const fail = (message: string) => {
    setError(message);
    setShakeKey((k) => k + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === 'register' && password !== confirm) {
      fail('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    if (mode === 'login') {
      const failure = await login(username, password);
      setBusy(false);
      if (failure) fail(failure);
    } else {
      const failure = await register(username, password);
      setBusy(false);
      if (failure) {
        fail(failure);
        return;
      }
      navigate('/login', { state: { registeredName: username.trim() } });
    }
  };

  return (
    <AuthScene>
      <div key={mode} className="auth-card card w-full max-w-[420px] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="auth-logo grid h-11 w-11 place-items-center rounded-2xl bg-[#0E7568] text-xl font-bold text-white">¥</div>
          <div>
            <p className="text-[18px] font-semibold tracking-tight">MoneyFlow 钱流</p>
            <p className="mt-0.5 text-[11px] tracking-[0.14em] text-[#8A887F]">看清现金流向，再做消费决定</p>
          </div>
        </div>

        <div className="mt-5">
          {mode === 'register' && (
            <button
              type="button"
              className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold text-[#0B6357] transition hover:bg-[#E3F1ED]"
              onClick={() => navigate('/login')}
              data-testid="auth-go-login"
            >
              <ArrowLeft size={14} /> 返回登录
            </button>
          )}
          <h1 className="text-[19px] font-semibold tracking-tight">{mode === 'login' ? '欢迎回来' : '创建本地账户'}</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-[#6B6A63]">
            {mode === 'login' ? '登录你的本地账本，继续查看现金流。' : '账户与账本只保存在这台设备的浏览器里，注册后需登录进入。'}
          </p>
          {mode === 'register' && (
            <ul className="mt-3 space-y-1.5 rounded-lg border border-[#E4E0D8] bg-[#FAF8F3] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#6B6A63]">
              <li className="flex items-center gap-1.5"><CheckCircle2 size={13} className="shrink-0 text-[#0B6357]" /> 密码加盐哈希，仅存本机浏览器</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 size={13} className="shrink-0 text-[#0B6357]" /> 每个用户独立账本，互不可见</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 size={13} className="shrink-0 text-[#0B6357]" /> 注册完成后返回登录页进入账本</li>
            </ul>
          )}
        </div>

        {mode === 'login' && registeredName && (
          <p className="fade-in mt-3 flex items-start gap-2 rounded-lg border border-[#CBE5DD] bg-[#F1FAF7] px-3 py-2 text-[12px] leading-relaxed text-[#0B6357]" data-testid="auth-registered-note">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            注册成功！已为你填好用户名，请输入密码登录进入账本。
          </p>
        )}

        <form className="mt-4 space-y-3.5" onSubmit={(e) => void submit(e)}>
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
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="至少 6 位，建议字母加数字"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              testId="auth-password"
              show={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </label>
          {mode === 'register' && (
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
            {busy ? '请稍候…' : mode === 'login' ? '登录并进入账本' : '注册账户'}
            {!busy && <ArrowRight size={15} />}
          </button>
        </form>

        {mode === 'login' && (
          <button
            type="button"
            className="btn btn-secondary mt-4 w-full !py-2.5"
            onClick={() => navigate('/register')}
            data-testid="auth-go-register"
          >
            <UserPlus size={15} /> 没有账户？注册新账户
          </button>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#E4E0D8] bg-[#FAF8F3] px-3 py-2.5 text-[11px] leading-relaxed text-[#6B6A63]">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#0B6357]" />
          <span>
            本地账户：密码加盐哈希后只保存在本机浏览器，账本按用户隔离、不上传服务器。换电脑或清除浏览器数据前，请先在「数据中心」导出备份。
          </span>
        </div>
      </div>
    </AuthScene>
  );
}