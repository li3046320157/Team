import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  Book,
  Briefcase,
  Coffee,
  Coins,
  Film,
  Gift,
  Heart,
  House,
  Info,
  Shapes,
  ShoppingBag,
  Smartphone,
  Train,
  Utensils,
  Wallet,
  X,
  Check,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { formatMoney, formatMoneyShort } from '../domain/money';
import { useAppStore } from '../store/useAppStore';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'xs';
}
export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'secondary' && 'btn-secondary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'btn-sm',
        size === 'xs' && 'btn-xs',
        className,
      )}
      {...rest}
    />
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cn('card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-[#1F2421]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-[#6B6A63]">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn(padded ? 'p-5' : '')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#1F2421]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[#6B6A63]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Money({ cents, className, short = false }: { cents: number; className?: string; short?: boolean }) {
  return <span className={cn('num', cents < 0 && 'text-[#B5453C]', className)}>{short ? formatMoneyShort(cents) : formatMoney(cents)}</span>;
}

export function Badge({ tone = 'gray', children }: { tone?: 'teal' | 'amber' | 'danger' | 'gray' | 'white'; children: ReactNode }) {
  return <span className={cn('chip', `chip-${tone}`)}>{children}</span>;
}

export function Progress({ value, max, tone = 'teal' }: { value: number; max: number; tone?: 'teal' | 'amber' | 'danger' }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const color = tone === 'danger' ? '#B5453C' : tone === 'amber' ? '#B7791F' : '#0E7568';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[#EFECE6]">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-[#8A887F]">{hint}</span>}
    </label>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel fade-in" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#EFECE6] bg-[#FFFDF9]/95 px-5 py-4 backdrop-blur">
          <div>
            <h3 className="text-[16px] font-semibold">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-[#6B6A63]">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm !p-2" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[#EFECE6] px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#DDD8CD] bg-[#FCFBF7] px-6 py-10 text-center">
      <p className="text-sm font-semibold text-[#3A3D37]">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-[#7A786F]">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-[10px] border border-[#E4E0D8] bg-[#F4F1EA] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-lg font-medium transition-all',
            size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-xs',
            value === opt.value ? 'bg-white text-[#0B6357] shadow-sm' : 'text-[#6B6A63] hover:text-[#1F2421]',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[11.5px] leading-relaxed',
        tone === 'warn' ? 'border-[#EEDCB9] bg-[#FBF4E4] text-[#7A5517]' : 'border-[#E4E0D8] bg-[#FAF8F3] text-[#6B6A63]',
      )}
    >
      {tone === 'warn' ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

const ICONS: Record<string, typeof Coffee> = {
  utensils: Utensils,
  coffee: Coffee,
  train: Train,
  shopping: ShoppingBag,
  house: House,
  phone: Smartphone,
  film: Film,
  heart: Heart,
  book: Book,
  shapes: Shapes,
  wallet: Wallet,
  briefcase: Briefcase,
  gift: Gift,
  coins: Coins,
};

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? Shapes;
  return <Icon size={15} className={className} />;
}

export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const clear = useAppStore((s) => s.clearToast);
  if (!toast) return null;
  const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? XCircle : Info;
  return (
    <div className="fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 sm:bottom-6">
      <div
        className={cn(
          'flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-[13px] shadow-xl',
          toast.kind === 'success' && 'border-[#CBE5DD] bg-[#F1FAF7] text-[#0B6357]',
          toast.kind === 'error' && 'border-[#EBCBC6] bg-[#FCF1EF] text-[#98362E]',
          toast.kind === 'info' && 'border-[#E4E0D8] bg-white text-[#3A3D37]',
        )}
        role="status"
      >
        <Icon size={16} className="mt-0.5 shrink-0" />
        <span className="leading-relaxed">{toast.text}</span>
        <button type="button" className="ml-1 opacity-60 hover:opacity-100" onClick={clear} aria-label="关闭提示">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#6B6A63]">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#CFC9BD] border-t-[#0E7568]" />
      {label}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'teal' | 'amber' | 'danger';
}) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8A887F]">{label}</p>
      <div
        className={cn(
          'num mt-2 text-[24px] font-semibold tracking-[-0.02em]',
          tone === 'teal' && 'text-[#0B6357]',
          tone === 'amber' && 'text-[#8A5A13]',
          tone === 'danger' && 'text-[#98362E]',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[11.5px] leading-relaxed text-[#8A887F]">{hint}</div>}
    </div>
  );
}

export function CheckMark({ ok }: { ok: boolean }) {
  return ok ? <Check size={14} className="text-[#0B6357]" /> : <X size={14} className="text-[#B5453C]" />;
}

export function TransferIcon() {
  return <ArrowLeftRight size={14} />;
}