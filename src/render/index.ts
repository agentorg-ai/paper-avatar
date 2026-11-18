import type { AvatarRecipe } from '../identity.js';
import type { PortraitOptions, PortraitHandle } from './types.js';
import { createSurface, cancelled, untilAborted } from './surface.js';
import { bakeSheet } from './bake.js';
import { drawSheet, type Sheet } from './player.js';
import { acquireStudio } from './studio.js';

export type * from './types.js';
export { bakePortrait } from './bake.js';
export { mountBakedPortrait } from './player.js';

/** Mount a decoded identity. Hosts supply the CSS dimensions of their portrait. */
export function mountPortrait(
  host: HTMLElement,
  recipe: AvatarRecipe,
  options: PortraitOptions = {}
): PortraitHandle {
  const mode = options.mode ?? 'static';
  const live = mode === 'live';
  const idle = live && options.idle !== false;
  const abort = new AbortController();
  let lease: ReturnType<typeof acquireStudio> | undefined;
  let studio: Awaited<ReturnType<typeof acquireStudio>['ready']> | undefined;
  let sheet: Sheet | undefined;
  let unfinished = true;

  const surface = createSurface(host, options, mode !== 'static', idle, (frame) => {
    if (studio) {
      const source = studio.draw(recipe, options, frame, idle);
      ctx!.clearRect(0, 0, frame.width, frame.height);
      ctx!.drawImage(source, 0, 0);
    } else if (sheet) {
      drawSheet(ctx!, sheet, unfinished ? { ...frame, x: 0, y: 0 } : frame);
    }
  });
  const ctx = surface.canvas.getContext('2d');
  if (!ctx) {
    surface.dispose();
    throw new Error('The portrait needs a Canvas 2D context.');
  }
  const ready = (async () => {
    try {
      if (live) {
        lease = acquireStudio(recipe);
        studio = await untilAborted(lease.ready, abort.signal);
      } else {
        const size = surface.size;
        // Mounted backgrounds belong to the surface. Only explicit image
        // exports flatten a background into the PNG's pixels.
        sheet = await bakeSheet(
          recipe,
          { ...options, mode, ...size, background: undefined, signal: abort.signal },
          (preview) => {
            if (abort.signal.aborted) return;
            sheet = preview;
            surface.present();
          }
        );
      }
      if (abort.signal.aborted) throw cancelled();
      unfinished = false;
      surface.present();
    } catch (error) {
      lease?.release();
      throw error;
    }
  })();
  void ready.catch(() => {});
  return {
    canvas: surface.canvas,
    setGaze: surface.setGaze,
    ready,
    dispose() {
      if (abort.signal.aborted) return;
      abort.abort();
      lease?.release();
      studio = undefined;
      sheet = undefined;
      surface.dispose();
    }
  };
}
