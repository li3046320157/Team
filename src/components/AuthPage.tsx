import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck, Smartphone, User, UserPlus } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { apiLookupRecovery, apiResetPassword } from '../data/account-api';
import { apiErrorMessage } from '../data/api-core';
import {
  CUSTOM_RECOVERY_QUESTION,
  RECOVERY_QUESTIONS,
  RECOVERY_QUESTION_MAX_CHARS,
  normalizePhone,
  resolveRecoveryQuestion,
  validateCredentials,
  validateNewPassword,
  validateRecoveryAnswer,
  validateRecoveryQuestion,
  type AccountLookup,
} from '../data/auth';
import { formatCN, todayISO } from '../domain/days';
import { isReducedMotion } from '../motion/gsap';
import { AuthIntro } from './AuthIntro';
import { CoinRain } from './CoinRain';
import { PalettePicker } from './PalettePicker';
import { ScrambleText, TypewriterText } from './TextFx';
import { cn } from './ui';

/** 每次整页加载只播一次；登录 / 注册之间切换不重播。 */
let authIntroSeen = false;

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
  const notify = useAppStore((s) => s.notify);
  const navigate = useNavigate();
  const location = useLocation();
  const registeredName = (location.state as { registeredName?: string } | null)?.registeredName ?? '';

  const [introOpen, setIntroOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [recoveryQuestion, setRecoveryQuestion] = useState('');
  const [customRecoveryQuestion, setCustomRecoveryQuestion] = useState('');
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const [forgot, setForgot] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [lookup, setLookup] = useState<AccountLookup | null>(null);
  const [forgotAnswer, setForgotAnswer] = useState('');
  const [forgotNewPwd, setForgotNewPwd] = useState('');
  const [forgotConfirm, setForgotConfirm] = useState('');
  const [forgotShowPwd, setForgotShowPwd] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);

  useLayoutEffect(() => {
    if (authIntroSeen || isReducedMotion()) return;
    authIntroSeen = true;
    setIntroOpen(true);
  }, []);

  useEffect(() => {
    setUsername('');
    setPassword('');
    setConfirm('');
    setPhoneInput('');
    setRecoveryQuestion('');
    setCustomRecoveryQuestion('');
    setRecoveryAnswer('');
    setError(null);
    setShowPassword(false);
    setForgot(false);
    setForgotId('');
    setLookup(null);
    setForgotAnswer('');
    setForgotNewPwd('');
    setForgotConfirm('');
    setForgotError(null);
    setForgotShowPwd(false);
  }, [mode]);

  const fail = (message: string) => {
    setError(message);
    setShakeKey((k) => k + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === 'login') {
      if (!username.trim() || !password) {
        fail('请输入用户名或手机号与密码');
        return;
      }
    } else {
      if (password !== confirm) {
        fail('两次输入的密码不一致');
        return;
      }
      const invalid = validateCredentials(username, password);
      if (invalid) {
        fail(invalid);
        return;
      }
      if (phoneInput.trim() && !normalizePhone(phoneInput)) {
        fail('手机号需为 11 位数字，且以 1 开头');
        return;
      }
      if (!recoveryQuestion) {
        fail('请选择或填写找回问题');
        return;
      }
      const question = resolveRecoveryQuestion(recoveryQuestion, customRecoveryQuestion);
      const questionError = validateRecoveryQuestion(question);
      if (questionError) {
        fail(questionError);
        return;
      }
      const answerError = validateRecoveryAnswer(recoveryAnswer);
      if (answerError) {
        fail(answerError);
        return;
      }
    }
    setBusy(true);
    if (mode === 'login') {
      const failure = await login(username, password);
      setBusy(false);
      if (failure) fail(failure);
    } else {
      const failure = await register(username, password, {
        phone: phoneInput,
        question: resolveRecoveryQuestion(recoveryQuestion, customRecoveryQuestion),
        answer: recoveryAnswer,
      });
      setBusy(false);
      if (failure) {
        fail(failure);
        return;
      }
      navigate('/login', { state: { registeredName: username.trim() } });
    }
  };

  const openForgot = () => {
    setForgot(true);
    setError(null);
    setUsername('');
    setPassword('');
    setConfirm('');
    setShowPassword(false);
    setForgotId('');
    setLookup(null);
    setForgotAnswer('');
    setForgotNewPwd('');
    setForgotConfirm('');
    setForgotShowPwd(false);
    setForgotError(null);
  };

  const closeForgot = () => {
    setForgot(false);
    setForgotId('');
    setLookup(null);
    setForgotAnswer('');
    setForgotNewPwd('');
    setForgotConfirm('');
    setForgotShowPwd(false);
    setForgotError(null);
    setError(null);
  };

  const lookupAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (forgotBusy) return;
    setForgotError(null);
    const value = forgotId.trim();
    if (!value) {
      setForgotError('请输入用户名或已绑定的手机号');
      return;
    }
    setForgotBusy(true);
    try {
      const hint = await apiLookupRecovery(value);
      if (!hint) {
        setLookup(null);
        setForgotError('没有找到匹配的账户，请检查用户名或手机号');
        return;
      }
      setLookup(hint);
      setForgotAnswer('');
      setForgotNewPwd('');
      setForgotConfirm('');
    } catch (err) {
      setForgotError(apiErrorMessage(err, '查询失败，请重试'));
    } finally {
      setForgotBusy(false);
    }
  };

  const submitReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!lookup || forgotBusy) return;
    setForgotError(null);
    const answerError = validateRecoveryAnswer(forgotAnswer);
    if (answerError) {
      setForgotError('请填写找回答案');
      return;
    }
    const passwordError = validateNewPassword(forgotNewPwd);
    if (passwordError) {
      setForgotError(passwordError.replace('密码长度需为', '新密码长度需为'));
      return;
    }
    if (forgotNewPwd !== forgotConfirm) {
      setForgotError('两次输入的新密码不一致');
      return;
    }
    setForgotBusy(true);
    try {
      const username = await apiResetPassword(lookup.username, forgotAnswer, forgotNewPwd);
      closeForgot();
      setUsername(username);
      setPassword('');
      notify(`账户「${username}」密码已重置，请使用新密码登录`, 'success');
    } catch (err) {
      setForgotError(apiErrorMessage(err, '重置失败，请重试'));
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <div className="auth-scene" data-testid="auth-page">
      {introOpen && <AuthIntro onDone={() => setIntroOpen(false)} />}
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
              <p className="mt-0.5 text-[10px] tracking-[0.2em] text-[#8A887F]">私人账本 · PRIVATE LEDGER</p>
            </div>
          </div>
          <CoinStage />
          <div className="auth-hero-copy">
            <p className="auth-hero-kicker">
              <TypewriterText text="顺手记一笔 · 日月年都看得清" speed={44} delay={0.1} />
            </p>
            <h1 className="auth-hero-title" aria-label="把每一枚小钱，都记进同一本账。">
              <TypewriterText text="把每一枚小钱，" speed={88} delay={0.3} caret={false} />
              <br />
              <TypewriterText text="都记进同一本账。" speed={88} delay={1.05} />
            </h1>
            <p className="auth-hero-sub">金币雨会随鼠标方向飘落，点击小金币会闪亮消失；登录账户由云端安全服务托管，账本与流水仍只保存在本机浏览器。</p>
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
              <p className="ledger-kicker">金钱流水 · 私人账本</p>
              <h2 className="ledger-title" aria-label={forgot ? '找回密码' : mode === 'login' ? '欢迎回来' : '创建账户'}>
                <ScrambleText text={forgot ? '找回密码' : mode === 'login' ? '欢迎回来' : '创建账户'} delay={0.2} duration={0.7} />
              </h2>
              <p className="ledger-date">{formatCN(todayISO())} · {forgot ? '核对身份' : mode === 'login' ? '对账入账' : '开立新户'}</p>
            </header>
            <div className="ledger-rule" aria-hidden="true" />

            {forgot ? (
              <div className="mt-3" data-testid="auth-forgot-panel">
                <button type="button" className="ledger-back" onClick={closeForgot} data-testid="auth-forgot-back">
                  <ArrowLeft size={14} /> 返回登录
                </button>
                <p className="mt-1 text-[12px] leading-relaxed text-[#6B6A63]">
                  {lookup
                    ? '核对找回问题后设置新密码，账本数据不会被删除。'
                    : '输入用户名或已绑定的手机号，用注册时设置的找回问题重置密码。'}
                </p>

                {!lookup ? (
                  <form className="mt-4 space-y-3.5" onSubmit={(e) => void lookupAccount(e)}>
                    <label className="block">
                      <span className="label">用户名或手机号</span>
                      <div className="relative">
                        <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                        <input
                          className="input !pl-9"
                          value={forgotId}
                          onChange={(e) => setForgotId(e.target.value)}
                          placeholder="如：xiaoming 或 13800138000"
                          maxLength={20}
                          autoComplete="username"
                          data-testid="auth-recover-identifier"
                        />
                      </div>
                    </label>
                    {forgotError && (
                      <p className="shake rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]" role="alert" data-testid="auth-forgot-error">
                        {forgotError}
                      </p>
                    )}
                    <button type="submit" className="btn btn-primary w-full !py-3" disabled={forgotBusy} data-testid="auth-recover-lookup">
                      {forgotBusy ? '查询中…' : '查找账户'}
                      {!forgotBusy && <ArrowRight size={15} />}
                    </button>
                  </form>
                ) : !lookup.recoveryQuestion ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-[#E7DFD2] bg-[#FCFBF7] px-3 py-2.5 text-[12px] leading-relaxed" data-testid="auth-recover-hint">
                      <p>
                        账户：{lookup.maskedUsername}
                        {lookup.maskedPhone ? ` · 手机 ${lookup.maskedPhone}` : ''}
                      </p>
                    </div>
                    <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] leading-relaxed text-[#98362E]" role="alert" data-testid="auth-recover-unavailable">
                      该账户未设置找回问题，无法自助重置密码。请再想想密码；登录后可在「个人设置 → 密码找回」补充问题。
                    </p>
                  </div>
                ) : (
                  <form className="mt-4 space-y-3.5" onSubmit={(e) => void submitReset(e)}>
                    <div className="rounded-lg border border-[#E7DFD2] bg-[#FCFBF7] px-3 py-2.5 text-[12px] leading-relaxed" data-testid="auth-recover-hint">
                      <p>
                        账户：{lookup.maskedUsername}
                        {lookup.maskedPhone ? ` · 手机 ${lookup.maskedPhone}` : ''}
                      </p>
                      <p className="mt-1 font-medium text-[#3A3D37]" data-testid="auth-recover-question">找回问题：{lookup.recoveryQuestion}</p>
                    </div>
                    <label className="block">
                      <span className="label">找回答案</span>
                      <div className="relative">
                        <ShieldCheck size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                        <input
                          className="input !pl-9"
                          value={forgotAnswer}
                          onChange={(e) => setForgotAnswer(e.target.value)}
                          placeholder="填写注册时设置的答案"
                          maxLength={40}
                          autoComplete="off"
                          data-testid="auth-recover-answer"
                        />
                      </div>
                    </label>
                    <label className="block">
                      <span className="label">新密码</span>
                      <PasswordInput
                        value={forgotNewPwd}
                        onChange={setForgotNewPwd}
                        placeholder="6–64 个字符"
                        autoComplete="new-password"
                        testId="auth-recover-password"
                        show={forgotShowPwd}
                        onToggle={() => setForgotShowPwd((v) => !v)}
                      />
                    </label>
                    <label className="block">
                      <span className="label">确认新密码</span>
                      <div className="relative">
                        <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                        <input
                          className="input !pl-9"
                          type={forgotShowPwd ? 'text' : 'password'}
                          value={forgotConfirm}
                          onChange={(e) => setForgotConfirm(e.target.value)}
                          placeholder="再输入一次新密码"
                          maxLength={64}
                          autoComplete="new-password"
                          data-testid="auth-recover-confirm"
                        />
                      </div>
                    </label>
                    {forgotError && (
                      <p className="shake rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]" role="alert" data-testid="auth-forgot-error">
                        {forgotError}
                      </p>
                    )}
                    <button type="submit" className="btn btn-primary w-full !py-3" disabled={forgotBusy} data-testid="auth-recover-submit">
                      {forgotBusy ? '重置中…' : '重置密码'}
                      {!forgotBusy && <ArrowRight size={15} />}
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <>
                <div className="mt-3">
                  {mode === 'register' && (
                    <button type="button" className="ledger-back" onClick={() => navigate('/login')} data-testid="auth-go-login">
                      <ArrowLeft size={14} /> 返回登录
                    </button>
                  )}
                  <p className="mt-1 text-[12px] leading-relaxed text-[#6B6A63]">
                    {mode === 'login' ? '登录你的私人账本；支持用户名或已绑定的手机号。' : '账户资料由云端账户服务托管，用于安全登录；账本流水仍只保存在这台浏览器。'}
                  </p>
                  {mode === 'register' && (
                    <ul className="ledger-note mt-2.5">
                      <li><CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" /> 密码与找回答案加盐哈希，保存在云端账户服务</li>
                      <li><CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" /> 每个用户独立账本，账本流水不上传服务器</li>
                      <li><CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" /> 设置找回问题后，忘记密码可自助重置</li>
                    </ul>
                  )}
                </div>

                {mode === 'login' && registeredName && (
                  <p className="fade-in mt-3 flex items-start gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--accent-ink)]" data-testid="auth-registered-note">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    注册成功！账户「{registeredName}」已创建，请使用用户名或手机号登录。
                  </p>
                )}

                <form className="mt-4 space-y-3.5" onSubmit={(e) => void submit(e)}>
                  <label className="block">
                    <span className="label">{mode === 'login' ? '用户名或手机号' : '用户名'}</span>
                    <div className="relative">
                      <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                      <input
                        className="input !pl-9"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={mode === 'login' ? '用户名，或已绑定的手机号' : '2–20 个字符，如：xiaoming'}
                        maxLength={20}
                        autoComplete="username"
                        data-testid="auth-username"
                      />
                    </div>
                  </label>
                  {mode === 'register' && (
                    <label className="block fade-in">
                      <span className="label">手机号（可选）</span>
                      <div className="relative">
                        <Smartphone size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                        <input
                          className="input !pl-9"
                          inputMode="tel"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder="11 位手机号，绑定后可用于登录"
                          maxLength={11}
                          autoComplete="tel"
                          data-testid="auth-phone"
                        />
                      </div>
                    </label>
                  )}
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
                  {mode === 'register' && (
                    <div className="fade-in rounded-lg border border-[#E6DFD2] bg-[#FCFBF7] p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#6B6A63]">
                        <ShieldCheck size={13} className="text-[var(--accent)]" /> 密码找回（必填）
                      </p>
                      <div className="space-y-2">
                        <select
                          className="select"
                          value={recoveryQuestion}
                          onChange={(e) => setRecoveryQuestion(e.target.value)}
                          data-testid="auth-recovery-question"
                        >
                          <option value="">选择找回问题</option>
                          {RECOVERY_QUESTIONS.map((q) => (
                            <option key={q} value={q}>{q}</option>
                          ))}
                          <option value={CUSTOM_RECOVERY_QUESTION}>自定义问题…</option>
                        </select>
                        {recoveryQuestion === CUSTOM_RECOVERY_QUESTION && (
                          <input
                            className="input fade-in"
                            value={customRecoveryQuestion}
                            onChange={(e) => setCustomRecoveryQuestion(e.target.value)}
                            placeholder="输入你自己的问题（2–40 个字符）"
                            maxLength={RECOVERY_QUESTION_MAX_CHARS}
                            autoComplete="off"
                            data-testid="auth-recovery-custom"
                          />
                        )}
                        <input
                          className="input"
                          value={recoveryAnswer}
                          onChange={(e) => setRecoveryAnswer(e.target.value)}
                          placeholder="答案（2–40 个字符，忘记密码时用）"
                          maxLength={40}
                          autoComplete="off"
                          data-testid="auth-recovery-answer"
                        />
                      </div>
                      <p className="mt-2 text-[10px] leading-relaxed text-[#8A887F]">问题与答案加盐哈希后保存在账户服务；手机号可留空，登录后也能在设置中补充。</p>
                    </div>
                  )}

                  {mode === 'login' && (
                    <div className="-mt-1.5 flex justify-end">
                      <button
                        type="button"
                        className="text-[11px] font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline"
                        onClick={openForgot}
                        data-testid="auth-forgot"
                      >
                        忘记用户名或密码？
                      </button>
                    </div>
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
              </>
            )}

            <div className="mt-4 flex items-start gap-2 border-t border-dashed border-[#E0D8C8] pt-3 text-[10.5px] leading-relaxed text-[#6B6A63]">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <span>
                {forgot
                  ? '找回答案只以加盐哈希保存在账户服务；重置只影响该账户密码，不会改动本机账本。'
                  : '登录状态由安全 Cookie 维护；账本流水不上传，换设备或清理浏览器前，请先在「数据中心」导出备份。'}
              </span>
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