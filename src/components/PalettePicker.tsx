import { useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { PALETTES, getPaletteId, setPalette, type Palette, type PaletteId } from '../theme/palette';
import { cn } from './ui';

export function PalettePicker({
  compact = false,
  onChange,
}: {
  compact?: boolean;
  onChange?: (palette: Palette) => void;
}) {
  const [current, setCurrent] = useState<PaletteId>(() => getPaletteId());

  const choose = (palette: Palette) => {
    setPalette(palette.id);
    setCurrent(palette.id);
    onChange?.(palette);
  };

  if (compact) {
    return (
      <div className="palette-dots" role="group" aria-label="界面配色">
        {PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            className={cn('palette-dot', current === palette.id && 'is-active')}
            style={{ '--swatch-a': palette.accent, '--swatch-b': palette.secondary } as CSSProperties}
            onClick={() => choose(palette)}
            aria-label={`切换为${palette.name}配色`}
            aria-pressed={current === palette.id}
            title={`${palette.name} · ${palette.note}`}
            data-testid={`palette-${palette.id}`}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="palette-grid" role="group" aria-label="界面配色">
      {PALETTES.map((palette) => (
        <button
          key={palette.id}
          type="button"
          className={cn('palette-card', current === palette.id && 'is-active')}
          onClick={() => choose(palette)}
          aria-pressed={current === palette.id}
          data-testid={`palette-${palette.id}`}
        >
          <span
            className="palette-swatch"
            style={{ background: `linear-gradient(135deg, ${palette.accent} 0 58%, ${palette.secondary} 58% 100%)` }}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold">{palette.name}</span>
            <span className="block truncate text-[10.5px] text-[#8A887F]">{palette.note}</span>
          </span>
          {current === palette.id && <Check size={14} className="ml-auto shrink-0 text-[var(--accent)]" />}
        </button>
      ))}
    </div>
  );
}