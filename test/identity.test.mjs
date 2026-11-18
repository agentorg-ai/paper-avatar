import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarOptions, DEFAULT_AVATAR, encodeAvatar, generateAvatar, parseAvatar } from '../dist/identity.js';

test('all 23,040 built-in combinations have reversible and distinct IDs', () => {
  const keys = Object.keys(avatarOptions);
  const ids = new Set();
  function check(recipe, i) {
    if (i === keys.length) {
      const id = encodeAvatar(recipe);
      assert.deepEqual(parseAvatar(id), recipe);
      ids.add(id);
      return;
    }
    const key = keys[i];
    for (const {value} of avatarOptions[key]) check({...recipe, [key]: value}, i + 1);
  }
  check({}, 0);
  assert.equal(ids.size, 23040);
});

test('restores old workshop URLs and normalizes arbitrary sRGB colors', () => {
  const legacy = '#look=o-jacket.h-curls.a-earrings.s-e49a49.p-d9d1bf.c-cb4533';
  assert.equal(encodeAvatar(parseAvatar(legacy)), 'pa1.jacket.curls.earrings.e49a49.d9d1bf.cb4533');
  assert.equal(encodeAvatar({...parseAvatar(DEFAULT_AVATAR), clothColor: '#AA9922'}), DEFAULT_AVATAR.replace('cb4533', 'aa9922'));
});

test('rejects malformed or unknown IDs rather than silently changing identity', () => {
  for (const id of ['', null, DEFAULT_AVATAR.replace('pa1', 'pa2'), DEFAULT_AVATAR+'.extra', DEFAULT_AVATAR.replace('jacket', 'missing'),
    'o-jacket.o-wrap.a-none.s-e49a49.p-464965.c-cb4533', DEFAULT_AVATAR.replace('cb4533', '1234')]) {
    assert.throws(() => parseAvatar(id));
  }
});

test('v1 seed fixtures are stable across releases and random IDs decode', () => {
  const fixtures = [
    ['', 'pa1.crew.curls.glasses.965e4b.51392e.cc7950'],
    ['agent/雨', 'pa1.crew.sweep.earrings.e9bc95.464965.555979'],
    ['atlas:17', 'pa1.jacket.bob.glasses.e49a49.a36341.cb4533']
  ];
  for (const [seed, expected] of fixtures) {
    assert.equal(generateAvatar(seed), expected);
    assert.equal(encodeAvatar(parseAvatar(generateAvatar(seed))), generateAvatar(seed));
  }
  assert.ok(new Set(Array.from({length: 64}, () => generateAvatar())).size > 1);
});
