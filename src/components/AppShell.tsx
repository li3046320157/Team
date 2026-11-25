import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  Calendar,
  Database,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  List,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Settings,
  Sparkles,
  Target,
  UserRound,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { ScrollTrigger } from '../motion/gsap';
import { ScrollProgress } from '../motion/ScrollProgress';
import { usePageReveal } from '../motion/usePageReveal';
import { cn } from './ui';

const NAV = [
  { to: '/', label: '总览', icon: LayoutDashboard },
  { to: '/ledger', label: '流水', icon: List },
  { to: '/schedules', label: '计划', icon: Calendar },
  { to: '/insights', label: '洞察', icon: Sparkles },
  { to: '/forecast', label: '预测', icon: LineChart },
  { to: '/assistant', label: 'AI 分析', icon: Bot },
  { to: '/sandbox', label: '决策沙盘', icon: FlaskConical },
  { to: '/goals', label: '目标', icon: Target },
  { to: '/data', label: '数据中心', icon: Database },
  { to: '/settings', label: '设置', icon: Settings },
];

const MOBILE_PRIMARY = NAV.filter((n) => ['/', '/ledger', '/forecast', '/goals'].includes(n.to));
const MOBILE_MORE = NAV.filter((n) => !['/', '/ledger', '/forecast', '/goals'].includes(n.to));

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#0E7568] text-[17px] font-bold text-white shadow-[0_8px_18px_-10px_rgba(14,117,104,0.9)]">¥</div>
      <div>
        <p className="text-[15px] font-semibold leading-none tracking-tight">MoneyFlow</p>
        <p className="mt-1 text-[10.5px] font-medium tracking-[0.16em] text-[#8A887F]">钱流 · 本地账本</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useAppStore((s) => s.user);
  const dataset = useAppStore((s) => s.dataset);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const activeLabel = NAV.find((n) => n.to === location.pathname)?.label ?? 'MoneyFlow';
  const pageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  usePageReveal(pageRef, location.pathname);

  useEffect(() => {
    const timer = window.setTimeout(() => ScrollTrigger.refresh(), 160);
    return () => window.clearTimeout(timer);
  }, [dataset]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const trigger = ScrollTrigger.create({
      start: 8,
      end: 'max',
      onToggle: (self) => header.classList.toggle('is-scrolled', self.isActive),
    });
    return () => trigger.kill();
  }, []);

  return (
    <div className="min-h-screen">
      <ScrollProgress />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-[#E7E3DA] bg-[#FBF9F4]/90 px-4 py-5 backdrop-blur lg:flex">
        <Brand />
        <nav className="mt-7 flex flex-1 flex-col gap-0.5" aria-label="主导航">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => cn('nav-link', isActive && 'active')}>
              <item.icon size={16} strokeWidth={1.9} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 space-y-2">
          {user && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-[#E4E0D8] bg-white px-3 py-2.5" data-testid="user-chip">
              <div className="flex min-w-0 items-center gap-2">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#E3F1ED] text-[#0B6357]"><UserRound size={14} /></div>
                <span className="truncate text-[12px] font-semibold text-[#3A3D37]">{user.username}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-xs shrink-0" onClick={logout} aria-label="退出登录" data-testid="logout">
                <LogOut size={13} /> 退出
              </button>
            </div>
          )}
          <p className="px-1 text-[10.5px] leading-relaxed text-[#A3A097]">
            整数分计算 · 本地 IndexedDB
            <br />
            预测是规划参考，不是收益承诺
          </p>
        </div>
      </aside>

      <div className="lg:pl-[232px]">
        <header ref={headerRef} className="app-header sticky top-0 z-20 flex items-center justify-between border-b border-[#E7E3DA] bg-[#F7F5F1]/85 px-4 py-3 backdrop-blur lg:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            <span className="chip chip-teal">本机账本</span>
            <button type="button" className="btn btn-secondary btn-sm !p-2" aria-label="打开更多导航" onClick={() => setMoreOpen(true)}>
              <Menu size={17} />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-5 sm:px-6 lg:pb-12 lg:pt-8">
          <div ref={pageRef} key={location.pathname} className="page-motion">{children}</div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E7E3DA] bg-[#FBF9F4]/95 backdrop-blur lg:hidden" aria-label="底部导航">
        <div className="grid grid-cols-5">
          {MOBILE_PRIMARY.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[10.5px]', isActive ? 'text-[#0B6357]' : 'text-[#7A786F]')}
            >
              <item.icon size={19} strokeWidth={1.9} />
              {item.label}
            </NavLink>
          ))}
          <button type="button" className="flex flex-col items-center gap-1 py-2.5 text-[10.5px] text-[#7A786F]" onClick={() => setMoreOpen(true)}>
            <MoreHorizontal size={19} />
            更多
          </button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>

      {moreOpen && (
        <div className="modal-scrim lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div className="modal-panel fade-in p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">更多功能 · {activeLabel}</p>
              <button type="button" className="btn btn-ghost btn-sm !p-2" onClick={() => setMoreOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MOBILE_MORE.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  className="flex items-center gap-2 rounded-xl border border-[#E4E0D8] bg-white px-3 py-3 text-left text-[13px] font-medium"
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(item.to);
                  }}
                >
                  <item.icon size={16} className="text-[#0B6357]" />
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={() => {
                  setMoreOpen(false);
                  navigate('/ledger?quick=1');
                }}
              >
                <Plus size={15} /> 快速记一笔
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setMoreOpen(false)}>
                关闭
              </button>
            </div>
            {user && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-[#E4E0D8] bg-[#FAF8F3] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <UserRound size={15} className="shrink-0 text-[#0B6357]" />
                  <span className="truncate text-[12.5px] font-semibold">{user.username}</span>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMoreOpen(false); logout(); }}>
                  <LogOut size={14} /> 退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}