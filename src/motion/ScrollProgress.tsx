import { useRef } from 'react';
import { gsap, useGSAP } from './gsap';

export function ScrollProgress() {
  const hostRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const bar = hostRef.current?.firstElementChild;
    if (!(bar instanceof HTMLElement)) return;
    gsap.to(bar, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.3, invalidateOnRefresh: true },
    });
  }, { scope: hostRef });
  return (
    <div ref={hostRef} className="scroll-progress" aria-hidden="true"><span /></div>
  );
}