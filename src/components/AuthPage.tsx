import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck, User, UserPlus } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatCN, todayISO } from '../domain/days';
import { CoinRain } from './CoinRain';
import { PalettePicker } from './PalettePicker';
import { cn } from './ui';

interface MiniCoin {
  id: number;
  born: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

interface Spark {
  dx: number;
  dy: number;
  delay: number;
  size: number;
  pale?: boolean;
}

const COIN_SPOTS = [
  { x: 50, y: 4 },
  { x: 82, y: 13 },
  { x: 95, y: 44 },
  { x: 84, y: 78 },
  { x: 57, y: 94 },
  { x: 26, y: 90 },
  { x: 8, y: 68 },
  { x: 4, y: 34 },
  { x: 20, y: 10 },
  { x: 66, y: 88 },
];

function makeCoins(): MiniCoin[] {
  return COIN_SPOTS.map((spot, index) => ({
    id: index,
    born: 0,
    x: spot.x,
    y: spot.y,
    size: 24 + ((index * 7) % 16),
    delay: Math.round(((index % 5) * 0.6) * 10) / 10,
    duration: 5.2 + (index % 3) * 0.9,
  }));
}

function randomSpot() {
  const angle = Math.random() * Math.PI * 2;
  const radius = 39 + Math.random() * 8;
  return {
    x: Math.round((50 + Math.cos(angle) * radius) * 10) / 10,
    y: Math.round((50 + Math.sin(angle) * radius * 0.95) * 10) / 10,
    size: 22 + Math.round(Math.random() * 16),
    delay: Math.round(Math.random() * 10) / 10,
    duration: 5.2 + Math.random() * 2.4,
  };
}

function makeSparks(seed: number): Spark[] {
  let value = seed * 9301 + 49297;
  const rand = () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
  return Array.from({ length: 9 }, (_, index) => ({
    dx: Math.round((rand() - 0.5) * 76),
    dy: Math.round((rand() - 0.5) * 76),
    delay: Math.round(rand() * 70),
    size: 5 + Math.round(rand() * 5),
    pale: index % 3 === 1,
  }));
}

function makeBurst(seed: number): Spark[] {
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2 + (seed % 5) * 0.09;
    const distance = 92 + ((index * 37 + seed * 17) % 68);
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance),
      delay: (index % 4) * 26,
      size: 6 + ((index * 7 + seed) % 7),
    };
  });
}

