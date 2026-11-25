import { useRef } from 'react';
import { gsap, useGSAP } from './gsap';

/** 阅读进度线：随页面滚动按比例伸展，滚动驱动的纯变换动画，不触发布局。 */
export function ScrollProgress() {
  const hostRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const bar = hostRef.current?.firstElementChild;
    if (!(bar instanceof HTMLElement)) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(bar, {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { start: 0, end: 'max', scrub: 0.3, invalidateOnRefresh: true },
      });
    });
    return () => mm.revert();
  }, { scope: hostRef });

  return (
    <div ref={hostRef} className="scroll-progress" aria-hidden="true">
      <span />
    </div>
  );
}