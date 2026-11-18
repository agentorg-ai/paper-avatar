# Paper Avatar

A TypeScript library for AgentOrg’s folded-paper people. One versioned string describes a character’s face color, hairstyle, hair color, outfit, clothing color and accessory. Render that identity as a still, a direction-aware picture, or an articulated 3D portrait.

![Three portraits rendered with different paper folds, garments and hair textures](https://raw.githubusercontent.com/uniac-dev/paper-avatar/v0.1.0/docs/portraits.png)

[Download the interactive workshop](https://github.com/uniac-dev/paper-avatar/releases/download/v0.1.0/paper-avatar-workshop.html) and open the HTML file in a WebGL 2 browser. The artwork and textures are embedded. Try the same character in all three modes, change the shoulder and head ranges separately, then copy its string.

## Install

Install the compiled ESM package and TypeScript declarations from the GitHub release.

```sh
npm install https://github.com/uniac-dev/paper-avatar/releases/download/v0.1.0/uniac-dev-paper-avatar-0.1.0.tgz
```

The core works with a sized HTML element. React 18 and 19 applications can use the optional React entry point.

```ts
import { generateAvatar, mountAvatar } from '@uniac-dev/paper-avatar';

const id = generateAvatar('agent-42');
const portrait = mountAvatar(document.querySelector<HTMLElement>('#profile')!, id, {
  mode: 'live',
  framing: 'portrait',
  neutralYaw: -20,
  headYawRange: 24,
  headPitchRange: 8,
  bodyYawRange: 2,
  position: { x: 0, y: -0.04 },
  zoom: 1.05,
  label: 'Agent portrait'
});
await portrait.ready;
// In the component's teardown:
portrait.dispose();
```

## Identity

```ts
import { DEFAULT_AVATAR, encodeAvatar, generateAvatar, parseAvatar } from '@uniac-dev/paper-avatar/identity';

const assigned = generateAvatar('agent-42');  // Repeatable across machines.
const shuffled = generateAvatar();           // New random draw from the built-in palette.
const custom = encodeAvatar({ ...parseAvatar(DEFAULT_AVATAR), hair: 'curls', clothColor: '#285e62' });
// pa1.jacket.curls.none.e49a49.464965.285e62
```

The six fields after `pa1` are outfit, hair, accessory, skin color, hair color and clothing color. Colors are six-digit sRGB. The built-in catalog supplies 23,040 combinations. You can supply your own dyes. Seeded generation draws from a finite catalog, so two agents can share a look. Store the string alongside the agent’s own ID. Framing and motion belong to each display.

`avatarOptions` exposes labeled choices for all six fields. `parseAvatar` also accepts complete IDs from the original workshop such as `o-jacket.h-curls.a-earrings.s-e49a49.p-d9d1bf.c-cb4533`. Pass the result to `encodeAvatar` to migrate it. Invalid and unsupported IDs throw. The identity entry can run in Node, a browser, or during server rendering.

## Display modes

| Mode | Appearance and input | Runtime |
| --- | --- | --- |
| `static` (default) | One neutral frame for lists and badges | Mounting from an ID bakes a still. A saved PNG works in an ordinary image element. |
| `picture` | Pointer, touch, arrow keys or `setGaze(x, y)` choose a frame from a directional image | Mounting from an ID bakes an atlas. A saved atlas plays using Canvas 2D alone. |
| `live` | Continuous head and shoulder rotation, with optional idle motion | Uses a shared Three.js/WebGL 2 studio. Offscreen portraits pause their animation loop. |

Each mount returns `canvas`, `ready`, `setGaze(x, y)` and `dispose()`. Input ranges from −1 to +1, with positive values looking right or up. Home or Escape returns an interactive portrait to neutral. Dispose the previous handle before mounting a replacement. Disposing an unfinished mount cancels its readiness promise with an `AbortError`.

| Option | Meaning |
| --- | --- |
| `framing`, `zoom` | `'bust'` or `'portrait'`. A zoom of 1 preserves the chosen crop. |
| `position: { x, y }` | Offset in fractions of the frame. Positive x moves right and positive y moves up. |
| `neutralYaw`, `neutralPitch` | Resting angles in degrees. A yaw of 0 faces the camera. |
| `headYawRange`, `headPitchRange` | Maximum travel to each side of neutral, in degrees. Defaults are 25° horizontal and 8° vertical. |
| `bodyYawRange` | Shoulder rotation to either side, default 1.5°. Use 0 to hold the body still. |
| `atlasGrid` | Number of sampled directions per axis in picture mode. Choose 3, 5, 7 or 9. Default is 5. |
| `interactive`, `idle` | Enable pointer/keyboard handling and autonomous live motion independently. Programmatic gaze works with interaction disabled. |
| `reducedMotion` | `'system'` (default), `'always'` or `'never'`. Reduced motion removes easing and idle movement. |
| `background`, `pixelRatio`, `label` | CSS backdrop color (default transparent), backing resolution, and accessible image name. |

## Bake once for an AgentOrg roster

From a source checkout, generate a neutral PNG, a directional PNG and an `avatar.json` manifest. The still is the center frame of the atlas. Filenames include a content hash so a new bake can be published alongside existing cached images.

```sh
npm ci
npx playwright install chromium
npm run bake -- --seed agent-42 --size 160 --grid 5 --out ./avatars/agent-42
```

Use `--avatar <string>` for an existing identity. Use `--view camera.json` for a JSON object with camera settings such as `{"framing":"portrait","neutralYaw":-20,"headYawRange":30}`. Width and height in the manifest give the actual tile size after the atlas limits are applied. This authoring command renders in headless Chromium and can run in CI.

The library also exposes the same pipeline in a WebGL 2 browser. `bakeAvatar(id, { mode: 'picture', width: 128, height: 128 })` returns a JSON-serializable atlas with an embedded PNG. Use `mode: 'static'` for a single frame. A bake accepts an optional `AbortSignal`. The 2D player has its own entry point for clients that receive precomputed artwork.

```ts
import { mountBakedPortrait, type BakedPortrait } from '@uniac-dev/paper-avatar/player';

const url = new URL('/avatars/agent-42/avatar.json', location.href);
const response = await fetch(url);
if (!response.ok) throw new Error('Could not load the portrait.');
const data: BakedPortrait & { poster: string } = await response.json();
const badge = document.querySelector<HTMLImageElement>('#sidebar-avatar')!;
badge.src = new URL(data.poster, url).href;
const profile = mountBakedPortrait(document.querySelector<HTMLElement>('#profile')!,
  { ...data, image: new URL(data.image, url).href }, { label: 'Agent profile' });
await profile.ready;
```

AgentOrg can use the neutral PNG for its 28 px roster badge, the atlas for its 88 px interactive profile, and live mode in its editor. Keep application state indicators on the surrounding shell component.

## React

```tsx
import { LiveAvatar, PictureAvatar, StaticAvatar } from '@uniac-dev/paper-avatar/react';

function AgentPortraits({ avatar }: { avatar: string }) {
  return <>
    <StaticAvatar avatar={avatar} size={28} framing="portrait" label="Roster portrait" />
    <PictureAvatar avatar={avatar} size={88} framing="portrait" label="Agent profile" />
    <LiveAvatar avatar={avatar} size={320} headYawRange={32} bodyYawRange={1} label="Editor portrait" />
  </>;
}
```

`PaperAvatar` (also exported as `Avatar`) accepts a `mode` prop. `BakedAvatar` takes a `portrait` descriptor from a previous bake. Components expose `onReady`, `onError` and `fallback`, and dispose their handles on unmount.

## Develop

Use Node 20.19+ or 22.12+. Run `npm ci`, then `npm run dev` to open the workshop locally at the printed URL. `npm test` builds the library and tests identity compatibility. After installing Chromium with Playwright, run `npm run test:browser` to test the renderers and React lifecycle. `npm run build:example` writes the self-contained workshop to `example/dist/index.html`.

Code and character models are MIT licensed. The scanned paper surfaces use Game Piggs’ CC0 *Paper 01*. [Asset credits and licenses](NOTICE.md)
