import { cp, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/*
 * The canonical repo is found by its marker file rather than by name, so renaming any repo does not
 * break the sync. Exactly one sibling should carry .ui-kit-canonical at its root.
 */
const MARKER = '.ui-kit-canonical';

const here = path.resolve(import.meta.dirname, '..');
const siblings = path.resolve(here, '..');

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

if (await exists(path.join(here, MARKER))) {
  console.log('This repo holds the canonical ui-kit. Nothing to sync.');
  process.exit(0);
}

const candidates = [];
for (const entry of await readdir(siblings, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const root = path.join(siblings, entry.name);
  if (await exists(path.join(root, MARKER))) candidates.push(root);
}

if (candidates.length === 0) {
  console.error(`No sibling directory of ${siblings} carries a ${MARKER} marker.`);
  console.error('Clone the repo that holds the canonical ui-kit next to this one, then run again.');
  process.exit(1);
}

if (candidates.length > 1) {
  console.error(`More than one canonical ui-kit found: ${candidates.join(', ')}`);
  console.error(`Remove the ${MARKER} marker from all but one.`);
  process.exit(1);
}

const source = path.join(candidates[0], 'ui-kit');
await cp(source, path.join(here, 'ui-kit'), { recursive: true });
console.log(`Synced ui-kit from ${source}`);
