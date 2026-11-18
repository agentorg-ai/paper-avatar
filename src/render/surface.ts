import type { PlaybackOptions } from './types.js';

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const finite = (n: number | undefined, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback;
export const cancelled = () => new DOMException('Portrait disposed or bake cancelled', 'AbortError');

/** Settle an unmounted consumer immediately while the shared GPU job winds down. */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason ?? cancelled());
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      }
    );
  });
}

export interface Frame {
  x: number;
  y: number;
  seconds: number;
  reduced: boolean;
  width: number;
  height: number;
}

export function createSurface(
  host: HTMLElement,
  options: PlaybackOptions,
  moving: boolean,
  idle: boolean,
  paint: (frame: Frame) => void
) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error('Mount the portrait in a browser document.');
  const canvas = doc.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  if (options.background) canvas.style.backgroundColor = options.background;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.label ?? 'Folded-paper avatar');
  host.append(canvas);

  const abort = new win.AbortController();
  const listeners = { signal: abort.signal };
  const preference = win.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () =>
    options.reducedMotion === 'always' || (options.reducedMotion !== 'never' && preference.matches);
  const ratio = clamp(finite(options.pixelRatio, Math.min(2, win.devicePixelRatio || 1)), 0.25, 3);
  let active = false,
    visible = true,
    disposed = false;
  let frameId = 0,
    previous = 0,
    x = 0,
    y = 0,
    tx = 0,
    ty = 0;
  let width = 1,
    height = 1;
  const start = win.performance.now();

  function measure() {
    const bounds = host.getBoundingClientRect();
    const w = Math.max(1, host.clientWidth || bounds.width || 128);
    const h = Math.max(1, host.clientHeight || bounds.height || w);
    const factor = Math.min(ratio, 2048 / w, 2048 / h);
    width = Math.max(1, Math.round(w * factor));
    height = Math.max(1, Math.round(h * factor));
    invalidate();
  }
  function invalidate() {
    if (!frameId && active && visible && !doc.hidden && !disposed) {
      frameId = win!.requestAnimationFrame(draw);
    }
  }
  function render(time: number) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    paint({ x, y, seconds: (time - start) / 1000, reduced: reduced(), width, height });
  }
  function draw(time: number) {
    frameId = 0;
    if (disposed || !active || doc.hidden || !visible) return;
    const delta = previous ? clamp((time - previous) / 1000, 0, 0.1) : 1 / 60;
    previous = time;
    const blend = reduced() ? 1 : 1 - Math.exp(-14 * delta);
    x += (tx - x) * blend;
    y += (ty - y) * blend;
    if (Math.abs(x - tx) < 0.001) x = tx;
    if (Math.abs(y - ty) < 0.001) y = ty;
    render(time);
    if (x !== tx || y !== ty || (idle && !reduced())) invalidate();
    else previous = 0;
  }
  function setGaze(horizontal: number, vertical: number) {
    if (!moving || disposed) return;
    tx = clamp(finite(horizontal, 0), -1, 1);
    ty = clamp(finite(vertical, 0), -1, 1);
    invalidate();
  }
  function track(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      setGaze(
        (2 * (event.clientX - rect.left)) / rect.width - 1,
        1 - (2 * (event.clientY - rect.top)) / rect.height
      );
    }
  }
  if (moving && options.interactive !== false) {
    canvas.tabIndex = 0;
    canvas.addEventListener('pointermove', track, listeners);
    canvas.addEventListener('pointerdown', track, listeners);
    canvas.addEventListener(
      'pointerleave',
      (event) => {
        if (event.pointerType !== 'touch') setGaze(0, 0);
      },
      listeners
    );
    canvas.addEventListener('pointercancel', () => setGaze(0, 0), listeners);
    canvas.addEventListener('blur', () => setGaze(0, 0), listeners);
    canvas.addEventListener(
      'keydown',
      (event) => {
        const offsets: Record<string, [number, number]> = {
          ArrowLeft: [-0.25, 0],
          ArrowRight: [0.25, 0],
          ArrowUp: [0, 0.25],
          ArrowDown: [0, -0.25]
        };
        if (event.key === 'Home' || event.key === 'Escape') {
          event.preventDefault();
          setGaze(0, 0);
        } else if (offsets[event.key]) {
          const [dx, dy] = offsets[event.key]!;
          event.preventDefault();
          setGaze(tx + dx, ty + dy);
        }
      },
      listeners
    );
  }
  const resize = new win.ResizeObserver(measure);
  resize.observe(host);
  const intersection =
    typeof win.IntersectionObserver === 'function'
      ? new win.IntersectionObserver((records) => {
          visible = records.some((r) => r.isIntersecting);
          if (visible) invalidate();
        })
      : undefined;
  intersection?.observe(host);
  doc.addEventListener('visibilitychange', invalidate, listeners);
  preference.addEventListener('change', invalidate, listeners);
  measure();

  return {
    canvas,
    setGaze,
    get size() {
      return { width, height };
    },
    // Paint the first frame even for a hidden host so ready also works for preloading.
    present() {
      if (disposed) return;
      active = true;
      render(win.performance.now());
      invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      resize.disconnect();
      intersection?.disconnect();
      if (frameId) win.cancelAnimationFrame(frameId);
      canvas.remove();
      canvas.width = canvas.height = 1;
    }
  };
}
