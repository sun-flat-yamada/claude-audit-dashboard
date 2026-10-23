/**
 * Replaced pacing clock (virtual time): `sleep` resolves when the virtual time reaches its due
 * time, the earliest first, once every pending promise has settled. Nothing waits for real.
 */
export function fakeTimer() {
  const timer = { t: 0, slept: [] as number[] };
  const pending: { due: number; resolve: () => void }[] = [];
  let scheduled = false;
  const advance = () => {
    scheduled = false;
    pending.sort((a, b) => a.due - b.due);
    const next = pending.shift();
    if (!next) return;
    timer.t = Math.max(timer.t, next.due);
    next.resolve();
    if (pending.length > 0) schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(advance);
  };
  return {
    timer,
    timing: {
      now: () => timer.t,
      sleep: (ms: number) =>
        new Promise<void>((resolve) => {
          timer.slept.push(ms);
          pending.push({ due: timer.t + ms, resolve });
          schedule();
        }),
    },
  };
}
