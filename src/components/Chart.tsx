import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { cn } from './ui';

function motionScale(): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--site-motion').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** 合并默认入场动画：逐条生长 + 平滑缓动，尊重 --site-motion 与减弱动态设置。 */
function withMotion(option: EChartsOption): EChartsOption {
  const scale = motionScale();
  return {
    ...option,
    animationDuration: option.animationDuration ?? 480 * scale,
    animationDurationUpdate: option.animationDurationUpdate ?? 320 * scale,
    animationEasing: option.animationEasing ?? 'cubicOut',
    animationDelay: option.animationDelay ?? ((idx: number) => idx * 32 * scale),
  };
}

export function EChart({
  option,
  height = 280,
  ariaLabel,
  className,
}: {
  option: EChartsOption;
  height?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.setOption(withMotion(option));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // 初始化只执行一次，后续通过下一段 effect 更新 option
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(withMotion(option), true);
  }, [option]);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={cn('chart-enter', className)} style={{ width: '100%', height }} />;
}