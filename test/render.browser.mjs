import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = code => buildSync({
  stdin: { contents: code, resolveDir: root }, bundle: true, format: 'iife', write: false,
  define: { 'process.env.NODE_ENV': '"development"' }, target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

const harness = build(`
  import * as api from './dist/index.js';
  import { createElement, StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { PaperAvatar } from './dist/react.js';
  Object.assign(window, {api, reactRoot: createRoot(document.querySelector('#react')),
    reactView: props => createElement(StrictMode, null, createElement(PaperAvatar, props))});
`);
const player = build("import * as player from './dist/render/player.js';window.player=player");
const html = '<style>#host{width:144px;height:144px;background:#e2d8ca}body{margin:0}</style><div id="host"></div><div id="react"></div>';

async function open(page, code) {
  await page.route('http://avatar.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://avatar.test/');
  await page.addScriptTag({content: code});
}

test('the static still holds its pose, and live gaze, framing and teardown work', async ({page}) => {
  await open(page, harness);
  const canvas = page.locator('#host canvas').first();
  const mount = opts => page.evaluate(async options => {
    window.handle?.dispose();
    window.handle = api.mountAvatar(document.querySelector('#host'), api.DEFAULT_AVATAR, options);
    await window.handle.ready;
  }, {pixelRatio: 1, reducedMotion:'always', ...opts});
  await mount({mode:'static'});
  const still = await canvas.screenshot();
  await page.evaluate(() => window.handle.setGaze(1,1));
  expect(await canvas.screenshot()).toEqual(still);
  await mount({mode:'static', framing:'portrait', zoom:1.12, position:{x:.1,y:-.1}});
  expect((await canvas.screenshot()).equals(still)).toBe(false);
  await mount({mode:'live', idle:false, headYawRange:32});
  const neutral = await canvas.screenshot();
  await page.evaluate(() => window.handle.setGaze(1,0));
  await expect.poll(async () => (await canvas.screenshot()).equals(neutral)).toBe(false);
  await page.evaluate(() => { window.handle.dispose(); window.handle.dispose(); });
  await expect(page.locator('#host canvas')).toHaveCount(0);
});

test('bake an atlas once, replay serialized pixels in a fresh browser page with WebGL disabled', async ({page, context}) => {
  await open(page, harness);
  const atlas = await page.evaluate(async () => JSON.parse(JSON.stringify(await api.bakeAvatar(api.DEFAULT_AVATAR, {
    mode:'picture', atlasGrid:3, width:84, height:96, headYawRange:30
  }))));
  expect(atlas).toMatchObject({version:1, columns:3, rows:3, width:84, height:96});
  const consumer = await context.newPage();
  await consumer.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind.includes('webgl')) throw Error('2D playback attempted to allocate WebGL');
      return get.call(this, kind, ...args);
    };
  });
  await open(consumer, player);
  await consumer.evaluate(async data => {
    window.handle = window.player.mountBakedPortrait(document.querySelector('#host'), data, {reducedMotion:'always'});
    await window.handle.ready;
  }, atlas);
  const frame = () => consumer.locator('#host canvas').evaluate(c => c.toDataURL());
  const center = await frame();
  await consumer.evaluate(() => window.handle.setGaze(-1,.9));
  await expect.poll(frame).not.toBe(center);
  await consumer.evaluate(() => window.handle.setGaze(0,0));
  await expect.poll(frame).toBe(center);
  await consumer.close();
});

