import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from './messages.ts';
import { sanitizeSettings } from './settings.ts';

test('sanitizeSettings falls back to the defaults for garbage', () => {
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('nope'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ propertyName: '   ' }), DEFAULT_SETTINGS);
});

test('sanitizeSettings keeps valid refs and drops broken ones', () => {
  const settings = sanitizeSettings({
    propertyName: ' Breakpoint ',
    variantValues: ['Desktop', '', 'desktop', ' Mobile '],
    collection: { kind: 'library', ref: 'abc' },
    variable: { kind: 'remote', ref: 'x' },
    targetMode: 'Mobile',
    variantForMode: { Tablet: 'Desktop', Mobile: '', Desktop: 3 },
    widths: { ' Wide ': 1920.4, Mobile: '400', Tablet: 0, '  ': 800 },
    switchVariants: false,
    resetNestedModes: 'yes',
    setChildrenModes: true,
    duplicate: true,
    resizeRoot: 'yes',
  });
  assert.deepEqual(settings, {
    propertyName: 'Breakpoint',
    variantValues: ['Desktop', 'Mobile'],
    collection: { kind: 'library', ref: 'abc' },
    variable: null,
    targetMode: 'Mobile',
    variantForMode: { Tablet: 'Desktop' },
    widths: { Wide: 1920 },
    switchVariants: false,
    resetNestedModes: true,
    setChildrenModes: true,
    duplicate: true,
    resizeRoot: false,
  });
});

test('sanitizeSettings keeps a width table someone emptied and rebuilds a missing one', () => {
  assert.deepEqual(sanitizeSettings({ widths: {} }).widths, {});
  assert.deepEqual(sanitizeSettings({}).widths, DEFAULT_SETTINGS.widths);
  assert.deepEqual(sanitizeSettings({ widths: 'wide' }).widths, DEFAULT_SETTINGS.widths);
});

test('sanitizeSettings drops widths out of range and caps the table', () => {
  assert.deepEqual(sanitizeSettings({ widths: { A: 0, B: 16385, C: -400, D: 1 } }).widths, {
    D: 1,
  });
  const many: Record<string, number> = {};
  for (let index = 0; index < 20; index += 1) many[`B${index}`] = 400 + index;
  assert.equal(Object.keys(sanitizeSettings({ widths: many }).widths).length, 12);
});

test('sanitizeSettings hands out its own width table, not the shared default', () => {
  const settings = sanitizeSettings(undefined);
  settings.widths.Desktop = 1;
  assert.equal(DEFAULT_SETTINGS.widths.Desktop, 1680);
});

test('sanitizeSettings falls back to the default values when none survive', () => {
  assert.deepEqual(sanitizeSettings({ variantValues: ['', '  '] }).variantValues, [
    'Desktop',
    'Mobile',
  ]);
  assert.deepEqual(sanitizeSettings({ variantValues: 'Desktop' }).variantValues, [
    'Desktop',
    'Mobile',
  ]);
  assert.equal(
    sanitizeSettings({ variantValues: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).variantValues.length,
    6,
  );
});
