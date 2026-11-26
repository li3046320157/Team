import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bot,
  Calendar,
  CircleDollarSign,
  Database,
  FlaskConical,
  LineChart,
  List,
  Settings,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { gsap, isReducedMotion, useGSAP } from '../motion/gsap';

interface MascotProfile {
  hue: string;
  label: string;
  icon: LucideIcon;
  quotes: string[];
}

const MASCOTS: Record<string, MascotProfile> = {
  '/': {
    hue: 'var(--tone-blue)',
    label: '总览小管家',
    icon: CircleDollarSign,
    quotes: [
      '先看净结余，再看结构：日 / 月 / 年都可以切换。',
      '记账越连续，预测越可信。今天也记一笔吧。',
      '安全储备只参与风险判断，不参与余额计算。',
    ],
  },
  '/ledger': {
    hue: 'var(--tone-teal)',
    label: '流水小账房',
    icon: List,
    quotes: [
      '一句「昨天咖啡 18.5」就能记一笔，确认后才写入。',
      '金额、分类、日期都可以点开再改。',
      '整数分计算，不会出现浮点误差。',
    ],
  },
  '/schedules': {
    hue: 'var(--tone-amber)',
    label: '计划小日历',
    icon: Calendar,
    quotes: [
      '固定支出先排进计划，现金流就更稳。',
      '到期计划点「核销」，会自动生成流水。',
      '计划不会自动扣钱，确认后才入账。',
    ],
  },
  '/insights': {
    hue: 'var(--tone-violet)',
    label: '洞察小侦探',
    icon: Sparkles,
    quotes: [
      '异常检测只看该笔之前的历史，不会泄漏未来。',
      '高频小钱会被聚合，别被「每笔都不贵」骗了。',
      '先看结构，再谈省钱。',
    ],
  },
  '/forecast': {
    hue: 'var(--tone-cyan)',
    label: '预测小领航',
    icon: LineChart,
    quotes: [
      '预测是规划参考，不是收益承诺。',
      '切换 30 / 90 / 365 天，看不同尺度。',
      '预算与覆盖区间会影响预测，记得在设置里维护。',
    ],
  },
  '/sandbox': {
    hue: 'var(--tone-orange)',
    label: '沙盘小实验员',
    icon: FlaskConical,
    quotes: [
      '四种方案并排比较，再决定这笔钱怎么花。',
      '方案可以保存，稍后再回来对比。',
      '沙盘推演不改动真实账本。',
    ],
  },
  '/goals': {
    hue: 'var(--tone-green)',
    label: '目标小教练',
    icon: Target,
    quotes: [
      '先预留，再消费；目标进度自动更新。',
      '分配日可以在设置里调整。',
      '目标金额来自自由余额，不会影响日常流水。',
    ],
  },
  '/data': {
    hue: 'var(--tone-slate)',
    label: '数据小保管',
    icon: Database,
    quotes: [
      '定期导出一份 JSON 备份，文件由你保管。',
      '导入前会先校验，损坏文件会被拒绝。',
      '数据只在本机 IndexedDB，不会上传。',
    ],
  },
  '/settings': {
    hue: 'var(--tone-stone)',
    label: '设置小助手',
    icon: Settings,
    quotes: [
      '名字改完会自动刷新，账本数据不受影响。',
      '密码改完会退出，请用新密码重新登录。',
      '动效偏好只影响这台浏览器。',
    ],
  },
};

const ROBOT_QUOTES = [
  '你好，我是账本小助手。点我换一句提示，也可以直接向我提问。',
  '试试问：本月哪些支出可以省下来？',
  '我会结合余额、本月收支、预测和目标给出建议。',
  '接口地址需要支持跨域，密钥只保存在本机。',
  '点左侧快捷问题，能更快开始分析。',
];

const FALLBACK = MASCOTS['/'];

