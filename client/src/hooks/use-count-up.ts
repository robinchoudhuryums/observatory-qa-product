import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 to `end` over `duration` ms using requestAnimationFrame.
 * Returns the current animated value as a number.
 * Only runs the animation once on mount (or when `end` changes).
 */
export function useCountUp(end: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const prevEnd = useRef(0);

  useEffect(() => {
    if (end === prevEnd.current) return;
    const start = prevEnd.current;
    prevEnd.current = end;

    if (duration <= 0) {
      setValue(end);
      return;
    }

    let raf: number;
    const t0 = performance.now();

    const tick = (now: number) => {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic for a satisfying deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(start + (end - start) * eased);

      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [end, duration]);

  return value;
}
