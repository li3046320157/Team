import { HashRouter, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { AuthPage } from './components/AuthPage';
import { Onboarding } from './components/Onboarding';
import { Button, Spinner, Toast } from './components/ui';
import { apiPingUsage } from './data/account-api';
import { useAppStore } from './store/useAppStore';

const AdminApp = lazy(() => import('./admin/AdminApp').then((module) => ({ default: module.AdminApp })));
const USAGE_PING_INTERVAL_MS = 5 * 60 * 1000;

function AdminLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#0B1116] px-4">
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#1E2A33] bg-[#101920] px-8 py-7">
        <div className="grid h-11 w-11 place-items-center rounded-xl border border-[#2E4956] bg-[#13242C] text-lg font-bold text-[#7AD7B4]">¥</div>
        <Spinner label="正在载入管理控制台…" />
      </div>
    </div>
  );
}

function Shell() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const btn = target?.closest<HTMLElement>('.btn:not(:disabled)');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = `${size}px`;
      span.style.height = `${size}px`;
      span.style.left = `${event.clientX - rect.left - size / 2}px`;
      span.style.top = `${event.clientY - rect.top - size / 2}px`;
      btn.appendChild(span);
      window.setTimeout(() => span.remove(), 1500);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  return (
    <>
      <AppShell />
      <Toast />
    </>
  );
}

export function App() {
  const boot = useAppStore((s) => s.boot);
  const authReady = useAppStore((s) => s.authReady);
  const authError = useAppStore((s) => s.authError);
  const user = useAppStore((s) => s.user);
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);
  const loading = useAppStore((s) => s.loading);
  const dataset = useAppStore((s) => s.dataset);
  const error = useAppStore((s) => s.error);
  const dismissError = useAppStore((s) => s.dismissError);
  const userId = user?.id;
  const userRole = user?.role;

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!userId || userRole !== 'user' || !ready) return;
    let lastPing = 0;
    const ping = () => {
      if (document.visibilityState !== 'visible') return;
      lastPing = Date.now();
      void apiPingUsage();
    };
    ping();
    const timer = window.setInterval(ping, USAGE_PING_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPing >= USAGE_PING_INTERVAL_MS) ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, userRole, ready]);

  if (!authReady) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="card flex w-[280px] flex-col items-center gap-3 p-8">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent)] text-xl font-bold text-white">¥</div>
          <Spinner label="正在连接账户服务…" />
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card w-full max-w-md p-6 text-center">
          <p className="text-lg font-semibold">账户服务暂时无法连接</p>
          <p className="mt-2 text-sm leading-relaxed text-[#6B6A63]">{authError}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" onClick={() => void boot()}>重试连接</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <HashRouter>
        <Routes>
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="*" element={<AuthPage mode="login" />} />
        </Routes>
        <Toast />
      </HashRouter>
    );
  }

  if (user.role === 'admin') {
    return (
      <Suspense fallback={<AdminLoading />}>
        <AdminApp />
        <Toast />
      </Suspense>
    );
  }

  if (!ready || (loading && !dataset)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="card flex w-[280px] flex-col items-center gap-3 p-8">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent)] text-xl font-bold text-white">¥</div>
          <Spinner label="正在打开本地账本…" />
        </div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card w-full max-w-md p-6 text-center">
          <p className="text-lg font-semibold">无法打开本地数据</p>
          <p className="mt-2 text-sm leading-relaxed text-[#6B6A63]">{error ?? '浏览器可能禁用了 IndexedDB。'}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" onClick={() => void init()}>
              重试
            </Button>
            <Button variant="ghost" onClick={dismissError}>
              忽略
            </Button>
          </div>
        </div>
        <Toast />
      </div>
    );
  }

  if (!dataset.settings.onboardingDone) {
    return (
      <>
        <Onboarding />
        <Toast />
      </>
    );
  }

  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}