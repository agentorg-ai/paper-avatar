import {
  DEFAULT_AVATAR, avatarOptions, encodeAvatar, generateAvatar, mountAvatar, parseAvatar,
} from '../src/index.js';
import type { AvatarRecipe, PortraitHandle, PortraitOptions } from '../src/index.js';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing element ' + id);
  return node as T;
}

const stage = byId('stage');
const host = byId('portrait');
const renderStatus = byId('render-status');
const hint = byId('mode-hint');
const idStatus = byId('id-status');
const input = byId<HTMLInputElement>('avatar-id');
const apply = byId<HTMLButtonElement>('apply');
const copy = byId<HTMLButtonElement>('copy');
const crop = byId<HTMLSelectElement>('framing');
const parts = byId('parts');
const sliders = byId('sliders');
const preferences = [
  { key: 'neutralYaw', label: 'Resting angle', value: -30, min: -65, max: 65, step: 1, format: (v: number) => v + '°' },
  { key: 'headYawRange', label: 'Head turn', value: 25, min: 0, max: 55, step: .5, format: (v: number) => '±' + v + '°' },
  { key: 'headPitchRange', label: 'Head tilt', value: 8, min: 0, max: 24, step: 1, format: (v: number) => '±' + v + '°' },
  { key: 'bodyYawRange', label: 'Body turn', value: 1.5, min: 0, max: 18, step: .5, format: (v: number) => '±' + v + '°' },
  { key: 'zoom', label: 'Zoom', value: 1, min: .7, max: 1.65, step: .05, format: (v: number) => Math.round(v * 100) + '%' },
  { key: 'x', label: 'Horizontal', value: 0, min: -.25, max: .25, step: .01, format: (v: number) => Math.round(v * 100) + '%' },
  { key: 'y', label: 'Vertical', value: 0, min: -.25, max: .25, step: .01, format: (v: number) => Math.round(v * 100) + '%' },
] as const;
type RangeKey = (typeof preferences)[number]['key'];

let avatar = DEFAULT_AVATAR;
let mode: NonNullable<PortraitOptions['mode']> = 'live';
let portrait: PortraitHandle | undefined;
const ranges = new Map<RangeKey, HTMLInputElement>();
const partsControls = new Map<keyof AvatarRecipe, HTMLSelectElement | HTMLFieldSetElement>();
const labels = {
  outfit: 'Outfit', hair: 'Hairstyle', accessory: 'Accessory', skinColor: 'Face', hairColor: 'Hair', clothColor: 'Clothing',
} satisfies Record<keyof AvatarRecipe, string>;

function changePart(field: keyof AvatarRecipe, value: string): void {
  selectAvatar(encodeAvatar({ ...parseAvatar(avatar), [field]: value }));
}

function buildPartControls(): void {
  for (const field of Object.keys(labels) as (keyof AvatarRecipe)[]) {
    const choices = avatarOptions[field];
    if (!field.endsWith('Color')) {
      const label = document.createElement('label');
      label.className = 'select-row';
      label.append(labels[field]);
      const select = document.createElement('select');
      select.id = field;
      for (const { value, label: title } of choices) select.add(new Option(title, value));
      select.addEventListener('change', () => changePart(field, select.value));
      label.append(select);
      parts.append(label);
      partsControls.set(field, select);
      continue;
    }
    const group = document.createElement('fieldset');
    group.id = field;
    group.className = 'swatch-set';
    const legend = document.createElement('legend');
    legend.append(labels[field]);
    legend.append(document.createElement('output'));
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    for (const { value, label: title } of choices) {
      const label = document.createElement('label');
      label.className = 'swatch';
      label.title = title;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = field;
      radio.value = value;
      radio.setAttribute('aria-label', title);
      radio.addEventListener('change', () => changePart(field, radio.value));
      const color = document.createElement('span');
      color.style.setProperty('--swatch', value);
      label.append(radio, color);
      swatches.append(label);
    }
    group.append(legend, swatches);
    parts.append(group);
    partsControls.set(field, group);
  }
}

function buildRangeControls(): void {
  for (const { key, label: name, value, min, max, step, format } of preferences) {
    const label = document.createElement('label');
    label.className = 'range-row';
    label.htmlFor = key;
    label.append(name);
    const range = document.createElement('input');
    range.type = 'range';
    range.id = key;
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    const output = document.createElement('output');
    output.htmlFor.add(key);
    function updateValue(): void {
      output.value = format(range.valueAsNumber);
      range.setAttribute('aria-valuetext', output.value);
    }
    updateValue();
    range.addEventListener('input', updateValue);
    // Commit on release so dragging a slider does not queue a new picture atlas at every pixel.
    range.addEventListener('change', render);
    label.append(range, output);
    sliders.append(label);
    ranges.set(key, range);
  }
}

