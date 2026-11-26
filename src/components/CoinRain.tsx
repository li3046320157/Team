import { useEffect, useRef } from 'react';

interface Drop {
  x: number;
  y: number;
  vy: number;
  vx: number;
  size: number;
  spin: number;
  spinRate: number;
  windFactor: number;
  phase: number;
  alpha: number;
}

const TAU = Math.PI * 2;
const SPRITE_SIZE = 64;

function buildCoinSprite(): HTMLCanvasElement {
  const sprite = document.createElement('canvas');
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const ctx = sprite.getContext('2d');
  if (!ctx) return sprite;
  const c = SPRITE_SIZE / 2;
  const r = c - 2;

  const face = ctx.createLinearGradient(0, 2, SPRITE_SIZE, SPRITE_SIZE - 2);
  face.addColorStop(0, '#fff0b8');
  face.addColorStop(0.34, '#f6d876');
  face.addColorStop(0.68, '#dcae34');
  face.addColorStop(1, '#b0821c');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.fill();

  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(122, 84, 12, 0.55)';
  ctx.beginPath();
  ctx.arc(c, c, r * 0.74, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 246, 205, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(c, c, r * 0.9, Math.PI * 1.06, Math.PI * 1.62);
  ctx.stroke();

  ctx.fillStyle = 'rgba(108, 76, 12, 0.85)';
  ctx.font = '700 26px "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('¥', c, c + 1);
  return sprite;
}

function spawn(width: number, height: number, windBias = 0, seedTop = false): Drop {
  const size = 3.6 + Math.random() * 5.2;
  const biased = -30 + Math.random() * (width + 60) - windBias * width * 0.38;
  return {
    x: Math.max(-30, Math.min(width + 30, biased)),
    y: seedTop ? -size * 2 - Math.random() * height * 0.45 : -size * 2 - Math.random() * 200,
    vy: 55 + Math.random() * 115,
    vx: 0,
    size,
    spin: Math.random() * TAU,
    spinRate: (0.9 + Math.random() * 2.8) * (Math.random() < 0.5 ? -1 : 1),
    windFactor: 0.55 + Math.random() * 0.85,
    phase: Math.random() * TAU,
    alpha: 0.32 + Math.random() * 0.58,
  };
}

/** 顶部金币雨：颗粒小、数量多，鼠标偏向哪一侧，风向就把金币带向哪一侧。 */
export function CoinRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sprite = buildCoinSprite();

    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    let pointerX = 0;
    let wind = 0;
    let drops: Drop[] = [];
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(Math.min(240, Math.max(110, width / 6)));
      if (drops.length > target) drops.length = target;
      const firstFill = drops.length === 0;
      while (drops.length < target) {
        const drop = spawn(width, height, 0, true);
        if (firstFill) drop.y = -height * 0.1 + Math.random() * height;
        drops.push(drop);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
    };
    const onPointerLeave = () => {
      pointerX = 0;
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const reduce = document.documentElement.dataset.motion === 'reduced';
      const speed = reduce ? 0.55 : 1;

      wind += (pointerX * 250 - wind) * Math.min(1, dt * 2.4);
      const gust = Math.sin(now * 0.00042) * 22;

      ctx.clearRect(0, 0, width, height);
      for (const drop of drops) {
        drop.vy += (40 - drop.vy * 0.04) * dt * speed;
        drop.vx += (wind * drop.windFactor + gust - drop.vx) * Math.min(1, dt * 1.8);
        drop.x += drop.vx * dt * speed;
        drop.y += drop.vy * dt * speed;
        drop.spin += drop.spinRate * dt * speed;

        const out = drop.y - drop.size > height || drop.x < -drop.size * 3 || drop.x > width + drop.size * 3;
        if (out) {
          const next = spawn(width, height, pointerX);
          next.y = -next.size * 2 - Math.random() * 90;
          Object.assign(drop, next);
          continue;
        }

        const squash = Math.cos(drop.spin);
        const ellipse = Math.max(0.12, Math.abs(squash));
        const rx = drop.size * ellipse;
        const ry = drop.size;
        ctx.save();
        ctx.globalAlpha = drop.alpha * (0.55 + ellipse * 0.45);
        ctx.translate(drop.x + Math.sin(now * 0.0011 + drop.phase) * 6, drop.y);
        if (Math.abs(squash) < 0.16) {
          ctx.lineWidth = Math.max(1, drop.size * 0.2);
          ctx.strokeStyle = 'rgba(173, 128, 30, 0.9)';
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(0.6, rx), ry * 0.94, 0, 0, TAU);
          ctx.stroke();
        } else {
          ctx.drawImage(sprite, -rx, -ry, rx * 2, ry * 2);
        }
        ctx.restore();
      }
      raf = window.requestAnimationFrame(step);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    raf = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      drops = [];
    };
  }, []);

  return <canvas ref={canvasRef} className="coin-rain" aria-hidden="true" data-testid="coin-rain" />;
}