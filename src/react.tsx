import { useCallback, useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { mountAvatar } from './index.js';
import { mountBakedPortrait } from './render/player.js';
import type { BakedPortrait, PlaybackOptions, PortraitHandle, PortraitOptions } from './render/types.js';

interface SurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onError'> {
  /** Width and height in CSS pixels, or any CSS length. Override either dimension with style. */
  size?: number | string;
  fallback?: ReactNode;
  onReady?: (portrait: PortraitHandle) => void;
  onError?: (error: Error) => void;
}

function AvatarSurface({
  mount, size = 96, style, fallback = 'Portrait unavailable', onReady, onError, ...attributes
}: SurfaceProps & { mount: (element: HTMLElement) => PortraitHandle }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callbacks.current = { onReady, onError };
  }, [onReady, onError]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let handle: PortraitHandle | undefined;
    let active = true;
    setFailed(false);

    function report(reason: unknown): void {
      if (!active) return;
      setFailed(true);
      callbacks.current.onError?.(reason instanceof Error ? reason : new Error(String(reason)));
    }

    try {
      handle = mount(element);
      const current = handle;
      void current.ready.then(() => {
        if (active) callbacks.current.onReady?.(current);
      }, report);
    } catch (error) {
      report(error);
    }

    return () => {
      active = false;
      handle?.dispose();
    };
  }, [mount]);

  return (
    <div {...attributes} style={{ position: 'relative', width: size, height: size, ...style }}>
      <div ref={host} style={{ width: '100%', height: '100%', visibility: failed ? 'hidden' : 'visible' }} />
      {failed && <div style={{ position: 'absolute', inset: 0 }}>{fallback}</div>}
    </div>
  );
}

export interface AvatarProps extends PortraitOptions, SurfaceProps {
  /** A versioned avatar ID or a supported legacy workshop recipe. */
  avatar: string;
}

/** A server-renderable container. Painting and pointer handling begin after the client mounts. */
export function PaperAvatar({
  avatar, mode, framing, position, zoom, neutralYaw, neutralPitch, headYawRange, headPitchRange,
  bodyYawRange, interactive, idle, reducedMotion, pixelRatio, atlasGrid, background, label, ...props
}: AvatarProps): ReactElement {
  const x = position?.x;
  const y = position?.y;
  const mount = useCallback((host: HTMLElement) => mountAvatar(host, avatar, {
    mode, framing, position: { x, y }, zoom, neutralYaw, neutralPitch, headYawRange,
    headPitchRange, bodyYawRange, interactive, idle, reducedMotion, pixelRatio, atlasGrid,
    background, label,
  }), [avatar, mode, framing, x, y, zoom, neutralYaw, neutralPitch, headYawRange, headPitchRange,
    bodyYawRange, interactive, idle, reducedMotion, pixelRatio, atlasGrid, background, label]);
  return <AvatarSurface mount={mount} {...props} />;
}

export { PaperAvatar as Avatar };
export type FixedModeAvatarProps = Omit<AvatarProps, 'mode'>;

export function StaticAvatar(props: FixedModeAvatarProps): ReactElement {
  return <PaperAvatar {...props} mode="static" />;
}

export function PictureAvatar(props: FixedModeAvatarProps): ReactElement {
  return <PaperAvatar {...props} mode="picture" />;
}

export function LiveAvatar(props: FixedModeAvatarProps): ReactElement {
  return <PaperAvatar {...props} mode="live" />;
}

export interface BakedAvatarProps extends PlaybackOptions, SurfaceProps {
  portrait: BakedPortrait;
}

/** Display a precomputed still or directional atlas using Canvas 2D. */
export function BakedAvatar({
  portrait, interactive, reducedMotion, pixelRatio, background, label, ...props
}: BakedAvatarProps): ReactElement {
  const mount = useCallback((host: HTMLElement) => mountBakedPortrait(host, portrait, {
    interactive, reducedMotion, pixelRatio, background, label,
  }), [portrait, interactive, reducedMotion, pixelRatio, background, label]);
  return <AvatarSurface mount={mount} {...props} />;
}
