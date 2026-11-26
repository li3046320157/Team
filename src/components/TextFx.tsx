import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { formatMoney } from '../domain/money';
import { gsap, isReducedMotion, useGSAP } from '../motion/gsap';

function merge(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const GLYPHS = '¥$0123456789#%&*账本收支余额分角元';

function glyphFor(index: number, frame: number): string {
  const seed = Math.abs(Math.imul(index + 1, 2654435761) + Math.imul(frame + 1, 40503));
  return GLYPHS[seed % GLYPHS.length];
}

/** 文字解码：逐字从乱码定格为正文，布局由隐形原文撑住，不抖动。 */
export function ScrambleText({
  text,
  className,
  delay = 0,
  duration = 0.9,
}: {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
}) {
  const [progress, setProgress] = useState(() => (isReducedMotion() ? 1 : 0));

  useEffect(() => {
    if (isReducedMotion()) {
      setProgress(1);
      return;
    }
    let raf = 0;
    let start = 0;
    setProgress(0);
    const step = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start - delay * 1000;
      const next = elapsed <= 0 ? 0 : Math.min(1, elapsed / (duration * 1000));
      setProgress(next);
      if (next < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, duration]);

  const chars = [...text];
  const revealed = Math.min(chars.length, Math.floor(progress * chars.length + 0.0001));
  const frame = Math.floor(progress * 24);

  return (
    <span className={merge('text-scramble', className)} aria-label={text}>
      {chars.map((char, index) => (
        <span key={`${index}-${char}`} className="ts-char" aria-hidden="true">
          <span className="ts-ghost">{char === ' ' ? '\u00a0' : char}</span>
          <span className={merge('ts-live', index < revealed && 'is-done')}>
            {index < revealed ? (char === ' ' ? '\u00a0' : char) : glyphFor(index, frame)}
          </span>
        </span>
      ))}
    </span>
  );
}

/** 打字机：逐字打出正文，带闪烁光标；delay 单位为秒。 */
export function TypewriterText({
  text,
  className,
  speed = 52,
  delay = 0,
  caret = true,
}: {
  text: string;
  className?: string;
  speed?: number;
  delay?: number;
  caret?: boolean;
}) {
  const [count, setCount] = useState(() => (isReducedMotion() ? [...text].length : 0));

  useEffect(() => {
    if (isReducedMotion()) {
      setCount([...text].length);
      return;
    }
    const chars = [...text];
    setCount(0);
    let index = 0;
    let timer = 0;
    const tick = () => {
      index += 1;
      setCount(index);
      if (index < chars.length) timer = window.setTimeout(tick, speed);
    };
    const kickoff = window.setTimeout(tick, delay * 1000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearTimeout(timer);
    };
  }, [text, speed, delay]);

  const chars = [...text];
  return (
    <span className={merge('text-type', className)} aria-label={text}>
      <span aria-hidden="true">{chars.slice(0, count).join('')}</span>
      {caret && count < chars.length && <span className="typing-caret" aria-hidden="true" />}
    </span>
  );
}

/** 卡片数字递增：进入视口后从 0 滚到目标值；数值变化时从当前显示值继续滚动。 */
export function CountUpMoney({
  cents,
  delay = 0,
  duration = 1.15,
  className,
}: {
  cents: number;
  delay?: number;
  duration?: number;
  className?: string;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const shownRef = useRef(0);

  useGSAP(() => {
    const el = spanRef.current;
    if (!el) return;
    if (isReducedMotion()) {
      shownRef.current = cents;
      el.textContent = formatMoney(cents);
      return;
    }
    const from = shownRef.current;
    if (from === cents && el.textContent && el.dataset.counted === '1') return;
    el.dataset.counted = '1';
    const state = { value: from };
    el.textContent = formatMoney(from);
    const scroller = el.closest('[data-book-scroll]');
    const tween = gsap.to(state, {
      value: cents,
      duration: from === 0 ? duration : Math.min(duration, 0.85),
      delay: from === 0 ? delay : 0,
      ease: 'power2.out',
      onUpdate: () => {
        shownRef.current = Math.round(state.value);
        el.textContent = formatMoney(shownRef.current);
      },
      scrollTrigger: {
        trigger: el,
        start: 'top 96%',
        once: true,
        ...(scroller ? { scroller } : {}),
      },
    });
    return () => tween.kill();
  }, { dependencies: [cents], scope: spanRef, revertOnUpdate: true });

  return (
    <span
      ref={spanRef}
      className={merge('num count-up', cents < 0 && 'is-negative', className)}
      data-testid="count-up-money"
    >
      {formatMoney(isReducedMotion() ? cents : 0)}
    </span>
  );
}

/** 跑马灯：内容复制两组并在轨道上无限左移，悬停暂停。 */
export function Marquee({
  items,
  className,
  speed = 32,
  label = '账本摘要',
}: {
  items: string[];
  className?: string;
  speed?: number;
  label?: string;
}) {
  const renderGroup = (hidden: boolean) => (
    <div className="marquee-group" aria-hidden={hidden || undefined}>
      {items.map((item, index) => (
        <span key={`${index}-${item}`} className="marquee-item">{item}</span>
      ))}
    </div>
  );
  return (
    <div className={merge('marquee', className)} aria-label={label} role="marquee">
      <div className="marquee-track" style={{ '--marquee-duration': `${speed}s` } as CSSProperties}>
        {renderGroup(false)}
        {renderGroup(true)}
      </div>
    </div>
  );
}

/** 滚动叙事：一条主线随滚动点亮，四个步骤依次被照亮。 */
export function ScrollStory({
  kicker,
  title,
  steps,
  className,
}: {
  kicker?: string;
  title: string;
  steps: { label: string; text: string }[];
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    const line = lineRef.current;
    const stepEls = Array.from(root.querySelectorAll<HTMLElement>('.scroll-story-step'));
    if (isReducedMotion()) {
      if (line) line.style.transform = 'scaleX(1)';
      stepEls.forEach((el) => el.classList.add('is-lit'));
      return;
    }
    const scroller = root.closest('[data-book-scroll]');
    gsap.fromTo(line, { scaleX: 0 }, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: root,
        start: 'top 88%',
        end: 'bottom 48%',
        scrub: 0.5,
        ...(scroller ? { scroller } : {}),
        onUpdate: (self) => {
          const lit = Math.min(stepEls.length, Math.ceil(self.progress * stepEls.length + 0.08));
          stepEls.forEach((el, index) => el.classList.toggle('is-lit', index < lit));
        },
      },
    });
  }, { scope: rootRef });

  return (
    <section ref={rootRef} className={merge('card scroll-story', className)} data-reveal="none" data-testid="scroll-story">
      <div className="scroll-story-head">
        {kicker && <p className="scroll-story-kicker">{kicker}</p>}
        <h2 className="scroll-story-title">{title}</h2>
      </div>
      <div className="scroll-story-steps">
        <div className="scroll-story-rail" aria-hidden="true"><span ref={lineRef} /></div>
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="scroll-story-step"
            style={{ '--story-i': index } as CSSProperties}
          >
            <span className="scroll-story-dot" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <p className="scroll-story-label">{step.label}</p>
            <p className="scroll-story-text">{step.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}