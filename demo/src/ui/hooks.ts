/** 轻量周期重渲染（用于倒计时/进度条时钟）。 */
import { useEffect, useState } from 'react';

export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}
