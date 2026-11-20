export type DisplayMode = 'static' | 'picture' | 'live';
export type ReducedMotion = 'system' | 'always' | 'never';

export interface CameraOptions {
  /** Face-and-shoulders crop or the entire folded bust. Defaults to bust. */
  framing?: 'portrait' | 'bust';
  /** Offset from the frame center, in fractions of its width/height. Positive is right/up. */
  position?: { x?: number; y?: number };
  /** Magnification relative to the chosen crop. Defaults to 1. */
  zoom?: number;
  /** Head direction at rest in world-space degrees. The camera faces the model at 0°. */
  neutralYaw?: number;
  /** Upward resting angle of the head in degrees. */
  neutralPitch?: number;
  /** Maximum horizontal head travel to either side of neutral, in degrees. Default 25. */
  headYawRange?: number;
  /** Maximum vertical travel above or below neutral, in degrees. Default 8. */
  headPitchRange?: number;
  /** Shoulder rotation to either side of neutral, in degrees. Default 1.5. */
  bodyYawRange?: number;
}

export interface PlaybackOptions {
  interactive?: boolean;
  /** Reduced motion removes easing and autonomous motion. Explicit gaze input remains available. */
  reducedMotion?: ReducedMotion;
  /** Backing canvas pixel ratio. Defaults to devicePixelRatio with a ceiling of 2. */
  pixelRatio?: number;
  /** CSS background color, transparent by default. */
  background?: string;
  label?: string;
}

export interface PortraitOptions extends CameraOptions, PlaybackOptions {
  mode?: DisplayMode;
  /** Subtle autonomous movement in live mode. Defaults to true. */
  idle?: boolean;
  /** Number of gaze samples per axis in picture mode. Integers from 3 to 32, default 8. */
  atlasGrid?: number;
}

export interface BakeOptions extends CameraOptions {
  mode?: 'static' | 'picture';
  /** Pixel dimensions of a frame before applying the atlas safety limits. */
  width?: number;
  height?: number;
  /** Directional samples per axis for this bake, 3–32. Default 8. */
  atlasGrid?: number;
  /** Fill baked pixels with this CSS color, or leave them transparent. */
  background?: string;
  signal?: AbortSignal;
}

export interface BakedPortrait {
  readonly version: 1;
  readonly mode: 'static' | 'picture';
  /** PNG data URL returned by bakePortrait, or a URL to the same PNG on a server. */
  readonly image: string;
  readonly columns: number;
  readonly rows: number;
  /** Width and height of one frame in pixels. */
  readonly width: number;
  readonly height: number;
}

export interface PortraitHandle {
  readonly canvas: HTMLCanvasElement;
  /** Resolves after the still, interactive atlas or first live frame is ready. */
  readonly ready: Promise<void>;
  /** Horizontal and vertical input from -1 to 1. Positive values look right/up. */
  setGaze(x: number, y: number): void;
  /** Removes the canvas and releases input listeners, animation and render resources. */
  dispose(): void;
}
