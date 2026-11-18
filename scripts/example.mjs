import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';

const example = new URL('../example/', import.meta.url);
const url = name => new URL(name, example);
const output = url('dist/index.html');
await mkdir(url('dist/'), { recursive: true });
const build = await context({
  entryPoints: [fileURLToPath(url('main.ts'))], bundle: true, write: false, minify: true, format: 'iife',
  target: ['es2022'], legalComments: 'inline',
  plugins: [{ name: 'standalone-example', setup(builder) {
    builder.onEnd(async result => {
      if (result.errors.length) return;
      const html = await readFile(url('index.html'), 'utf8');
      const css = await readFile(url('studio.css'), 'utf8');
      const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
      await writeFile(output, html.replace(/<link[^>]+href="\.\/studio\.css"[^>]*>/, () => '<style>' + css + '</style>')
        .replace(/<script type="module" src="\.\/main\.ts"><\/script>/, () => '<script type="module">' + script + '</script>'));
    });
  }}]
});
if (process.argv.includes('--serve')) {
  await build.rebuild();
  await build.watch();
  for (const file of ['index.html', 'studio.css']) watch(url(file), () => { void build.rebuild(); });
  const port = Number(process.env.PORT || '5173');
  createServer(async (req, res) => {
    if (!['/', '/index.html'].includes(req.url.split('?')[0])) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(await readFile(output));
  }).listen(port, '127.0.0.1', () => console.log('Paper Avatar on http://127.0.0.1:' + port));
} else {
  try { await build.rebuild(); console.log('Built example/dist/index.html'); }
  finally { await build.dispose(); }
}
