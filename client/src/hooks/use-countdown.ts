import { useState, useEffect } from "react";

export const PAUSE_DURATION_MS = 20 * 60 * 1000;

export function useCountdown(breakStartedAt?: string) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!breakStartedAt) {
      setRemaining(null);
      return;
    }

    const endTime = new Date(breakStartedAt).getTime() + PAUSE_DURATION_MS;

    const tick = () => {
      const left = Math.max(0, endTime - Date.now());
      setRemaining(left);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [breakStartedAt]);

  return remaining;
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}
