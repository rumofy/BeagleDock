/**
 * Groups high-frequency events into at most one flush per animation frame.
 * It never holds data past the next frame (~16 ms) and delivers every event, in order,
 * so the screen always shows the latest state without rendering on every token.
 */
/**
 * Schedules `cb` on the next animation frame, with a safety deadline: the browser pauses
 * `requestAnimationFrame` while the window is hidden or minimized, and the stream can't stop for that.
 */
export function createFrameScheduler(
  deps: {
    raf?: (cb: () => void) => unknown;
    setTimer?: (cb: () => void, ms: number) => unknown;
    clearTimer?: (id: unknown) => void;
    fallbackMs?: number;
  } = {},
) {
  const raf =
    deps.raf ??
    (typeof requestAnimationFrame === "function"
      ? (cb: () => void) => requestAnimationFrame(cb)
      : undefined);
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    deps.clearTimer ??
    ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const fallbackMs = deps.fallbackMs ?? 50;
  return (cb: () => void) => {
    let done = false;
    let timer: unknown;
    const once = () => {
      if (done) return;
      done = true;
      clearTimer(timer);
      cb();
    };
    timer = setTimer(once, raf ? fallbackMs : 16);
    raf?.(once);
  };
}

export function createFrameBatcher<T>(
  flush: (items: T[]) => void,
  schedule: (cb: () => void) => unknown = createFrameScheduler(),
) {
  let queue: T[] = [];
  let scheduled = false;
  const run = () => {
    scheduled = false;
    const items = queue;
    queue = [];
    if (items.length) flush(items);
  };
  return {
    push(item: T) {
      queue.push(item);
      if (!scheduled) {
        scheduled = true;
        schedule(run);
      }
    },
    /** Delivers whatever is pending right away (e.g. when the listener stops). */
    flushNow() {
      run();
    },
    pending: () => queue.length,
  };
}
