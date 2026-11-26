import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, type Location } from 'react-router-dom';
import {
  BookOpen,
  Bot,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Database,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  List,
  Plus,
  Settings,
  Sparkles,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { gsap, isReducedMotion, useGSAP } from '../motion/gsap';
import { usePageReveal } from '../motion/usePageReveal';
import { AccountMenu } from './AccountMenu';
import { PageAtmosphere } from './PageAtmosphere';
import { SectionMascot } from './SectionMascot';
import { LedgerIntro } from './LedgerIntro';
import { todayISO } from '../domain/days';
import { collectReminders } from '../domain/reminders';
import { loadReminderPrefs, notifyIfDue, saveReminderPrefs } from '../services/reminders';
import { cn } from './ui';
import { DashboardPage } from '../pages/Dashboard';
import { LedgerPage } from '../pages/Ledger';
import { SchedulesPage } from '../pages/Schedules';
import { InsightsPage } from '../pages/Insights';
import { ForecastPage } from '../pages/Forecast';
import { SandboxPage } from '../pages/Sandbox';
import { GoalsPage } from '../pages/Goals';
import { DataCenterPage } from '../pages/DataCenter';
import { SettingsPage } from '../pages/Settings';
import { AssistantPage } from '../pages/Assistant';

interface BookPage {
  to: string;
  label: string;
  icon: LucideIcon;
  hue: string;
}

/** 账本正文页顺序：也是左右翻页与底部索引的次序。 */
export const BOOK_PAGES: BookPage[] = [
  { to: '/', label: '总览', icon: LayoutDashboard, hue: 'var(--tone-blue)' },
  { to: '/ledger', label: '流水', icon: List, hue: 'var(--tone-teal)' },
  { to: '/schedules', label: '计划', icon: Calendar, hue: 'var(--tone-amber)' },
  { to: '/insights', label: '洞察', icon: Sparkles, hue: 'var(--tone-violet)' },
  { to: '/forecast', label: '预测', icon: LineChart, hue: 'var(--tone-cyan)' },
  { to: '/assistant', label: 'AI 分析', icon: Bot, hue: 'var(--tone-rose)' },
  { to: '/sandbox', label: '决策沙盘', icon: FlaskConical, hue: 'var(--tone-orange)' },
  { to: '/goals', label: '目标', icon: Target, hue: 'var(--tone-green)' },
  { to: '/data', label: '数据中心', icon: Database, hue: 'var(--tone-slate)' },
];

const SETTINGS_PAGE: BookPage = { to: '/settings', label: '个人设置', icon: Settings, hue: 'var(--tone-stone)' };
const FLIP_SEQUENCE = [...BOOK_PAGES.map((p) => p.to), SETTINGS_PAGE.to];

function pageIndex(pathname: string): number {
  const index = FLIP_SEQUENCE.indexOf(pathname);
  return index === -1 ? 0 : index;
}

function pageMeta(pathname: string): BookPage {
  if (pathname === SETTINGS_PAGE.to) return SETTINGS_PAGE;
  return BOOK_PAGES.find((p) => p.to === pathname) ?? BOOK_PAGES[0];
}

function tabSlug(pathname: string): string {
  return pathname === '/' ? 'home' : pathname.replace(/^\//, '');
}

function BookRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/ledger" element={<LedgerPage />} />
      <Route path="/schedules" element={<SchedulesPage />} />
      <Route path="/insights" element={<InsightsPage />} />
      <Route path="/forecast" element={<ForecastPage />} />
      <Route path="/assistant" element={<AssistantPage />} />
      <Route path="/sandbox" element={<SandboxPage />} />
      <Route path="/goals" element={<GoalsPage />} />
      <Route path="/data" element={<DataCenterPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn('brand-mark grid place-items-center font-bold text-white', compact ? 'h-8 w-8 rounded-[10px] text-[15px]' : 'h-9 w-9 rounded-[11px] text-[17px]')}>¥</div>
      <div>
        <p className={cn('font-semibold leading-none tracking-tight', compact ? 'text-[13px]' : 'text-[15px]')}>金钱流水</p>
        {!compact && <p className="mt-1 text-[10.5px] font-medium tracking-[0.16em] text-[#8A887F]">日 · 月 · 年 · 本地账本</p>}
      </div>
    </div>
  );
}

