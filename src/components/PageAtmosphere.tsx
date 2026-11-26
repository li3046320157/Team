import type { CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bot,
  Calendar,
  CircleDollarSign,
  Database,
  FlaskConical,
  LineChart,
  List,
  Settings,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

type Motif = 'coins' | 'ledger' | 'calendar' | 'spark' | 'curve' | 'nodes' | 'blocks' | 'rings' | 'matrix' | 'gears';

interface Atmosphere {
  icon: LucideIcon;
  hue: string;
  motif: Motif;
  chars: string[];
}

const ATMOSPHERES: Record<string, Atmosphere> = {
  '/': { icon: CircleDollarSign, hue: 'var(--tone-blue)', motif: 'coins', chars: ['¥', '+', '−', '¥', '%', '·'] },
  '/ledger': { icon: List, hue: 'var(--tone-teal)', motif: 'ledger', chars: ['¥', '+', '−', '￥', '·', '¥'] },
  '/schedules': { icon: Calendar, hue: 'var(--tone-amber)', motif: 'calendar', chars: ['一', '二', '三', '＋', '○', '·'] },
  '/insights': { icon: Sparkles, hue: 'var(--tone-violet)', motif: 'spark', chars: ['✦', '✧', '·', '+', '%', '·'] },
  '/forecast': { icon: LineChart, hue: 'var(--tone-cyan)', motif: 'curve', chars: ['↗', '↘', '·', '+', '%', '·'] },
  '/assistant': { icon: Bot, hue: 'var(--tone-rose)', motif: 'nodes', chars: ['◎', '·', '+', '✦', '?', '·'] },
  '/sandbox': { icon: FlaskConical, hue: 'var(--tone-orange)', motif: 'blocks', chars: ['△', '○', '□', '+', '·', '%'] },
  '/goals': { icon: Target, hue: 'var(--tone-green)', motif: 'rings', chars: ['◎', '◌', '·', '+', '%', '·'] },
  '/data': { icon: Database, hue: 'var(--tone-slate)', motif: 'matrix', chars: ['01', '10', '·', '+', '%', '·'] },
  '/settings': { icon: Settings, hue: 'var(--tone-stone)', motif: 'gears', chars: ['◎', '✧', '·', '+', '%', '◌'] },
};

const FALLBACK = ATMOSPHERES['/'];

/** 每个栏目一层低透明度动态背景，固定定位、不拦截鼠标，配色跟随栏目色相。 */
export function PageAtmosphere() {
  const { pathname } = useLocation();
  const atmosphere = ATMOSPHERES[pathname] ?? FALLBACK;
  const Icon = atmosphere.icon;

  return (
    <div
      key={pathname}
      className="page-atmosphere"
      data-motif={atmosphere.motif}
      style={{ '--atmo-hue': atmosphere.hue } as CSSProperties}
      aria-hidden="true"
    >
      <span className="atmo-orb atmo-orb-a" />
      <span className="atmo-orb atmo-orb-b" />
      <span className="atmo-mark">
        <Icon size={280} strokeWidth={0.65} />
      </span>
      {atmosphere.chars.map((char, index) => (
        <span key={index} className={`atmo-float atmo-float-${index + 1}`}>{char}</span>
      ))}
      <span className="atmo-sweep" />
    </div>
  );
}