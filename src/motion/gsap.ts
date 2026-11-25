import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, useGSAP);
gsap.defaults({ duration: 0.5, ease: 'power2.out' });

/** 页面内容参与滚动显现的选择器；data-reveal="none" 用于交给自定义时间线接管。 */
export const REVEAL_SELECTOR = '[data-reveal]:not([data-reveal="none"]), .card, .stat-in, .rise';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { gsap, ScrollTrigger, useGSAP };