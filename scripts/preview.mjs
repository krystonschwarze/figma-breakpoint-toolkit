import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/*
 * Renders the built dist/ui.html of every sibling plugin side by side in Figma's light and dark
 * theme, with the --figma-color-* variables injected the way Figma injects them. Catches the class of
 * bug that a typecheck cannot see: wrong contrast, clipped text, collapsed flex, dead controls.
 *
 * Each plugin may ship scripts/preview.json to describe its window and the messages to replay:
 *   { "width": 340, "height": 480, "messages": [ { "type": "collections", ... } ] }
 */
const PORT = Number(process.env.PORT ?? 8770);
const root = path.resolve(import.meta.dirname, '..');
const siblings = path.resolve(root, '..');

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function collectPlugins() {
  const plugins = [];
  for (const entry of await readdir(siblings, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(siblings, entry.name);
    const html = path.join(dir, 'dist/ui.html');
    try {
      await stat(html);
    } catch {
      continue;
    }
    const manifest = await readJson(path.join(dir, 'manifest.json'));
    const config = (await readJson(path.join(dir, 'scripts/preview.json'))) ?? {};
    plugins.push({
      slug: entry.name,
      name: manifest?.name ?? entry.name,
      html,
      width: config.width ?? 340,
      height: config.height ?? 480,
      messages: config.messages ?? [],
    });
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

const LIGHT = {
  bg: '#ffffff',
  'bg-secondary': '#f5f5f5',
  'bg-tertiary': '#e6e6e6',
  'bg-hover': '#f0f0f0',
  'bg-pressed': '#e5e5e5',
  'bg-selected': '#e5f4ff',
  'bg-brand': '#0d99ff',
  'bg-brand-hover': '#007be5',
  'bg-brand-pressed': '#0067c4',
  'bg-danger': '#f24822',
  'bg-success': '#14ae5c',
  border: '#e6e6e6',
  'border-strong': '#767676',
  'border-brand-strong': '#0d99ff',
  text: '#000000',
  'text-secondary': '#444444',
  'text-tertiary': '#b3b3b3',
  'text-onbrand': '#ffffff',
  'text-danger': '#f24822',
  'text-success': '#009951',
  icon: '#000000',
  'icon-secondary': '#444444',
  'icon-tertiary': '#b3b3b3',
};

const DARK = {
  ...LIGHT,
  bg: '#2c2c2c',
  'bg-secondary': '#383838',
  'bg-tertiary': '#444444',
  'bg-hover': '#3d3d3d',
  'bg-pressed': '#4d4d4d',
  'bg-selected': '#294764',
  border: '#444444',
  'border-strong': '#9a9a9a',
  text: '#ffffff',
  'text-secondary': '#b3b3b3',
  'text-tertiary': '#757575',
  'text-danger': '#ff9a92',
  'text-success': '#7dd4a0',
  icon: '#ffffff',
  'icon-secondary': '#b3b3b3',
  'icon-tertiary': '#757575',
};

function page(plugins) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Figma plugin preview</title>
<style>
 body{margin:0;padding:20px;font:12px Inter,system-ui,sans-serif;background:#8a8a8a}
 h2{margin:0 0 10px;font-size:13px;color:#fff}
 .row{display:flex;gap:18px;margin-bottom:28px;align-items:flex-start;flex-wrap:wrap}
 .cap{font-size:11px;color:#fff;margin-bottom:5px}
 iframe{border:1px solid rgba(0,0,0,.35);border-radius:8px;display:block;background:#fff;
        box-shadow:0 8px 20px rgba(0,0,0,.25)}
 .none{color:#fff}
</style></head><body>
<h2>Figma light</h2><div class="row" id="light"></div>
<h2>Figma dark</h2><div class="row" id="dark"></div>
<script>
const PLUGINS = ${JSON.stringify(plugins.map(({ slug, name, width, height, messages }) => ({ slug, name, width, height, messages })))};
const THEMES = { light: ${JSON.stringify(LIGHT)}, dark: ${JSON.stringify(DARK)} };

function theme(doc, vars, dark) {
  const css = Object.entries(vars).map(([k, v]) => '--figma-color-' + k + ':' + v + ';').join('');
  const style = doc.createElement('style');
  style.textContent = ':root{' + css + '}';
  doc.head.appendChild(style);
  doc.documentElement.classList.add(dark ? 'figma-dark' : 'figma-light');
}

function build(container, vars, dark) {
  if (PLUGINS.length === 0) {
    container.innerHTML = '<p class="none">No built plugin found. Run npm run build in a plugin repo.</p>';
    return;
  }
  for (const p of PLUGINS) {
    const cell = document.createElement('div');
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = p.name + '  ' + p.width + '\\u00d7' + p.height;
    const frame = document.createElement('iframe');
    frame.src = '/ui/' + p.slug;
    frame.width = p.width;
    frame.height = p.height;
    frame.addEventListener('load', () => {
      theme(frame.contentDocument, vars, dark);
      for (const message of p.messages) {
        frame.contentWindow.postMessage({ pluginMessage: message }, '*');
      }
    });
    cell.append(cap, frame);
    container.appendChild(cell);
  }
}

build(document.getElementById('light'), THEMES.light, false);
build(document.getElementById('dark'), THEMES.dark, true);
</script></body></html>`;
}

const plugins = await collectPlugins();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname.startsWith('/ui/')) {
    const plugin = plugins.find((p) => p.slug === url.pathname.slice('/ui/'.length));
    if (!plugin) {
      response.writeHead(404).end('unknown plugin');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(await readFile(plugin.html, 'utf8'));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page(plugins));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Preview on http://127.0.0.1:${PORT}`);
  for (const plugin of plugins) {
    console.log(`  ${plugin.name.padEnd(28)} ${plugin.width}x${plugin.height}`);
  }
  if (plugins.length === 0) console.log('  no built plugin found, run npm run build first');
});
