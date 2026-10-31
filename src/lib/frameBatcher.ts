/**
 * Agrupa eventos de alta frequência em, no máximo, um flush por quadro de animação.
 * Não segura dados além do próximo quadro (~16 ms) e entrega todos os eventos, em ordem,
 * então a tela sempre reflete o estado mais recente sem renderizar a cada token.
 */
/**
 * Agenda `cb` no próximo quadro de animação, com prazo de segurança: o navegador pausa
 * `requestAnimationFrame` com a janela oculta ou minimizada, e o stream não pode parar por isso.
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
    /** Entrega imediatamente o que estiver pendente (ex.: ao encerrar a escuta). */
    flushNow() {
      run();
    },
    pending: () => queue.length,
  };
}
