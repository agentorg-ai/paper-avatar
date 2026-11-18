import { parseArgs } from 'node:util';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { DEFAULT_AVATAR, encodeAvatar, generateAvatar, parseAvatar } from '../dist/identity.js';

const {values} = parseArgs({ options: {
  avatar: {type:'string'}, seed: {type:'string'}, out: {type:'string'},
  size: {type:'string',default:'160'}, grid: {type:'string',default:'5'},
  view: {type:'string'}, help: {type:'boolean'}
}});
if (values.help || !values.out) {
  console.log('npm run bake -- --out <directory> [--avatar <id> | --seed <text>] [--size 160] [--grid 5] [--view camera.json]');
  process.exit(values.help ? 0 : 1);
}
if (values.avatar !== undefined && values.seed !== undefined) throw new Error('Choose an avatar ID or a seed.');
const id = values.avatar !== undefined ? encodeAvatar(parseAvatar(values.avatar))
  : values.seed !== undefined ? generateAvatar(values.seed) : DEFAULT_AVATAR;
const size = Number(values.size), grid = Number(values.grid);
if (!Number.isInteger(size) || size < 1 || size > 2048) throw new Error('Size must be an integer from 1 to 2048.');
if (![3,5,7,9].includes(grid)) throw new Error('Grid must be 3, 5, 7 or 9.');
const view = values.view ? JSON.parse(await readFile(values.view,'utf8')) : {framing:'portrait'};
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({stdin:{contents:"import {bakeAvatar} from './dist/index.js';window.bake = bakeAvatar;",resolveDir:root},
  bundle:true,write:false,minify:true,format:'iife',target:'es2022'});
const browser = await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const {atlas,still} = await page.evaluate(async ({id,view,size,grid}) => {
    const atlas = await window.bake(id,{...view,mode:'picture',width:size,height:size,atlasGrid:grid});
    const png = new Image();
    png.src = atlas.image;
    await png.decode();
    const canvas = document.createElement('canvas');
    canvas.width = atlas.width; canvas.height = atlas.height;
    canvas.getContext('2d').drawImage(png, Math.floor(atlas.columns/2)*atlas.width, Math.floor(atlas.rows/2)*atlas.height,
      atlas.width, atlas.height, 0, 0, atlas.width, atlas.height);
    return {atlas,still:canvas.toDataURL('image/png')};
  },{id,view,size,grid});
  const dir = resolve(values.out);
  await mkdir(dir,{recursive:true});
  // Publish images before the manifest. Parallel bakes and retries always leave a complete set.
  async function atomic(name, bytes) {
    const file = join(dir,name), tmp = file + '.' + randomUUID() + '.tmp';
    try { await writeFile(tmp,bytes); await rename(tmp,file); }
    finally { await rm(tmp,{force:true}); }
  }
  async function saveImage(label, data) {
    const bytes = Buffer.from(data.slice(data.indexOf(',')+1),'base64');
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0,16);
    const name = label + '-' + hash + '.png';
    await atomic(name,bytes);
    return name;
  }
  const image = await saveImage('directions',atlas.image);
  const poster = await saveImage('portrait',still);
  await atomic('avatar.json',JSON.stringify({id,...atlas,image,poster}, null, 2) + '\n');
  console.log(id, join(dir,'avatar.json'));
} finally { await browser.close(); }
