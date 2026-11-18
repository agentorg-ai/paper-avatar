function choices<const T extends string>(pairs: readonly (readonly [T, string])[]) {
  return Object.freeze(pairs.map(([value, label]) => Object.freeze({ value, label })));
}

/** The order and membership of the v1 generation palette are part of the seed format. */
export const avatarOptions = Object.freeze({
  outfit: choices([['jacket', 'Folded jacket'], ['wrap', 'Wrap coat'], ['crew', 'Crew neck']]),
  hair: choices([['sweep', 'Side sweep'], ['crop', 'Short crop'], ['bob', 'Bob'], ['curls', 'Curls']]),
  accessory: choices([['none', 'None'], ['glasses', 'Glasses'], ['earrings', 'Earrings']]),
  skinColor: choices([
    ['#f2debd', 'Warm ivory'], ['#e9bc95', 'Peach'], ['#d1a47b', 'Sandstone'], ['#e49a49', 'Paper ochre'],
    ['#b97451', 'Sienna'], ['#965e4b', 'Clay'], ['#744b39', 'Umber'], ['#51352f', 'Deep umber']
  ]),
  hairColor: choices([
    ['#464965', 'Ink indigo'], ['#343339', 'Charcoal'], ['#51392e', 'Walnut'], ['#79463c', 'Auburn'],
    ['#a36341', 'Copper'], ['#c7a571', 'Wheat'], ['#93908d', 'Graphite grey'], ['#d9d1bf', 'Silver linen']
  ]),
  clothColor: choices([
    ['#cb4533', 'Vermilion'], ['#cc7950', 'Terracotta'], ['#d6a24d', 'Marigold'], ['#879166', 'Olive'],
    ['#447b70', 'Mineral green'], ['#346a74', 'Deep teal'], ['#587998', 'Slate blue'], ['#555979', 'Indigo'],
    ['#885970', 'Mulberry'], ['#dbcfb7', 'Linen']
  ])
});

export interface AvatarRecipe {
  outfit: (typeof avatarOptions.outfit)[number]['value'];
  hair: (typeof avatarOptions.hair)[number]['value'];
  accessory: (typeof avatarOptions.accessory)[number]['value'];
  skinColor: string;
  hairColor: string;
  clothColor: string;
}

export const DEFAULT_AVATAR = 'pa1.jacket.sweep.none.e49a49.464965.cb4533';

function part<T extends string>(value: string, options: readonly {value: T}[], field: string): T {
  const match = options.find(option => option.value === value);
  if (!match) throw new RangeError('Unknown avatar ' + field + ': ' + String(value));
  return match.value;
}

function color(value: string): string {
  if (typeof value !== 'string' || !/^#?[\da-f]{6}$/i.test(value)) {
    throw new RangeError('An avatar color must be six hexadecimal digits.');
  }
  return '#' + value.replace(/^#/, '').toLowerCase();
}

/** Canonical, URL-safe identity. Colors may be any six-digit sRGB values. */
export function encodeAvatar(recipe: AvatarRecipe): string {
  const {outfit, hair, accessory, skinColor, hairColor, clothColor} = recipe;
  return ['pa1', part(outfit, avatarOptions.outfit, 'outfit'), part(hair, avatarOptions.hair, 'hair'),
    part(accessory, avatarOptions.accessory, 'accessory'), ...[skinColor, hairColor, clothColor].map(c => color(c).slice(1))].join('.');
}

const workshopTags = ['o', 'h', 'a', 's', 'p', 'c'] as const;

function readWorkshopId(tokens: string[]): string[] {
  const fields = new Map<string,string>();
  for (const token of tokens) {
    const match = /^([ohaspc])-(.+)$/.exec(token);
    if (!match || fields.has(match[1])) throw new RangeError('Invalid workshop avatar ID.');
    fields.set(match[1], match[2]);
  }
  return workshopTags.map(tag => {
    const value = fields.get(tag);
    if (!value) throw new RangeError('Incomplete workshop avatar ID.');
    return value;
  });
}

/** Accepts both a versioned ID and a complete six-field ID from the original workshop. */
export function parseAvatar(id: string): AvatarRecipe {
  if (typeof id !== 'string') throw new TypeError('An avatar ID must be a string.');
  const [prefix, ...tail] = id.replace(/^#look=/, '').split('.');
  const fields = prefix === 'pa1' ? tail : readWorkshopId([prefix, ...tail]);
  if (fields.length !== 6) throw new RangeError('An avatar ID requires six fields.');
  const [outfit, hair, accessory, skinColor, hairColor, clothColor] = fields;
  return {
    outfit: part(outfit, avatarOptions.outfit, 'outfit'),
    hair: part(hair, avatarOptions.hair, 'hair'),
    accessory: part(accessory, avatarOptions.accessory, 'accessory'),
    skinColor: color(skinColor), hairColor: color(hairColor), clothColor: color(clothColor)
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(seed)) hash = Math.imul(hash ^ byte, 16777619);
  // Avalanche before decoding the mixed-radix index so adjacent agent IDs vary across all slots.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

const paletteSize = Object.values(avatarOptions).reduce((size, options) => size * options.length, 1);

function randomIndex(): number {
  const sample = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % paletteSize);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % paletteSize;
}

/** Pass a stable seed to derive a repeatable avatar, or omit it to draw a fresh one. */
export function generateAvatar(seed?: string): string {
  if (seed !== undefined && typeof seed !== 'string') throw new TypeError('An avatar seed must be a string.');
  let index = seed === undefined ? randomIndex() : hashSeed(seed) % paletteSize;
  function take<T extends string>(options: readonly {value: T}[]): T {
    const choice = options[index % options.length].value;
    index = Math.floor(index / options.length);
    return choice;
  }
  return encodeAvatar({
    outfit: take(avatarOptions.outfit), hair: take(avatarOptions.hair), accessory: take(avatarOptions.accessory),
    skinColor: take(avatarOptions.skinColor), hairColor: take(avatarOptions.hairColor), clothColor: take(avatarOptions.clothColor)
  });
}
