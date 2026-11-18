import { parseAvatar } from './identity.js';
import { bakePortrait, mountPortrait } from './render/index.js';
import type { BakeOptions, PortraitOptions } from './render/index.js';

export { DEFAULT_AVATAR, avatarOptions, encodeAvatar, generateAvatar, parseAvatar } from './identity.js';
export type { AvatarRecipe } from './identity.js';
export { mountBakedPortrait } from './render/player.js';
export type { BakedPortrait, BakeOptions, PortraitHandle, PortraitOptions } from './render/index.js';

/** Mount an avatar into a sized HTML element. Dispose the handle when removing it. */
export function mountAvatar(host: HTMLElement, id: string, options?: PortraitOptions) {
  return mountPortrait(host, parseAvatar(id), options);
}

/** Produce a serializable still or directional image atlas for delivery to a 2D player. */
export function bakeAvatar(id: string, options?: BakeOptions) {
  return bakePortrait(parseAvatar(id), options);
}
