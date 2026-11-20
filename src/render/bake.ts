import type { AvatarRecipe } from '../identity.js';
import type { BakeOptions, BakedPortrait } from './types.js';
import { gazeAtTile, pictureGrid } from './atlas.js';
import { acquireStudio } from './studio.js';
import { cancelled, clamp, finite, untilAborted } from './surface.js';
import type { Sheet } from './player.js';

function dimensions(options: BakeOptions) {
  const grid = options.mode === 'picture'
    ? clamp(Math.round(finite(options.atlasGrid, pictureGrid.default)), pictureGrid.min, pictureGrid.max)
    : 1;
  const rawWidth = clamp(Math.round(finite(options.width, 256)), 1, 2048);
  const rawHeight = clamp(Math.round(finite(options.height, 256)), 1, 2048);
  const scale = Math.min(
    1,
    4096 / (rawWidth * grid),
    4096 / (rawHeight * grid),
    Math.sqrt(8_388_608 / (rawWidth * rawHeight * grid * grid))
  );
  return {
    columns: grid,
    rows: grid,
    width: Math.max(1, Math.floor(rawWidth * scale)),
    height: Math.max(1, Math.floor(rawHeight * scale))
  };
}

// Serializing GPU bakes caps transient atlas memory during roster mounts. Yield
// after small batches so input and live portraits can render between samples.
let previous: Promise<void> = Promise.resolve();
export function bakeSheet(
  recipe: AvatarRecipe,
  options: BakeOptions,
  centerReady?: (sheet: Sheet) => void
) {
  const run = previous.then(async () => {
    const signal = options.signal;
    const check = () => {
      if (signal?.aborted) throw signal.reason ?? cancelled();
    };
    check();
    const lease = acquireStudio(recipe);
    try {
      const studio = await lease.ready;
      check();
      const { columns, rows, width, height } = dimensions(options);
      const image = document.createElement('canvas');
      image.width = width * columns;
      image.height = height * rows;
      const ctx = image.getContext('2d');
      if (!ctx) throw new Error('Could not allocate a Canvas 2D portrait sheet.');
      if (options.background) {
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, image.width, image.height);
      }
      const sheet = { image, width, height, columns, rows };
      const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
      function render(index: number) {
        const col = index % columns,
          row = Math.floor(index / columns);
        const x = gazeAtTile(col, columns);
        const y = -gazeAtTile(row, rows);
        const source = studio.draw(
          recipe,
          options,
          { x, y, width, height, reduced: true, seconds: 0 },
          false
        );
        ctx!.drawImage(source, col * width, row * height);
      }
      render(center);
      centerReady?.(sheet);
      let started = performance.now();
      for (let index = 0; index < rows * columns; index++) {
        if (index === center) continue;
        if (performance.now() - started >= 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          started = performance.now();
        }
        check();
        render(index);
      }
      check();
      return sheet;
    } finally {
      lease.release();
    }
  });
  previous = run.then(
    () => {},
    () => {}
  );
  return untilAborted(run, options.signal);
}

/** Render a portable PNG. A picture atlas stores looking up in row zero. */
export async function bakePortrait(
  recipe: AvatarRecipe,
  options: BakeOptions = {}
): Promise<BakedPortrait> {
  const { image, ...layout } = await bakeSheet(recipe, options);
  try {
    return {
      version: 1,
      mode: options.mode === 'picture' ? 'picture' : 'static',
      ...layout,
      image: image.toDataURL('image/png')
    };
  } finally {
    image.width = image.height = 1;
  }
}