function CoinStage() {
  const [coins, setCoins] = useState<MiniCoin[]>(makeCoins);
  const [popping, setPopping] = useState<Record<number, boolean>>({});
  const [sparks, setSparks] = useState<Record<number, Spark[]>>({});
  const [collected, setCollected] = useState(0);
  const [bigBurst, setBigBurst] = useState(0);
  const [bigFlash, setBigFlash] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const schedule = (run: () => void, delay: number) => {
    timers.current.push(window.setTimeout(run, delay));
  };

  const popCoin = (coin: MiniCoin) => {
    if (popping[coin.id]) return;
    setPopping((prev) => ({ ...prev, [coin.id]: true }));
    setSparks((prev) => ({ ...prev, [coin.id]: makeSparks(coin.id + collected * 7 + 1) }));
    setCollected((count) => count + 1);
    schedule(() => {
      const spot = randomSpot();
      setCoins((list) => list.map((item) => (item.id === coin.id ? { ...item, ...spot, born: item.born + 1 } : item)));
      setPopping((prev) => {
        const next = { ...prev };
        delete next[coin.id];
        return next;
      });
      setSparks((prev) => {
        const next = { ...prev };
        delete next[coin.id];
        return next;
      });
    }, 620);
  };

  const fireBig = () => {
    setBigBurst((value) => value + 1);
    setBigFlash(true);
    schedule(() => setBigFlash(false), 760);
  };

  return (
    <div className="coin-stage">
      <span className="coin-rays" aria-hidden="true" />
      <span className="coin-orbit" aria-hidden="true" />
      <button
        type="button"
        className={cn('big-coin', bigFlash && 'is-bursting')}
        onClick={fireBig}
        aria-label="大金币，点击闪光"
        data-testid="auth-big-coin"
      >
        <span className="big-coin-gloss" aria-hidden="true" />
        <span className="big-coin-rim" aria-hidden="true" />
        <span className="big-coin-emboss" aria-hidden="true">¥</span>
        {bigBurst > 0 && (
          <span key={bigBurst} className="big-coin-burst" aria-hidden="true">
            <span className="big-burst-ring" />
            {makeBurst(bigBurst).map((spark, index) => (
              <span
                key={index}
                className="big-spark"
                style={{ '--dx': `${spark.dx}px`, '--dy': `${spark.dy}px`, '--delay': `${spark.delay}ms`, '--size': `${spark.size}px` } as CSSProperties}
              />
            ))}
          </span>
        )}
      </button>
      {coins.map((coin) => (
        <button
          key={`${coin.id}-${coin.born}`}
          type="button"
          className={cn('mini-coin', popping[coin.id] && 'is-popping')}
          style={{
            left: `${coin.x}%`,
            top: `${coin.y}%`,
            '--coin-size': `${coin.size}px`,
            '--coin-delay': `${coin.delay}s`,
            '--coin-duration': `${coin.duration}s`,
          } as CSSProperties}
          onClick={() => popCoin(coin)}
          aria-label="点亮小金币"
          data-testid="auth-mini-coin"
        >
          <span aria-hidden="true">¥</span>
          {sparks[coin.id]?.map((spark, index) => (
            <i
              key={index}
              className={cn('coin-spark', spark.pale && 'is-pale')}
              style={{ '--dx': `${spark.dx}px`, '--dy': `${spark.dy}px`, '--delay': `${spark.delay}ms`, '--size': `${spark.size}px` } as CSSProperties}
              aria-hidden="true"
            />
          ))}
        </button>
      ))}
      <p className="coin-meter" aria-live="polite">
        <span className="coin-meter-dot" aria-hidden="true" />
        {collected > 0 ? `已点亮 ${collected} 枚金币` : '点击小金币试试'}
      </p>
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

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    setUsername('');
    setPassword('');
    setConfirm('');
    setError(null);
    setShowPassword(false);
  }, [mode]);

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
    <div className="auth-scene" data-testid="auth-page">
      <CoinRain />
      <span className="auth-glow auth-glow-a" aria-hidden="true" />
      <span className="auth-glow auth-glow-b" aria-hidden="true" />
      <span className="auth-watermark" aria-hidden="true">¥</span>
      <div className="auth-shell">
        <section className="auth-hero">
          <div className="auth-brand">
            <div className="brand-mark auth-logo grid h-11 w-11 place-items-center rounded-2xl text-xl font-bold text-white">¥</div>
            <div>
              <p className="text-[17px] font-semibold tracking-tight">金钱流水</p>
              <p className="mt-0.5 text-[10px] tracking-[0.2em] text-[#8A887F]">本地账本 · LOCAL LEDGER</p>
            </div>
          </div>
          <CoinStage />
          <div className="auth-hero-copy">
            <p className="auth-hero-kicker">顺手记一笔 · 日月年都看得清</p>
            <h1 className="auth-hero-title">把每一枚小钱，<br />都记进同一本账。</h1>
            <p className="auth-hero-sub">金币雨会随鼠标方向飘落，点击小金币会闪亮消失；账本、账户与流水都只留在本机浏览器。</p>
            <div className="auth-hero-chips" aria-hidden="true">
              <span className="is-accent">日 · 月 · 年监测</span>
              <span className="is-gold">现金流预测</span>
              <span className="is-green">目标预留</span>
            </div>
          </div>
        </section>

        <div className="auth-side">
          <div key={mode} className="auth-card ledger-paper">
            <span className="ledger-seal" aria-hidden="true">账</span>
            <header className="ledger-head">
              <p className="ledger-kicker">金钱流水 · 本地账本</p>
              <h2 className="ledger-title">{mode === 'login' ? '欢迎回来' : '创建本地账户'}</h2>
              <p className="ledger-date">{formatCN(todayISO())} · {mode === 'login' ? '对账入账' : '开立新户'}</p>
            </header>
            <div className="ledger-rule" aria-hidden="true" />

            <div className="mt-3">
              {mode === 'register' && (
                <button type="button" className="ledger-back" onClick={() => navigate('/login')} data-testid="auth-go-login">
                  <ArrowLeft size={14} /> 返回登录
                </button>
              )}
              <p className="mt-1 text-[12px] leading-relaxed text-[#6B6A63]">
                {mode === 'login' ? '登录你的本地账本，继续查看现金流。' : '账户与账本只保存在这台设备的浏览器里，注册后需登录进入。'}
              </p>
              {mode === 'register' && (
                <ul className="ledger-note mt-2.5">
                  <li><CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" /> 密码加盐哈希，仅存本机浏览器</li>
                  <li><CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" /> 每个用户独立账本，互不可见</li>
                  <li><CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" /> 注册完成后返回登录页进入账本</li>
                </ul>
              )}
            </div>

            {mode === 'login' && registeredName && (
              <p className="fade-in mt-3 flex items-start gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--accent-ink)]" data-testid="auth-registered-note">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                注册成功！账户「{registeredName}」已创建，请重新输入用户名和密码登录。
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

            <div className="mt-4 flex items-start gap-2 border-t border-dashed border-[#E0D8C8] pt-3 text-[10.5px] leading-relaxed text-[#6B6A63]">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <span>密码加盐哈希后只保存在本机；换电脑或清理浏览器数据前，请先在「数据中心」导出备份。</span>
            </div>
          </div>

          <div className="auth-palette">
            <span className="text-[10px] tracking-[0.18em] text-[#8A887F]">配色</span>
            <PalettePicker compact />
            <span className="hidden text-[10px] text-[#A3A097] sm:inline">即时生效</span>
          </div>
        </div>
      </div>
    </div>
  );
}