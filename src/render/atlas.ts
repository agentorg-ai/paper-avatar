/** Supported directional samples per axis. Atlas images also have a separate pixel budget. */
export const pictureGrid = Object.freeze({ min: 3, max: 32, default: 8 } as const);

// The tile at floor(count / 2) stores the exact resting pose, including on
// even grids. Each half spans the full travel from rest to its own endpoint.
export function gazeAtTile(tile: number, count: number): number {
  if (count === 1) return 0;
  const center = Math.floor(count / 2);
  const steps = tile < center ? center : count - 1 - center;
  return (tile - center) / steps;
}

export function tileAtGaze(gaze: number, count: number): number {
  const center = Math.floor(count / 2);
  const steps = gaze < 0 ? center : count - 1 - center;
  const value = Math.max(-1, Math.min(1, gaze));
  return Math.round(center + value * steps);
}