type FlipDirection = 'next' | 'prev';

interface LeafState {
  id: number;
  location: Location;
}

function BookLeaf({
  leaf,
  active,
  onFlip,
}: {
  leaf: LeafState;
  active: boolean;
  onFlip: (direction: FlipDirection) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  usePageReveal(innerRef, leaf.location.pathname, scrollRef);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const max = el.scrollHeight - el.clientHeight;
      const progress = max > 4 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${progress.toFixed(4)})`;
      if (isReducedMotion()) return;
      el.querySelectorAll<HTMLElement>('[data-parallax]').forEach((item) => {
        const speed = Number(item.dataset.parallax) || 0.16;
        item.style.transform = `translate3d(0, ${(-el.scrollTop * speed).toFixed(2)}px, 0)`;
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    let acc = 0;
    let lastFlip = 0;
    let resetTimer = 0;
    const onWheel = (event: WheelEvent) => {
      const now = performance.now();
      const horizontal = Math.abs(event.deltaX) > 14 && Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.15;
      if (horizontal) {
        if (now - lastFlip < 850) return;
        lastFlip = now;
        acc = 0;
        onFlip(event.deltaX > 0 ? 'next' : 'prev');
        return;
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const atTop = el.scrollTop <= 1;
      const atBottom = el.scrollHeight - el.clientHeight <= 4 || el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      if (event.deltaY > 0 && atBottom) acc = Math.max(0, acc) + event.deltaY;
      else if (event.deltaY < 0 && atTop) acc = Math.min(0, acc) + event.deltaY;
      else acc = 0;
      if (Math.abs(acc) > 360 && now - lastFlip > 900) {
        lastFlip = now;
        const direction: FlipDirection = acc > 0 ? 'next' : 'prev';
        acc = 0;
        onFlip(direction);
      }
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => { acc = 0; }, 520);
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.clearTimeout(resetTimer);
    };
  }, [active, onFlip, scrollRef]);

  return (
    <article className="book-leaf" data-leaf-id={leaf.id}>
      <div className="book-read-progress" aria-hidden="true"><span ref={progressRef} /></div>
      <div className="book-leaf-shadow" aria-hidden="true" />
      <div className="book-leaf-gutter" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="book-page-scroll" ref={scrollRef} data-book-scroll>
        <div ref={innerRef} className="page-motion book-page-inner">
          <BookRoutes location={leaf.location} />
        </div>
      </div>
    </article>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const mode = useAppStore((s) => s.mode);
  const dataset = useAppStore((s) => s.dataset);
  const introPending = useAppStore((s) => s.introPending);
  const exitDemo = useAppStore((s) => s.exitDemo);
  const [leaves, setLeaves] = useState<LeafState[]>(() => [{ id: 0, location }]);
  const [tocOpen, setTocOpen] = useState(false);
  const leafSeq = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const currentMeta = pageMeta(location.pathname);
  const isSettings = location.pathname === SETTINGS_PAGE.to;
  const bookIndex = BOOK_PAGES.findIndex((p) => p.to === location.pathname);
  const pageLabel = isSettings ? '附录 · 个人设置' : `第 ${String(bookIndex + 1).padStart(2, '0')} / ${String(BOOK_PAGES.length).padStart(2, '0')} 页`;
  const currentPos = pageIndex(location.pathname);
  const prevPage = currentPos > 0 ? pageMeta(FLIP_SEQUENCE[currentPos - 1]) : null;
  const nextPage = currentPos < FLIP_SEQUENCE.length - 1 ? pageMeta(FLIP_SEQUENCE[currentPos + 1]) : null;

  const dueCount = useMemo(() => {
    if (!dataset) return 0;
    const buckets = collectReminders({ flows: dataset.flows, records: dataset.occurrenceRecords, today: todayISO() });
    return buckets.overdue.length + buckets.dueToday.length;
  }, [dataset]);

  useEffect(() => {
    if (!user || !dataset) return;
    const check = () => {
      if (document.hidden || mode === 'demo') return;
      const today = todayISO();
      const prefs = loadReminderPrefs(user.id);
      const buckets = collectReminders({
        flows: dataset.flows,
        records: dataset.occurrenceRecords,
        today,
        advanceDays: prefs.advanceDays,
      });
      const next = notifyIfDue({ prefs, buckets, today, onClick: () => navigate('/schedules') });
      saveReminderPrefs(user.id, next);
    };
    const first = setTimeout(check, 1200);
    const timer = setInterval(check, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [user, dataset, mode, navigate]);

  const goTo = useCallback((to: string) => {
    navigate(to);
  }, [navigate]);

  const goPrev = useCallback(() => {
    if (prevPage) goTo(prevPage.to);
  }, [goTo, prevPage]);

  const goNext = useCallback(() => {
    if (nextPage) goTo(nextPage.to);
  }, [goTo, nextPage]);

  const handleFlip = useCallback((direction: FlipDirection) => {
    if (direction === 'next') goNext();
    else goPrev();
  }, [goNext, goPrev]);

  useEffect(() => {
    setLeaves((prev) => {
      const last = prev[prev.length - 1];
      if (last.location.pathname === location.pathname) {
        if (last.location.search === location.search && last.location.hash === location.hash) return prev;
        return [...prev.slice(0, -1), { ...last, location }];
      }
      const nextLeaf: LeafState = { id: ++leafSeq.current, location };
      return prev.length > 1 ? [prev[prev.length - 1], nextLeaf] : [...prev, nextLeaf];
    });
  }, [location]);

  useLayoutEffect(() => {
    if (leaves.length < 2) return;
    const stage = stageRef.current;
    if (!stage) return;
    const [from, to] = leaves;
    const fromEl = stage.querySelector<HTMLElement>(`[data-leaf-id="${from.id}"]`);
    const toEl = stage.querySelector<HTMLElement>(`[data-leaf-id="${to.id}"]`);
    if (!fromEl || !toEl) return;

    tlRef.current?.kill();
    const reduce = isReducedMotion();
    const settle = () => {
      stage.style.pointerEvents = '';
      gsap.set(toEl, { clearProps: 'transform,opacity,zIndex' });
      setLeaves((prev) => (prev.length > 1 ? [prev[prev.length - 1]] : prev));
    };
    stage.style.pointerEvents = 'none';

    if (reduce) {
      tlRef.current = gsap
        .timeline({ onComplete: settle })
        .fromTo(toEl, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power1.out' });
      return;
    }

    const forward = pageIndex(to.location.pathname) >= pageIndex(from.location.pathname);
    const fromShadow = fromEl.querySelector<HTMLElement>('.book-leaf-shadow');
    const toShadow = toEl.querySelector<HTMLElement>('.book-leaf-shadow');

    if (forward) {
      gsap.set(toEl, { zIndex: 1, rotateY: 0, x: 26, scale: 0.994, transformOrigin: '0% 50%' });
      gsap.set(fromEl, { zIndex: 2, rotateY: 0, transformOrigin: '0% 50%' });
      gsap.set(fromShadow, { opacity: 0 });
      tlRef.current = gsap
        .timeline({ onComplete: settle })
        .to(toEl, { x: 0, scale: 1, duration: 0.8, ease: 'power2.out' }, 0)
        .to(fromEl, { rotateY: -108, duration: 0.82, ease: 'power2.inOut' }, 0)
        .to(fromShadow, { opacity: 0.85, duration: 0.5, ease: 'power1.in' }, 0.02)
        .to(fromEl, { opacity: 0.16, duration: 0.18, ease: 'power1.in' }, 0.6);
    } else {
      gsap.set(toEl, { zIndex: 3, rotateY: -108, transformOrigin: '0% 50%' });
      gsap.set(fromEl, { zIndex: 2, x: 0, scale: 1, transformOrigin: '0% 50%' });
      gsap.set(toShadow, { opacity: 0.85 });
      tlRef.current = gsap
        .timeline({ onComplete: settle })
        .to(toEl, { rotateY: 0, duration: 0.82, ease: 'power2.inOut' }, 0)
        .to(toShadow, { opacity: 0, duration: 0.62, ease: 'power1.out' }, 0.1)
        .to(fromEl, { x: 18, scale: 0.992, duration: 0.82, ease: 'power2.inOut' }, 0);
    }
    return () => {
      tlRef.current?.kill();
    };
  }, [leaves]);

  useGSAP(() => {
    const shell = shellRef.current;
    if (!shell || isReducedMotion()) return;
    const frame = shell.querySelector('.book-frame');
    const tabs = shell.querySelectorAll('.book-tab');
    if (frame) {
      gsap.fromTo(frame, { y: 34, opacity: 0, scale: 0.985 }, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out', clearProps: 'transform,opacity' });
    }
    if (tabs.length) {
      gsap.fromTo(tabs, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.03, delay: 0.18, ease: 'back.out(1.8)', clearProps: 'transform,opacity' });
    }
  }, { scope: shellRef });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'PageDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'PageUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev]);

  useEffect(() => {
    if (!tocOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTocOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tocOpen]);

  return (
    <div ref={shellRef} className="book-shell">
      <PageAtmosphere />

      <header className="book-topbar">
        <div className="book-topbar-left">
          <div className="hidden lg:block"><Brand /></div>
          <div className="lg:hidden"><AccountMenu variant="mobile" /></div>
          <div className="hidden lg:block"><AccountMenu /></div>
          <div className="book-topbar-brand lg:hidden"><Brand compact /></div>
        </div>
        <div className="book-topbar-right">
          <span className="book-desk-chip hidden sm:inline-flex">
            <BookOpen size={13} />
            账本模式 · 左右翻页
          </span>
          <span className="book-desk-chip is-accent" data-testid="book-page-chip">{pageLabel}</span>
          {mode === 'demo' && (
            <button
              type="button"
              className="book-desk-chip is-demo"
              onClick={() => void exitDemo()}
              data-testid="exit-demo"
            >
              示例数据 · 退出
            </button>
          )}
        </div>
      </header>

      <div className="book-desk">
        <div className="book-frame">
          <span className="book-corner tl" aria-hidden="true" />
          <span className="book-corner tr" aria-hidden="true" />
          <span className="book-corner bl" aria-hidden="true" />
          <span className="book-corner br" aria-hidden="true" />
          <span className="book-ribbon" aria-hidden="true" />

          <nav className="book-tabs" aria-label="账本栏目索引">
            {BOOK_PAGES.map((item, index) => (
              <button
                key={item.to}
                type="button"
                className={cn('book-tab', item.to === location.pathname && 'is-active')}
                style={{ '--tab-hue': item.hue } as CSSProperties}
                onClick={() => goTo(item.to)}
                aria-label={`${item.label}（第 ${index + 1} 页）`}
                aria-current={item.to === location.pathname ? 'page' : undefined}
                title={`${item.label} · 第 ${index + 1} 页`}
                data-testid={`book-tab-${tabSlug(item.to)}`}
              >
                <item.icon size={15} strokeWidth={1.9} />
                <span className="book-tab-no">{String(index + 1).padStart(2, '0')}</span>
                <span className="book-tab-label">{item.label}</span>
                {item.to === '/schedules' && dueCount > 0 && (
                  <span data-testid="schedules-badge" className="rounded-full bg-[#98362E] px-1.5 py-0.5 text-[10px] font-semibold text-white">{dueCount > 99 ? '99+' : dueCount}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="book-stage" ref={stageRef}>
            {leaves.map((leaf, index) => (
              <BookLeaf
                key={leaf.id}
                leaf={leaf}
                active={leaves.length === 1 && index === 0}
                onFlip={handleFlip}
              />
            ))}
          </div>

          <div className="book-page-foot">
            <button
              type="button"
              className="book-flip-btn is-prev"
              onClick={goPrev}
              disabled={!prevPage}
              aria-label={prevPage ? `上一页：${prevPage.label}` : '已是第一页'}
              title={prevPage ? `上一页：${prevPage.label}` : '已是第一页'}
              data-testid="book-prev"
            >
              <ChevronLeft size={16} />
            </button>
            <p className="book-pageno">
              <span className="book-pageno-rule" aria-hidden="true" />
              <span>{currentMeta.label}</span>
              <em>{pageLabel}</em>
              <span className="book-pageno-rule" aria-hidden="true" />
            </p>
            <button
              type="button"
              className="book-flip-btn is-next"
              onClick={goNext}
              disabled={!nextPage}
              aria-label={nextPage ? `下一页：${nextPage.label}` : '已是最后一页'}
              title={nextPage ? `下一页：${nextPage.label}` : '已是最后一页'}
              data-testid="book-next"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <nav className="book-mobile-bar lg:hidden" aria-label="账本翻页">
        <button type="button" className="book-mobile-step" onClick={goPrev} disabled={!prevPage} aria-label={prevPage ? `上一页：${prevPage.label}` : '已是第一页'}>
          <ChevronLeft size={18} />
          <span>上一页</span>
        </button>
        <button type="button" className="relative book-mobile-toc" onClick={() => setTocOpen(true)} data-testid="book-toc">
          <BookOpen size={17} />
          <span>目录 · {currentMeta.label}</span>
          {dueCount > 0 && <span data-testid="schedules-dot" className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-[#98362E]" />}
        </button>
        <button type="button" className="book-mobile-step" onClick={goNext} disabled={!nextPage} aria-label={nextPage ? `下一页：${nextPage.label}` : '已是最后一页'}>
          <ChevronRight size={18} />
          <span>下一页</span>
        </button>
      </nav>

      {tocOpen && (
        <div className="modal-scrim lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setTocOpen(false)}>
          <div className="modal-panel fade-in book-toc-panel p-4" role="dialog" aria-label="账本目录">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">账本目录 · {pageLabel}</p>
                <p className="mt-0.5 text-[11px] text-[#8A887F]">选择栏目会像翻开账本一样切换页面</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm !p-2" onClick={() => setTocOpen(false)} aria-label="关闭目录">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {BOOK_PAGES.map((item, index) => (
                <button
                  key={item.to}
                  type="button"
                  className={cn('book-toc-item', item.to === location.pathname && 'is-active')}
                  style={{ '--tab-hue': item.hue } as CSSProperties}
                  onClick={() => {
                    setTocOpen(false);
                    goTo(item.to);
                  }}
                  data-testid={`book-toc-${tabSlug(item.to)}`}
                >
                  <item.icon size={16} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.to === '/schedules' && dueCount > 0 && (
                    <span className="rounded-full bg-[#98362E] px-1.5 py-0.5 text-[10px] font-semibold text-white">{dueCount > 99 ? '99+' : dueCount}</span>
                  )}
                  <em>{String(index + 1).padStart(2, '0')}</em>
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={() => {
                  setTocOpen(false);
                  goTo('/ledger?quick=1');
                }}
              >
                <Plus size={15} /> 快速记一笔
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setTocOpen(false);
                  goTo(SETTINGS_PAGE.to);
                }}
              >
                <Settings size={15} /> 设置
              </button>
            </div>
          </div>
        </div>
      )}

      <SectionMascot />
      {introPending && <LedgerIntro />}
    </div>
  );
}