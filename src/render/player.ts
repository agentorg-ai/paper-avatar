import { cancelled, clamp, createSurface, type Frame } from './surface.js';
import type { BakedPortrait, PlaybackOptions, PortraitHandle } from './types.js';
export type { BakedPortrait, PlaybackOptions, PortraitHandle } from './types.js';

export interface Sheet {
  image: CanvasImageSource;
  columns: number;
  rows: number;
  width: number;
  height: number;
}

export function drawSheet(ctx: CanvasRenderingContext2D, sheet: Sheet, frame: Frame) {
  const column = Math.round((clamp(frame.x, -1, 1) + 1) * 0.5 * (sheet.columns - 1));
  const row = Math.round((1 - clamp(frame.y, -1, 1)) * 0.5 * (sheet.rows - 1));
  const fit = Math.min(frame.width / sheet.width, frame.height / sheet.height);
  const width = sheet.width * fit,
    height = sheet.height * fit;
  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    sheet.image,
    column * sheet.width,
    row * sheet.height,
    sheet.width,
    sheet.height,
    (frame.width - width) / 2,
    (frame.height - height) / 2,
    width,
    height
  );
}

function validate(baked: BakedPortrait) {
  const { version, mode, columns, rows, width, height, image } = baked;
  const picture =
    mode === 'picture' && columns === rows && columns >= 3 && columns <= 9 && columns % 2 === 1;
  const still = mode === 'static' && columns === 1 && rows === 1;
  if (
    version !== 1 ||
    !(picture || still) ||
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0 ||
    width * columns > 4096 ||
    height * rows > 4096 ||
    width * columns * height * rows > 8_388_608 ||
    typeof image !== 'string' ||
    !image
  ) {
    throw new TypeError('Invalid version-1 baked portrait.');
  }
}

/** Mount an exported still or atlas. This player uses only Canvas 2D. */
export function mountBakedPortrait(
  host: HTMLElement,
  baked: BakedPortrait,
  options: PlaybackOptions = {}
): PortraitHandle {
  validate(baked);
  const image = host.ownerDocument.createElement('img');
  const sheet: Sheet = { ...baked, image };
  const surface = createSurface(host, options, baked.mode === 'picture', false, (frame) =>
    drawSheet(ctx!, sheet, frame)
  );
  const ctx = surface.canvas.getContext('2d');
  if (!ctx) {
    surface.dispose();
    throw new Error('The baked portrait needs a Canvas 2D context.');
  }
  let rejectReady: ((reason: unknown) => void) | undefined;
  let disposed = false;
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    image.onload = () => {
      if (disposed) return;
      if (
        image.naturalWidth !== baked.columns * baked.width ||
        image.naturalHeight !== baked.rows * baked.height
      ) {
        reject(new Error('The image dimensions do not match the baked portrait metadata.'));
        return;
      }
      surface.present();
      resolve();
    };
    image.onerror = () => reject(new Error('Could not load the baked portrait image.'));
    image.src = baked.image;
  });
  // Libraries can be unmounted before a caller awaits ready.
  void ready.catch(() => {});
  return {
    canvas: surface.canvas,
    setGaze: surface.setGaze,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      rejectReady?.(cancelled());
      surface.dispose();
    }
  };
}