const valueOf = (key: RangeKey): number => ranges.get(key)!.valueAsNumber;

function render(): void {
  portrait?.dispose();
  portrait = undefined;
  const touch = matchMedia('(pointer: coarse)').matches;
  const hints = {
    static: 'A single still of this avatar.',
    picture: touch ? 'Touch the portrait to play its directional pictures.' : 'Move over the portrait or use the arrow keys to play its directional pictures.',
    live: touch ? 'Touch the portrait to turn the 3D figure.' : 'Move over the portrait or use the arrow keys to turn the 3D figure.',
  };
  hint.textContent = hints[mode];
  renderStatus.textContent = mode === 'picture' ? 'Preparing directional pictures…' : 'Preparing portrait…';
  stage.setAttribute('aria-busy', 'true');
  try {
    const next = mountAvatar(host, avatar, {
      mode, framing: crop.value === 'portrait' ? 'portrait' : 'bust',
      position: { x: valueOf('x'), y: valueOf('y') }, zoom: valueOf('zoom'),
      neutralYaw: valueOf('neutralYaw'), headYawRange: valueOf('headYawRange'), headPitchRange: valueOf('headPitchRange'),
      bodyYawRange: valueOf('bodyYawRange'), atlasGrid: 5, label: 'Paper avatar',
    });
    portrait = next;
    void next.ready.then(() => {
      if (portrait !== next) return;
      renderStatus.textContent = '';
      stage.setAttribute('aria-busy', 'false');
    }, (error: unknown) => {
      if (portrait === next) reportRenderError(error);
    });
  } catch (error) {
    reportRenderError(error);
  }
}

function reportRenderError(error: unknown): void {
  stage.setAttribute('aria-busy', 'false');
  renderStatus.textContent = error instanceof Error ? error.message : 'This browser could not render the portrait.';
}

function selectAvatar(raw: string, save = true): void {
  const recipe = parseAvatar(raw);
  avatar = encodeAvatar(recipe);
  input.value = avatar;
  input.removeAttribute('aria-invalid');
  idStatus.textContent = '';
  copy.textContent = 'Copy';
  copy.hidden = false;
  apply.hidden = true;
  stage.classList.toggle('pale', recipe.hairColor === '#d9d1bf');
  for (const [field, control] of partsControls) {
    const value = recipe[field];
    if (control instanceof HTMLSelectElement) {
      control.value = value;
    } else {
      for (const radio of control.querySelectorAll('input')) radio.checked = radio.value === value;
      const output = control.querySelector('output');
      if (output) output.value = avatarOptions[field].find(choice => choice.value === value)?.label ?? value;
    }
  }
  if (save) {
    const hash = '#avatar=' + encodeURIComponent(avatar);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }
  render();
}

function loadLocation(): void {
  const hash = new URLSearchParams(location.hash.slice(1));
  const raw = hash.get('avatar') ?? hash.get('look');
  try {
    selectAvatar(raw ?? DEFAULT_AVATAR, false);
  } catch {
    selectAvatar(DEFAULT_AVATAR, false);
    idStatus.textContent = 'The URL contains an invalid avatar string. Showing the default portrait.';
  }
}

buildPartControls();
buildRangeControls();
byId('shuffle').addEventListener('click', () => {
  let next = generateAvatar();
  while (next === avatar) next = generateAvatar();
  selectAvatar(next);
});
crop.addEventListener('change', render);
byId('mode').addEventListener('change', event => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const value = event.target.value;
  if (value === 'static' || value === 'picture' || value === 'live') {
    mode = value;
    render();
  }
});
byId('reset-view').addEventListener('click', () => {
  for (const pref of preferences) {
    const range = ranges.get(pref.key)!;
    range.value = String(pref.value);
    range.dispatchEvent(new Event('input'));
  }
  crop.value = 'bust';
  render();
});
input.addEventListener('input', () => {
  input.removeAttribute('aria-invalid');
  apply.hidden = input.value.trim() === avatar;
  copy.hidden = !apply.hidden;
  copy.textContent = 'Copy';
  idStatus.textContent = '';
});
byId('identity').addEventListener('submit', event => {
  event.preventDefault();
  try {
    selectAvatar(input.value.trim());
    idStatus.textContent = 'Portrait loaded.';
  } catch {
    input.setAttribute('aria-invalid', 'true');
    idStatus.textContent = 'Enter a complete supported avatar string.';
    input.focus();
  }
});
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(input.value);
    copy.textContent = 'Copied';
    idStatus.textContent = 'Avatar string copied.';
  } catch {
    input.focus();
    input.select();
    idStatus.textContent = 'Avatar string selected. Use your copy shortcut.';
  }
});
window.addEventListener('hashchange', loadLocation);
loadLocation();
