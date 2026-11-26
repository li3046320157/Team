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

function spawn(width: number, height: number, seedTop = false): Drop {
  const size = 5 + Math.random() * 7;
  return {
    x: -20 + Math.random() * (width + 40),
    y: seedTop ? -size * 2 - Math.random() * height * 0.35 : -size * 2 - Math.random() * 160,
    vy: 42 + Math.random() * 95,
    vx: 0,
    size,
    spin: Math.random() * TAU,
    spinRate: (0.8 + Math.random() * 2.4) * (Math.random() < 0.5 ? -1 : 1),
    windFactor: 0.65 + Math.random() * 0.8,
    phase: Math.random() * TAU,
    alpha: 0.3 + Math.random() * 0.55,
  };
}

function drawCoin(ctx: CanvasRenderingContext2D, drop: Drop, time: number) {
  const squash = Math.cos(drop.spin);
  const rx = Math.max(0.8, Math.abs(squash) * drop.size);
  const ry = drop.size;
  ctx.save();
  ctx.translate(drop.x + Math.sin(time * 0.0011 + drop.phase) * 7, drop.y);
  ctx.globalAlpha = drop.alpha;

  const grad = ctx.createLinearGradient(-rx, -ry, rx, ry);
  grad.addColorStop(0, '#fbe9a4');
  grad.addColorStop(0.42, '#f2cf62');
  grad.addColorStop(0.72, '#d9a92c');
  grad.addColorStop(1, '#b8871f');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();

  if (Math.abs(squash) > 0.32) {
    ctx.lineWidth = Math.max(0.7, drop.size * 0.08);
    ctx.strokeStyle = 'rgba(122, 84, 12, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(0.6, rx * 0.72), ry * 0.72, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(110, 78, 12, 0.82)';
    ctx.font = `700 ${Math.max(5, drop.size * 0.95)}px "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = drop.alpha * Math.min(1, Math.abs(squash) * 1.4);
    ctx.fillText('¥', 0, drop.size * 0.04);
  } else {
    ctx.lineWidth = Math.max(1.4, drop.size * 0.22);
    ctx.strokeStyle = 'rgba(173, 128, 30, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.9, ry * 0.94, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** 顶部金币雨：数量多、颗粒小，鼠标偏向哪一侧，风向就把金币带向哪一侧。 */
export function CoinRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
      const target = Math.round(Math.min(150, Math.max(64, width / 9)));
      if (drops.length > target) drops.length = target;
      while (drops.length < target) drops.push(spawn(width, height, true));
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

      wind += (pointerX * 280 - wind) * Math.min(1, dt * 2.4);
      const gust = Math.sin(now * 0.00042) * 26;

      ctx.clearRect(0, 0, width, height);
      for (const drop of drops) {
        drop.vy += (34 - drop.vy * 0.04) * dt * speed;
        drop.vx += (wind * drop.windFactor + gust - drop.vx) * Math.min(1, dt * 1.6);
        drop.x += drop.vx * dt * speed;
        drop.y += drop.vy * dt * speed;
        drop.spin += drop.spinRate * dt * speed;

        const out = drop.y - drop.size > height || drop.x < -drop.size * 3 || drop.x > width + drop.size * 3;
        if (out) {
          const next = spawn(width, height);
          next.y = -next.size * 2 - Math.random() * 120;
          Object.assign(drop, next);
        } else {
          drawCoin(ctx, drop, now);
        }
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