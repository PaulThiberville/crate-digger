import { useEffect, useState } from 'react';

/** Re-render at a fixed rate (views read mutable stats objects updated by the core). */
export function useTick(ms = 100): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}
