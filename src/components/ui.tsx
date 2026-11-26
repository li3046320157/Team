import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
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
import { gsap, isReducedMotion, useGSAP } from '../motion/gsap';
import { useAppStore } from '../store/useAppStore';
import { ScrambleText } from './TextFx';

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
  style,
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padded?: boolean;
}) {
  return (
    <section className={cn('card', className)} style={style} data-reveal="">
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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" data-reveal="">
      <div>
        <h1 className="page-title text-[26px] font-semibold tracking-[-0.02em] text-[#1F2421]" aria-label={title}>
          <ScrambleText text={title} />
        </h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[#6B6A63]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Money({ cents, className, short = false }: { cents: number; className?: string; short?: boolean }) {
  return <span className={cn('num', cents < 0 && 'text-[#B5453C]', className)}>{short ? formatMoneyShort(cents) : formatMoney(cents)}</span>;
}

/** 同一 id 的余额在页面重新挂载后仍从上次显示值逐位翻转（首次出现直接显示）。 */
const lastMoney = new Map<string, number>();

/** 余额数字逐位翻转（加油机式滚动），数值变化瞬间闪一下。 */
export function AnimatedMoney({ cents, id, className }: { cents: number; id?: string; className?: string }) {
  const [prev, setPrev] = useState<string>(() => {
    const old = id === undefined ? undefined : lastMoney.get(id);
    return old === undefined || old === cents ? formatMoney(cents) : formatMoney(old);
  });
  const [pulse, setPulse] = useState(false);
  const prevCentsRef = useRef(cents);
  const mountedChanged = id !== undefined && lastMoney.get(id) !== undefined && lastMoney.get(id) !== cents;

  useEffect(() => {
    if (id !== undefined) lastMoney.set(id, cents);
  }, [id, cents]);

  const text = formatMoney(cents);

  useEffect(() => {
    if (prev !== text && prev.length !== text.length) setPrev(text);
  }, [prev, text]);

  useEffect(() => {
    const prevCents = prevCentsRef.current;
    prevCentsRef.current = cents;
    if (prevCents === cents) {
      if (mountedChanged) {
        setPulse(true);
        const timer = setTimeout(() => setPulse(false), 700);
        return () => clearTimeout(timer);
      }
      return;
    }
    const prevText = formatMoney(prevCents);
    if (prevText.length === text.length) setPrev(prevText);
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 700);
    return () => clearTimeout(timer);
    // mountedChanged 只在挂载时参与判断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);

  const canRoll = prev !== text && prev.length === text.length;
  const base = cn('num', cents < 0 && 'text-[#B5453C]', pulse && 'balance-pulse', className);

  if (!canRoll) return <span className={base}>{text}</span>;

  return (
    <span className={cn(base, 'odometer')}>
      {text.split('').map((ch, i) => {
        const p = prev[i];
        if (!/[0-9]/.test(ch) || !/[0-9]/.test(p ?? '')) return <span key={i}>{ch}</span>;
        const fromRight = text.length - 1 - i;
        return (
          <span key={i} className="digit-col" style={{ '--d': `${fromRight * 28}ms` } as CSSProperties}>
            <span className="digit-roll-old">{p}</span>
            <span className="digit-roll-new">{ch}</span>
          </span>
        );
      })}
    </span>
  );
}

export function Badge({ tone = 'gray', children }: { tone?: 'teal' | 'amber' | 'danger' | 'gray' | 'white'; children: ReactNode }) {
  return <span className={cn('chip', `chip-${tone}`)}>{children}</span>;
}

export function Progress({ value, max, tone = 'teal' }: { value: number; max: number; tone?: 'teal' | 'amber' | 'danger' }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  useGSAP(() => {
    const bar = barRef.current;
    if (!bar) return;
    const reduce = isReducedMotion();
    gsap.fromTo(
      bar,
      { scaleX: 0 },
      {
        scaleX: pct / 100,
        duration: reduce ? 0 : 0.75,
        ease: 'power3.out',
        scrollTrigger: reduce ? undefined : { trigger: hostRef.current, start: 'top 92%', once: true },
      },
    );
  }, { dependencies: [pct], scope: hostRef, revertOnUpdate: true });

  const color = tone === 'danger' ? 'var(--danger)' : tone === 'amber' ? 'var(--accent-2)' : 'var(--accent)';
  return (
    <div ref={hostRef} className="h-2 w-full overflow-hidden rounded-full bg-[#EFECE6]">
      <div ref={barRef} className="h-full w-full rounded-full" style={{ background: color, transform: 'scaleX(0)', transformOrigin: 'left center' }} />
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
    <div className="fade-in flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#DDD8CD] bg-[#FCFBF7] px-6 py-10 text-center">
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
            value === opt.value ? 'bg-white text-[var(--accent-ink)] shadow-sm' : 'text-[#6B6A63] hover:text-[#1F2421]',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  'aria-label'?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
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

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function burstCoins(seed: string) {
  const h = hashStr(seed);
  const rand = (n: number) => {
    let x = (h + Math.imul(n, 2654435761)) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 10 }, (_, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    return {
      dx: Math.round(side * (30 + rand(i) * 80)),
      dy: Math.round(36 + rand(i + 99) * 44),
      rot: Math.round(side * (120 + rand(i + 55) * 320)),
      delay: Math.round(rand(i + 7) * 90),
      size: Math.round(10 + rand(i + 33) * 5),
      teal: rand(i + 21) < 0.3,
    };
  });
}

export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const clear = useAppStore((s) => s.clearToast);
  if (!toast) return null;
  const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? XCircle : Info;
  return (
    <div className="fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 sm:bottom-6">
      {toast.kind === 'success' && (
        <div key={`burst-${toast.id}`} className="toast-burst" aria-hidden="true">
          {burstCoins(String(toast.id)).map((p, i) => (
            <span
              key={i}
              className={cn('burst-coin', p.teal && 'burst-coin-teal')}
              style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--rot': `${p.rot}deg`, '--delay': `${p.delay}ms`, '--size': `${p.size}px` } as CSSProperties}
            >
              ¥
            </span>
          ))}
        </div>
      )}
      <div
        key={toast.id}
        className={cn(
          'toast-pop flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-[13px] shadow-xl',
          toast.kind === 'success' && 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]',
          toast.kind === 'error' && 'border-[#EBCBC6] bg-[#FCF1EF] text-[#98362E]',
          toast.kind === 'info' && 'border-[#E4E0D8] bg-white text-[#3A3D37]',
        )}
        role="status"
      >
        <Icon size={16} className={cn('mt-0.5 shrink-0', toast.kind === 'success' && 'toast-check')} />
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
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#CFC9BD] border-t-[var(--accent)]" />
      {label}
    </div>
  );
}

const STAT_TONES = {
  accent: ['var(--accent)', 'var(--accent-ink)'],
  teal: ['var(--accent)', 'var(--accent-ink)'],
  accent2: ['var(--accent-2)', 'var(--accent-2-ink)'],
  amber: ['var(--accent-2)', 'var(--accent-2-ink)'],
  positive: ['var(--tone-green)', 'var(--tone-green)'],
  warning: ['var(--tone-amber)', 'var(--tone-amber)'],
  danger: ['var(--danger)', '#98362E'],
} as const;

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | keyof typeof STAT_TONES;
  className?: string;
}) {
  const pair = tone === 'default' ? undefined : STAT_TONES[tone];
  return (
    <div
      className={cn('card stat-card stat-in p-4 sm:p-5', className)}
      style={pair ? ({ '--stat-tone': pair[0], '--stat-ink': pair[1] } as CSSProperties) : undefined}
    >
      <p className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8A887F]">
        {pair && <span className="stat-dot" aria-hidden="true" />}
        {label}
      </p>
      <div className="num stat-value mt-2 text-[24px] font-semibold tracking-[-0.02em]">{value}</div>
      {hint && <div className="mt-1.5 text-[11.5px] leading-relaxed text-[#8A887F]">{hint}</div>}
    </div>
  );
}

export function CheckMark({ ok }: { ok: boolean }) {
  return ok ? <Check size={14} className="text-[var(--accent-ink)]" /> : <X size={14} className="text-[#B5453C]" />;
}

export function TransferIcon() {
  return <ArrowLeftRight size={14} />;
}