import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { AuthPage } from './components/AuthPage';
import { Onboarding } from './components/Onboarding';
import { Button, Spinner, Toast } from './components/ui';
import { useAppStore } from './store/useAppStore';
import { DashboardPage } from './pages/Dashboard';
import { LedgerPage } from './pages/Ledger';
import { SchedulesPage } from './pages/Schedules';
import { InsightsPage } from './pages/Insights';
import { ForecastPage } from './pages/Forecast';
import { SandboxPage } from './pages/Sandbox';
import { GoalsPage } from './pages/Goals';
import { DataCenterPage } from './pages/DataCenter';
import { SettingsPage } from './pages/Settings';
import { AssistantPage } from './pages/Assistant';

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
      <AppShell>
        <Routes>
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
      </AppShell>
      <Toast />
    </>
  );
}

export function App() {
  const boot = useAppStore((s) => s.boot);
  const authReady = useAppStore((s) => s.authReady);
  const user = useAppStore((s) => s.user);
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);
  const loading = useAppStore((s) => s.loading);
  const dataset = useAppStore((s) => s.dataset);
  const error = useAppStore((s) => s.error);
  const dismissError = useAppStore((s) => s.dismissError);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!authReady) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="card flex w-[280px] flex-col items-center gap-3 p-8">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0E7568] text-xl font-bold text-white">¥</div>
          <Spinner label="正在打开本地账本…" />
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

  if (!ready || (loading && !dataset)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="card flex w-[280px] flex-col items-center gap-3 p-8">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0E7568] text-xl font-bold text-white">¥</div>
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