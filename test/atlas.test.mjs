import assert from 'node:assert/strict';
import test from 'node:test';
import { gazeAtTile, tileAtGaze } from '../dist/render/atlas.js';

test('all supported sampling grids include both limits and the exactly neutral gaze', () => {
  for (let count = 3; count <= 32; count++) {
    const center = Math.floor(count / 2);
    assert.equal(gazeAtTile(0, count), -1);
    assert.equal(gazeAtTile(center, count), 0);
    assert.equal(gazeAtTile(count - 1, count), 1);
    for (let tile = 0; tile < count; tile++) {
      assert.equal(tileAtGaze(gazeAtTile(tile, count), count), tile);
    }
  }
});
