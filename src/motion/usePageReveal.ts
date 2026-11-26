import { type RefObject } from 'react';
import { gsap, isReducedMotion, REVEAL_SELECTOR, ScrollTrigger, useGSAP } from './gsap';

const VIEW_EDGE = 0.92;

function collectRevealTargets(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
  return candidates.filter((el) => {
    if (el.closest('.modal-scrim')) return false;
    let ancestor = el.parentElement;
    while (ancestor && ancestor !== root) {
      if (ancestor.matches(REVEAL_SELECTOR)) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

/**
 * 页面动效：路由切换淡入 + 视口外内容进入视口时渐变显现。
 * 只隐藏首屏之外的目标，已可见内容不闪烁；滚动显现只播放一次。
 * 传入 scrollRef 时以书页内部滚动容器为准，否则使用窗口滚动。
 */
export function usePageReveal(
  scopeRef: RefObject<HTMLDivElement | null>,
  pageKey: string,
  scrollRef?: RefObject<HTMLDivElement | null>,
) {
  useGSAP(() => {
    const root = scopeRef.current;
    if (!root) return;
    const scroller = scrollRef?.current ?? null;
    const reduce = isReducedMotion();
    const batches: ScrollTrigger[] = [];

    // 先复位滚动，再按首屏位置决定哪些内容需要滚动显现
    if (scroller) scroller.scrollTop = 0;
    else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    gsap.fromTo(
      root,
      { opacity: 0, y: reduce ? 0 : 10 },
      {
        opacity: 1,
        y: 0,
        duration: reduce ? 0.3 : 0.45,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
      },
    );

    const enterLine = scroller
      ? scroller.getBoundingClientRect().bottom * VIEW_EDGE
      : window.innerHeight * VIEW_EDGE;
    const pending: HTMLElement[] = [];
    for (const el of collectRevealTargets(root)) {
      if (el.getBoundingClientRect().top < enterLine) continue;
      gsap.set(el, { opacity: 0, y: reduce ? 0 : 22 });
      // 入场期间关闭自身 CSS 过渡，避免逐帧 transform 被过渡拖慢
      el.style.transition = 'none';
      pending.push(el);
    }

    if (pending.length > 0) {
      batches.push(
        ...ScrollTrigger.batch(pending, {
          start: 'top 90%',
          once: true,
          ...(scroller ? { scroller } : {}),
          onEnter: (batch) => {
            const elements = batch as HTMLElement[];
            gsap.to(elements, {
              opacity: 1,
              y: 0,
              duration: reduce ? 0.32 : 0.55,
              ease: 'power2.out',
              stagger: reduce ? 0.04 : 0.08,
              overwrite: true,
              clearProps: 'transform,opacity',
              onComplete: () => elements.forEach((el) => { el.style.transition = ''; }),
            });
          },
        }),
      );
    }

    const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 520);

    return () => {
      window.clearTimeout(refreshTimer);
      batches.forEach((trigger) => trigger.kill());
    };
  }, { scope: scopeRef, dependencies: [pageKey], revertOnUpdate: true });
}