export function SectionMascot() {
  const { pathname } = useLocation();
  const isRobot = pathname === '/assistant';
  const mascot = MASCOTS[pathname] ?? FALLBACK;
  const quotes = isRobot ? ROBOT_QUOTES : mascot.quotes;
  const Icon = mascot.icon;

  const dockRef = useRef<HTMLDivElement>(null);
  const hopRef = useRef<HTMLSpanElement>(null);
  const bobRef = useRef<HTMLSpanElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const armRef = useRef<SVGGElement>(null);
  const animateRef = useRef<() => void>(() => {});
  const bubbleTimer = useRef<number | null>(null);
  const greetTimer = useRef<number | null>(null);
  const quoteRef = useRef(0);
  const [bubble, setBubble] = useState<string | null>(null);

  const clearBubbleTimer = () => {
    if (bubbleTimer.current !== null) {
      window.clearTimeout(bubbleTimer.current);
      bubbleTimer.current = null;
    }
  };

  const showQuote = (index: number, delay: number) => {
    setBubble(quotes[index] ?? null);
    clearBubbleTimer();
    bubbleTimer.current = window.setTimeout(() => {
      setBubble(null);
      bubbleTimer.current = null;
    }, delay);
  };

  useEffect(() => {
    setBubble(null);
    quoteRef.current = 0;
    clearBubbleTimer();
    if (greetTimer.current !== null) {
      window.clearTimeout(greetTimer.current);
      greetTimer.current = null;
    }
    if (!isRobot) return;
    greetTimer.current = window.setTimeout(() => {
      greetTimer.current = null;
      setBubble(ROBOT_QUOTES[0]);
      clearBubbleTimer();
      bubbleTimer.current = window.setTimeout(() => {
        setBubble(null);
        bubbleTimer.current = null;
      }, 7000);
    }, 900);
    return () => {
      if (greetTimer.current !== null) {
        window.clearTimeout(greetTimer.current);
        greetTimer.current = null;
      }
      clearBubbleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isRobot]);

  useEffect(() => () => clearBubbleTimer(), []);

  useGSAP((_context, contextSafe) => {
    const dock = dockRef.current;
    if (!dock) return;
    const reduce = isReducedMotion();

    gsap.fromTo(
      dock,
      { opacity: 0, y: reduce ? 0 : 26, scale: reduce ? 1 : 0.88 },
      { opacity: 1, y: 0, scale: 1, duration: reduce ? 0.25 : 0.55, ease: 'back.out(1.5)', clearProps: 'transform,opacity' },
    );

    if (!reduce) {
      if (bobRef.current) {
        gsap.to(bobRef.current, { y: -7, duration: 2.1, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      }
      if (headRef.current) {
        gsap.to(headRef.current, { rotation: 2.4, transformOrigin: '50% 82%', duration: 3.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      }
      if (armRef.current) {
        gsap.to(armRef.current, { rotation: isRobot ? -4 : 6, transformOrigin: '88% 8%', duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      }
      if (eyesRef.current) {
        gsap.timeline({ repeat: -1, repeatDelay: 3.2, delay: 1.4 })
          .to(eyesRef.current, { scaleY: 0.12, transformOrigin: '50% 52%', duration: 0.07, ease: 'power1.in' })
          .to(eyesRef.current, { scaleY: 1, duration: 0.1, ease: 'power1.out' });
      }
    }

    animateRef.current = contextSafe?.(() => {
      if (isReducedMotion()) return;
      if (hopRef.current) {
        gsap.timeline()
          .to(hopRef.current, { y: -16, duration: 0.16, ease: 'power2.out' })
          .to(hopRef.current, { y: 0, duration: 0.5, ease: 'bounce.out' });
      }
      if (armRef.current) {
        gsap.fromTo(
          armRef.current,
          { rotation: 0 },
          {
            rotation: 24,
            duration: 0.14,
            yoyo: true,
            repeat: 5,
            ease: 'sine.inOut',
            transformOrigin: '88% 8%',
            overwrite: 'auto',
            onComplete: () => {
              if (armRef.current) gsap.set(armRef.current, { rotation: 0 });
            },
          },
        );
      }
      if (eyesRef.current) {
        gsap.fromTo(
          eyesRef.current,
          { scaleY: 1 },
          { scaleY: 0.15, duration: 0.08, yoyo: true, repeat: 1, transformOrigin: '50% 52%', overwrite: 'auto' },
        );
      }
    }) ?? (() => {});

    if (isRobot && eyesRef.current) {
      const eye = eyesRef.current;
      const eyeX = gsap.quickTo(eye, 'x', { duration: 0.32, ease: 'power2.out' });
      const eyeY = gsap.quickTo(eye, 'y', { duration: 0.32, ease: 'power2.out' });
      const onMove = (event: PointerEvent) => {
        const rect = dock.getBoundingClientRect();
        const dx = gsap.utils.clamp(-3.2, 3.2, (event.clientX - (rect.left + rect.width / 2)) / 45);
        const dy = gsap.utils.clamp(-2.2, 2.2, (event.clientY - (rect.top + rect.height / 2)) / 60);
        eyeX(dx);
        eyeY(dy);
      };
      window.addEventListener('pointermove', onMove);
      return () => window.removeEventListener('pointermove', onMove);
    }
  }, { scope: dockRef, dependencies: [pathname], revertOnUpdate: true });

  const activate = () => {
    if (greetTimer.current !== null) {
      window.clearTimeout(greetTimer.current);
      greetTimer.current = null;
    }
    quoteRef.current = (quoteRef.current + 1) % quotes.length;
    showQuote(quoteRef.current, 5200);
    animateRef.current?.();
  };

  return (
    <div
      ref={dockRef}
      className={`mascot-dock${isRobot ? ' is-robot' : ''}`}
      style={{ '--mascot-hue': mascot.hue } as CSSProperties}
      data-testid="section-mascot"
    >
      {bubble && (
        <div
          key={bubble}
          className={`mascot-bubble${isRobot ? ' is-robot' : ''}`}
          aria-live="polite"
          data-testid={isRobot ? 'ai-robot-bubble' : 'mascot-bubble'}
        >
          {bubble}
        </div>
      )}

      <button
        type="button"
        className="mascot-figure"
        onClick={activate}
        aria-label={`${mascot.label}，点击互动`}
        title={mascot.label}
        data-testid={isRobot ? 'ai-robot' : undefined}
      >
        <span className="mascot-halo" aria-hidden="true" />
        <span className="mascot-hop" ref={hopRef}>
          <span className="mascot-bob" ref={bobRef}>
            <svg className="mascot-svg" viewBox="0 0 120 132" aria-hidden="true">
              <ellipse className="mascot-shadow" cx="60" cy="123" rx="27" ry="5" />
              {isRobot ? (
                <>
                  <ellipse className="robot-glow" cx="60" cy="119" rx="23" ry="6" />
                  <g ref={armRef} className="robot-arm">
                    <rect x="88" y="72" width="8" height="23" rx="4" fill="#C9D1CE" />
                    <circle cx="92" cy="97" r="5" fill="#E8ECEB" stroke="#B9C2BF" strokeWidth="1.4" />
                  </g>
                  <rect x="24" y="74" width="8" height="22" rx="4" fill="#C9D1CE" />
                  <circle cx="28" cy="97" r="5" fill="#E8ECEB" stroke="#B9C2BF" strokeWidth="1.4" />
                  <rect x="40" y="80" width="40" height="30" rx="12" fill="#E9EDEB" stroke="#C4CCC9" strokeWidth="1.4" />
                  <circle className="robot-light" cx="51" cy="95" r="2.4" />
                  <circle className="robot-light is-late" cx="60" cy="95" r="2.4" />
                  <circle className="robot-light is-later" cx="69" cy="95" r="2.4" />
                  <rect x="52" y="102" width="16" height="4" rx="2" fill="#BFC8C4" />
                  <rect x="21" y="46" width="6" height="15" rx="3" fill="#C9D1CE" />
                  <rect x="93" y="46" width="6" height="15" rx="3" fill="#C9D1CE" />
                  <line x1="60" y1="30" x2="60" y2="18" stroke="#B9C2BF" strokeWidth="2.4" strokeLinecap="round" />
                  <circle className="robot-antenna" cx="60" cy="14" r="4.2" />
                  <g ref={headRef} className="robot-head">
                    <rect x="27" y="28" width="66" height="52" rx="18" fill="#F5F2EA" stroke="#CFC9BC" strokeWidth="1.6" />
                    <rect x="33" y="34" width="54" height="33" rx="12" fill="#26312F" />
                    <rect x="37" y="37" width="20" height="7" rx="3.5" fill="#9FE8D8" opacity="0.16" />
                    <g ref={eyesRef} className="robot-eyes">
                      <circle cx="50" cy="50" r="6" fill="#9FE8D8" opacity="0.16" />
                      <circle cx="70" cy="50" r="6" fill="#9FE8D8" opacity="0.16" />
                      <circle className="robot-pupil" cx="50" cy="50" r="2.7" />
                      <circle className="robot-pupil" cx="70" cy="50" r="2.7" />
                    </g>
                    <rect x="53" y="60" width="4" height="2.4" rx="1.2" fill="#9FE8D8" opacity="0.8" />
                    <rect x="58" y="60" width="4" height="2.4" rx="1.2" fill="#9FE8D8" opacity="0.55" />
                    <rect x="63" y="60" width="4" height="2.4" rx="1.2" fill="#9FE8D8" opacity="0.8" />
                  </g>
                  <circle className="robot-chip-dot" cx="46" cy="74" r="2" />
                  <circle className="robot-chip-dot is-late" cx="54" cy="74" r="2" />
                  <circle className="robot-chip-dot is-later" cx="62" cy="74" r="2" />
                  <circle className="robot-chip-dot is-later" cx="70" cy="74" r="2" />
                </>
              ) : (
                <>
                  <rect x="47" y="101" width="9" height="16" rx="4" fill="#4A4E46" />
                  <rect x="65" y="101" width="9" height="16" rx="4" fill="#4A4E46" />
                  <ellipse cx="51" cy="118" rx="8" ry="4" fill="#3A3D37" />
                  <ellipse cx="70" cy="118" rx="8" ry="4" fill="#3A3D37" />
                  <rect x="24" y="70" width="9" height="26" rx="4.5" className="pal-arm" />
                  <circle cx="28.5" cy="96" r="5.5" fill="#F6DFC4" />
                  <g ref={armRef} className="pal-arm-wave">
                    <rect x="88" y="68" width="9" height="28" rx="4.5" className="pal-arm" />
                    <circle cx="92.5" cy="96" r="5.5" fill="#F6DFC4" />
                  </g>
                  <rect x="34" y="64" width="52" height="42" rx="16" className="pal-body" />
                  <ellipse cx="60" cy="88" rx="15" ry="13" className="pal-belly" />
                  <g ref={headRef} className="pal-head">
                    <circle cx="60" cy="44" r="25" fill="#F6DFC4" />
                    <path d="M35 40c0-16 11-24 25-24s25 8 25 24c-6-7-14-10-25-10s-19 3-25 10Z" fill="#3A3D37" />
                    <path d="M37 36c4-8 12-12 23-12s19 4 23 12" fill="none" className="pal-band" strokeWidth="5" strokeLinecap="round" />
                    <g ref={eyesRef} className="pal-eyes">
                      <circle cx="51" cy="46" r="2.8" fill="#2E332D" />
                      <circle cx="69" cy="46" r="2.8" fill="#2E332D" />
                    </g>
                    <circle cx="43" cy="52" r="3.4" fill="#F2B8A2" opacity="0.55" />
                    <circle cx="77" cy="52" r="3.4" fill="#F2B8A2" opacity="0.55" />
                    <path d="M53 54q7 5 14 0" fill="none" stroke="#2E332D" strokeWidth="2" strokeLinecap="round" />
                  </g>
                </>
              )}
            </svg>
          </span>
        </span>
        {!isRobot && (
          <span className="mascot-prop" aria-hidden="true"><Icon size={15} /></span>
        )}
        {isRobot && <span className="robot-chip" aria-hidden="true">AI</span>}
      </button>
    </div>
  );
}