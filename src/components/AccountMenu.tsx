import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Settings, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { cn } from './ui';

export function AccountMenu({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isSidebar = variant === 'sidebar';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;
  const initial = user.username.slice(0, 1).toUpperCase();

  return (
    <div ref={wrapRef} className={cn('account-wrap', !isSidebar && 'account-wrap-mobile')}>
      <button
        type="button"
        className={cn('account-trigger', !isSidebar && 'is-mobile')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="个人信息与设置"
        data-testid={isSidebar ? 'account-menu' : 'account-menu-mobile'}
      >
        <span className="account-avatar" aria-hidden="true">{initial}</span>
        <span className="account-meta">
          <span className="account-name" data-testid={isSidebar ? 'user-chip' : undefined}>{user.username}</span>
          {isSidebar && <span className="account-role">个人设置 · 账本仅存本机</span>}
        </span>
        <ChevronDown size={14} className={cn('account-chevron', open && 'is-open')} aria-hidden="true" />
      </button>

      {open && (
        <div className="account-popover" role="menu" data-testid={isSidebar ? 'account-popover' : 'account-popover-mobile'}>
          <div className="account-pop-head">
            <span className="account-avatar is-large" aria-hidden="true">{initial}</span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[#2E332D]">{user.username}</p>
              <p className="mt-0.5 text-[10.5px] text-[#8A887F]">云端账户 · 账本仅存本机</p>
            </div>
          </div>
          <div className="account-pop-sep" />
          <button
            type="button"
            role="menuitem"
            className="account-pop-item"
            onClick={() => { setOpen(false); navigate('/settings'); }}
            data-testid={isSidebar ? 'account-settings' : 'account-settings-mobile'}
          >
            <Settings size={15} /> 个人设置 · 资料与密码
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-pop-item is-danger"
            onClick={() => { setOpen(false); void logout().then((message) => { if (!message) navigate('/'); }); }}
            data-testid={isSidebar ? 'logout' : 'logout-mobile'}
          >
            <LogOut size={15} /> 退出登录
          </button>
          <p className="account-pop-note"><ShieldCheck size={12} /> 密码由云端加盐哈希保存，账本不上传</p>
        </div>
      )}
    </div>
  );
}