test('the default picture has 64 selectable poses and an exact front-facing still', async ({page}) => {
  await open(page, harness);
  const result = await page.evaluate(async () => {
    const view = {width:64, height:80, neutralYaw:0, headPitchRange:12};
    const atlas = await api.bakeAvatar(api.DEFAULT_AVATAR, {...view, mode:'picture'});
    const still = await api.bakeAvatar(api.DEFAULT_AVATAR, {...view, mode:'static'});
    async function decode(src) {
      const image = new Image();
      image.src = src;
      await image.decode();
      return image;
    }
    const sheet = await decode(atlas.image);
    const tile = document.createElement('canvas');
    tile.width = view.width;
    tile.height = view.height;
    const ctx = tile.getContext('2d');
    function crop(image, column = 0, row = 0) {
      ctx.clearRect(0, 0, tile.width, tile.height);
      ctx.drawImage(image, column * tile.width, row * tile.height, tile.width, tile.height,
        0, 0, tile.width, tile.height);
      return tile.toDataURL();
    }

    const host = document.querySelector('#host');
    host.style.width = view.width + 'px';
    host.style.height = view.height + 'px';
    const portrait = api.mountBakedPortrait(host, atlas, {pixelRatio:1, reducedMotion:'always'});
    await portrait.ready;
    const neutral = crop(await decode(still.image));
    const neutralMatches = neutral === crop(sheet, 4, 4) && neutral === portrait.canvas.toDataURL();
    const directions = [-1, -.75, -.5, -.25, 0, 1/3, 2/3, 1];
    const distinct = new Set();
    const mismatches = [];
    for (const [row, down] of directions.entries()) {
      for (const [column, right] of directions.entries()) {
        portrait.setGaze(right, -down);
        await new Promise(requestAnimationFrame);
        const displayed = portrait.canvas.toDataURL();
        distinct.add(displayed);
        if (displayed !== crop(sheet, column, row)) mismatches.push([column, row]);
      }
    }
    portrait.dispose();
    return {grid:[atlas.columns, atlas.rows], pngSize:[sheet.width, sheet.height],
      neutralMatches, distinct:distinct.size, mismatches};
  });
  expect(result).toEqual({grid:[8,8], pngSize:[512,640], neutralMatches:true, distinct:64, mismatches:[]});
});

test('each picture portrait uses its own requested sampling density', async ({page}) => {
  await open(page, harness);
  const result = await page.evaluate(async () => {
    const atlases = await Promise.all([5, 12].map(atlasGrid => api.bakeAvatar(api.DEFAULT_AVATAR,
      {mode:'picture', atlasGrid, width:24, height:24, neutralYaw:0, headYawRange:45})));
    const portraits = atlases.map(atlas => {
      const host = document.createElement('div');
      host.style.cssText = 'width:24px;height:24px';
      document.body.append(host);
      return api.mountBakedPortrait(host, atlas, {pixelRatio:1, reducedMotion:'always'});
    });
    await Promise.all(portraits.map(p => p.ready));
    const neutral = portraits.map(p => p.canvas.toDataURL());
    for (const p of portraits) p.setGaze(.2, 0);
    await new Promise(requestAnimationFrame);
    const moved = portraits.map((p, i) => p.canvas.toDataURL() !== neutral[i]);
    for (const p of portraits) p.dispose();
    return {grids:atlases.map(a => [a.columns, a.rows]), moved};
  });
  // A gaze of 0.2 is inside the 5×5 neutral bin and one step from center on 12×12.
  expect(result).toEqual({grids:[[5,5], [12,12]], moved:[false, true]});
});

test('React can replace an in-flight bake under Strict Mode and dispose a mounted portrait', async ({page}) => {
  const uncaught = [];
  page.on('pageerror', err => uncaught.push(err.message));
  await open(page, harness);
  await page.evaluate(() => {
    window.renderReact = props => window.reactRoot.render(window.reactView({
      avatar: window.api.DEFAULT_AVATAR, size:96, ...props,
      onReady: () => { document.body.dataset.ready = props.label; },
      onError: err => { document.body.dataset.error = err.message; }
    }));
    window.renderReact({mode:'picture', label:'baking'});
  });
  await expect(page.locator('#react canvas')).toHaveCount(1);
  await page.evaluate(() => window.renderReact({mode:'static', label:'successor', avatar:window.api.generateAvatar('react-successor')}));
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'successor', {timeout:45000});
  await expect(page.locator('#react canvas')).toHaveCount(1);
  await page.evaluate(() => window.reactRoot.unmount());
  await expect(page.locator('#react canvas')).toHaveCount(0);
  expect(await page.locator('body').getAttribute('data-error')).toBeNull();
  expect(uncaught).toEqual([]);
});
