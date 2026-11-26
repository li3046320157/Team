import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { LineChart, ShieldCheck, Target } from 'lucide-react';
import { gsap, isReducedMotion, useGSAP } from '../motion/gsap';

const FEATURES = [
  { icon: ShieldCheck, title: '本地优先', text: '数据只存这台设备' },
  { icon: LineChart, title: '现金流全貌', text: '日 · 月 · 年一眼看清' },
  { icon: Target, title: '提前推演', text: '预测 · 沙盘 · 目标预留' },
];

function makeDust() {
  let seed = 20261126;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: 26 }, (_, index) => ({
    left: Math.round(rand() * 1000) / 10,
    top: Math.round(12 + rand() * 82),
    size: Math.round((1.6 + rand() * 3.2) * 10) / 10,
    delay: Math.round(rand() * 70) / 10,
    duration: Math.round((6 + rand() * 7) * 10) / 10,
    drift: Math.round((rand() - 0.5) * 120),
    index,
  }));
}

const DUST = makeDust();

/**
 * 认证页进入片头：用翻开账本的画面做暗场底片，叠加系统说明与欢迎字样，
 * 结束或跳过后进入登录 / 注册界面。
 */
export function AuthIntro({ onDone }: { onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const closingRef = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const finish = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const root = rootRef.current;
    if (!root || isReducedMotion()) {
      doneRef.current();
      return;
    }
    timelineRef.current?.kill();
    gsap
      .timeline({ onComplete: () => doneRef.current() })
      .to(root.querySelector('.auth-intro-flash'), { opacity: 0.92, duration: 0.1, ease: 'power1.in' }, 0)
      .to(root, { opacity: 0, scale: 1.045, filter: 'blur(9px)', duration: 0.62, ease: 'power2.inOut' }, 0.06)
      .to(root.querySelector('.auth-intro-stage'), { opacity: 0, scale: 0.95, y: -10, duration: 0.42, ease: 'power2.in' }, 0);
  }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    const auto = window.setTimeout(finish, 4600);
    const failsafe = window.setTimeout(finish, 9000);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(auto);
      window.clearTimeout(failsafe);
      timelineRef.current?.kill();
    };
  }, [finish]);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root || isReducedMotion()) return;
    const q = gsap.utils.selector(root);
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    timelineRef.current = tl;

    tl.fromTo(q('.auth-intro-video'), { opacity: 0, scale: 1.12 }, { opacity: 0.52, scale: 1.02, duration: 2.8, ease: 'power2.out' }, 0)
      .fromTo(q('.auth-intro-emblem-wrap'), { opacity: 0, scale: 0.55, y: 22 }, { opacity: 1, scale: 1, y: 0, duration: 0.85, ease: 'back.out(1.7)' }, 0.12)
      .fromTo(q('.auth-intro-ring'), { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.9, stagger: 0.12 }, 0.32)
      .fromTo(q('.auth-intro-kicker'), { opacity: 0, letterSpacing: '0.6em' }, { opacity: 0.8, letterSpacing: '0.3em', duration: 0.8 }, 0.5)
      .fromTo(q('.auth-intro-title-line > span'), { yPercent: 118 }, { yPercent: 0, duration: 0.95, stagger: 0.12, ease: 'power4.out' }, 0.62)
      .fromTo(q('.auth-intro-sub'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.7 }, 1.02)
      .fromTo(q('.auth-intro-feats li'), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.15 }, 1.28)
      .fromTo(q('.auth-intro-progress'), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.34)
      .fromTo(q('.auth-intro-progress i'), { scaleX: 0 }, { scaleX: 1, duration: 2.2, ease: 'power1.inOut' }, 1.4)
      .fromTo(q('.auth-intro-foot'), { opacity: 0 }, { opacity: 0.72, duration: 0.6 }, 1.8)
      .fromTo(q('.auth-intro-skip'), { opacity: 0 }, { opacity: 1, duration: 0.45 }, 1.9);
  }, { scope: rootRef });

  return (
    <div className="auth-intro" ref={rootRef} data-testid="auth-intro" role="dialog" aria-modal="true" aria-label="进入本地账本系统">
      <video
        className="auth-intro-video"
        src="/media/ledger-intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        onError={(event) => { event.currentTarget.style.display = 'none'; }}
      />
      <span className="auth-intro-veil" aria-hidden="true" />
      <span className="auth-intro-rays" aria-hidden="true" />
      <span className="auth-intro-grid" aria-hidden="true" />
      <span className="auth-intro-scan" aria-hidden="true" />
      <span className="auth-intro-dust" aria-hidden="true">
        {DUST.map((p) => (
          <i
            key={p.index}
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              '--s': `${p.size}px`,
              '--delay': `${p.delay}s`,
              '--duration': `${p.duration}s`,
              '--drift': `${p.drift}px`,
            } as CSSProperties}
          />
        ))}
      </span>

      <div className="auth-intro-stage">
        <div className="auth-intro-emblem-wrap">
          <span className="auth-intro-ring is-a" aria-hidden="true" />
          <span className="auth-intro-ring is-b" aria-hidden="true" />
          <span className="auth-intro-orbit" aria-hidden="true"><i /></span>
          <span className="auth-intro-emblem" aria-hidden="true">¥</span>
        </div>

        <p className="auth-intro-kicker">
          <span aria-hidden="true" />
          LOCAL LEDGER · 本地账本系统
          <span aria-hidden="true" />
        </p>

        <h2 className="auth-intro-title">
          <span className="auth-intro-title-line"><span>欢迎进入</span></span>
          <span className="auth-intro-title-line"><span className="is-gold">你的本地账本</span></span>
        </h2>

        <p className="auth-intro-sub">收支、预算、预测与目标，都写进同一本只属于你的账。</p>

        <ul className="auth-intro-feats">
          {FEATURES.map((item) => (
            <li key={item.title}>
              <item.icon size={15} aria-hidden="true" />
              <b>{item.title}</b>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>

        <div className="auth-intro-progress" aria-hidden="true"><i /></div>
        <p className="auth-intro-foot">正在打开本地账本 · 所有数据只在这台设备</p>
      </div>

      <button type="button" className="auth-intro-skip" onClick={finish} data-testid="auth-intro-skip">
        跳过片头
      </button>
      <span className="auth-intro-flash" aria-hidden="true" />
    </div>
  );
}