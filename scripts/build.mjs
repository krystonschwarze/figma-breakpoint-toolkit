import { context, formatMessages } from 'esbuild';
import { mkdir, readFile, rm, watch as watchDir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist');
const htmlTemplate = path.join(root, 'src/ui/index.html');

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

async function print(kind, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  const lines = await formatMessages(messages, { kind, color: true, terminalWidth: 100 });
  for (const line of lines) process.stderr.write(line);
}

const shared = {
  bundle: true,
  minify,
  target: 'es2020',
  logLevel: 'silent',
  legalComments: 'none',
};

/*
 * One document holds every screen, so a duplicate id silently hands byId the wrong element.
 * Cheap to check here, expensive to notice at runtime.
 */
function assertUniqueIds(template) {
  const counts = new Map();
  for (const [, id] of template.matchAll(/\bid="([^"]+)"/g)) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate id in src/ui/index.html: ${duplicates.join(', ')}`);
  }
}

/* Figma loads ui.html as one self-contained document, so CSS and JS have to be inlined. */
async function writeUiHtml(outputFiles) {
  const decoder = new TextDecoder();
  const asset = (ext) => {
    const file = outputFiles.find((f) => f.path.endsWith(ext));
    return file ? decoder.decode(file.contents).trim() : '';
  };

  const template = await readFile(htmlTemplate, 'utf8');
  assertUniqueIds(template);
  const html = template
    .replace('<!--inject:css-->', `<style>\n${asset('.css')}\n</style>`)
    .replace(
      '<!--inject:js-->',
      `<script>\n${asset('.js').replaceAll('</script', '<\\/script')}\n</script>`,
    );

  await writeFile(path.join(outDir, 'ui.html'), html);
}

const mainCtx = await context({
  ...shared,
  entryPoints: [path.join(root, 'src/code.ts')],
  outfile: path.join(outDir, 'code.js'),
});

const uiCtx = await context({
  ...shared,
  entryPoints: [path.join(root, 'src/ui/main.ts')],
  outdir: outDir,
  write: false,
  format: 'iife',
  plugins: [
    {
      name: 'inline-ui-html',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) await writeUiHtml(result.outputFiles);
        });
      },
    },
  ],
});

/*
 * All reporting happens here rather than in an onEnd hook. A throw inside onEnd, such as the
 * duplicate id guard, is only visible on the rejected rebuild promise.
 */
async function rebuildAll() {
  const results = await Promise.allSettled([mainCtx.rebuild(), uiCtx.rebuild()]);
  let ok = true;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      await print('warning', result.value.warnings);
      continue;
    }
    ok = false;
    const reason = result.reason;
    await print('error', reason?.errors);
    await print('warning', reason?.warnings);
    if (!Array.isArray(reason?.errors) || reason.errors.length === 0) {
      console.error(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return ok;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const ok = await rebuildAll();
if (ok) console.log('Built dist/code.js and dist/ui.html');

if (!watch) {
  await Promise.all([mainCtx.dispose(), uiCtx.dispose()]);
  process.exit(ok ? 0 : 1);
}

await Promise.all([mainCtx.watch(), uiCtx.watch()]);
console.log('Watching for changes');

/* esbuild watches the module graph only, and index.html is read outside of it. */
for await (const event of watchDir(path.dirname(htmlTemplate))) {
  if (event.filename === 'index.html') await uiCtx.rebuild().catch(() => {});
}
