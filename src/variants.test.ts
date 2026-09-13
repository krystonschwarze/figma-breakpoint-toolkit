import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addValue,
  describePrepare,
  describePrepareCounts,
  emptyPrepareCounts,
  emptyPrepareOutcome,
  formatVariantName,
  missingValues,
  parseVariantName,
  promoteValue,
  removeValue,
  sanitizeValues,
  valueProblem,
  variantValueOf,
  withVariantValue,
} from './variants.ts';

test('parseVariantName splits a variant name into its pairs', () => {
  assert.deepEqual(parseVariantName('Style=Image, Breakpoint=Mobile, Alignment=Left'), [
    { key: 'Style', value: 'Image' },
    { key: 'Breakpoint', value: 'Mobile' },
    { key: 'Alignment', value: 'Left' },
  ]);
  assert.deepEqual(parseVariantName('Breakpoint=Desktop'), [
    { key: 'Breakpoint', value: 'Desktop' },
  ]);
  assert.deepEqual(parseVariantName('Card'), [{ key: 'Card', value: '' }]);
  assert.deepEqual(parseVariantName(''), []);
});

test('formatVariantName is the inverse of parsing', () => {
  const name = 'Size=sm, Card=false, Alpha=true';
  assert.equal(formatVariantName(parseVariantName(name)), name);
});

test('variantValueOf reads one property out of the name, without regard to case', () => {
  assert.equal(variantValueOf('Style=01, breakpoint=Mobile', 'Breakpoint'), 'Mobile');
  assert.equal(variantValueOf('Style=01', 'Breakpoint'), null);
});

test('withVariantValue replaces a value and keeps the order and the original spelling', () => {
  assert.equal(
    withVariantValue('Style=Image, breakpoint=Desktop, Alignment=Left', 'Breakpoint', 'Mobile'),
    'Style=Image, breakpoint=Mobile, Alignment=Left',
  );
});

test('withVariantValue appends a property the name does not carry yet', () => {
  assert.equal(withVariantValue('Size=sm', 'Breakpoint', 'Desktop'), 'Size=sm, Breakpoint=Desktop');
  assert.equal(withVariantValue('', 'Breakpoint', 'Desktop'), 'Breakpoint=Desktop');
});

test('valueProblem rejects what Figma cannot put in a variant name', () => {
  assert.equal(valueProblem('Desktop'), null);
  assert.equal(valueProblem('  Extra wide  '), null);
  assert.match(valueProblem('Desktop, wide') ?? '', /commas and equals/);
  assert.match(valueProblem('a=b') ?? '', /commas and equals/);
  assert.match(valueProblem('   ') ?? '', /Type a value/);
});

test('sanitizeValues keeps strings only, trims and drops duplicates and broken values', () => {
  assert.deepEqual(sanitizeValues([' Desktop ', 'desktop', 42, '', 'a,b', 'Mobile']), [
    'Desktop',
    'Mobile',
  ]);
});

test('addValue appends once and refuses a broken value', () => {
  assert.deepEqual(addValue(['Desktop'], ' Mobile '), ['Desktop', 'Mobile']);
  assert.deepEqual(addValue(['Desktop'], 'desktop'), ['Desktop']);
  assert.deepEqual(addValue(['Desktop'], 'a,b'), ['Desktop']);
});

test('removeValue never empties the list', () => {
  assert.deepEqual(removeValue(['Desktop', 'Mobile'], 'mobile'), ['Desktop']);
  assert.deepEqual(removeValue(['Desktop'], 'Desktop'), ['Desktop']);
});

test('promoteValue moves a value to the front, which makes it the default', () => {
  assert.deepEqual(promoteValue(['Desktop', 'Tablet', 'Mobile'], 'mobile'), [
    'Mobile',
    'Desktop',
    'Tablet',
  ]);
  assert.deepEqual(promoteValue(['Desktop'], 'Gone'), ['Desktop']);
});

test('missingValues compares without regard to case and keeps the wanted order', () => {
  assert.deepEqual(missingValues(['desktop'], ['Desktop', 'Tablet', 'Mobile']), [
    'Tablet',
    'Mobile',
  ]);
  assert.deepEqual(missingValues(['Desktop', 'Mobile'], ['Desktop', 'Mobile']), []);
  assert.deepEqual(missingValues([], ['Desktop']), ['Desktop']);
});

test('describePrepare lists only what happened', () => {
  assert.equal(
    describePrepare({ ...emptyPrepareOutcome(), created: 2, variants: 2 }, 'Breakpoint'),
    '2 components now carry Breakpoint, 2 variants added.',
  );
  assert.equal(
    describePrepare({ ...emptyPrepareOutcome(), extended: 1, variants: 12, skipped: 3 }, 'X'),
    '1 set extended, 12 variants added, 3 already complete.',
  );
  assert.equal(
    describePrepare(emptyPrepareOutcome(), 'Breakpoint'),
    'Nothing to prepare. Select a component without Breakpoint.',
  );
});

test('describePrepareCounts previews what a run would do', () => {
  assert.equal(
    describePrepareCounts(
      { plain: 2, sets: 0, setVariants: 0, newVariants: 2, ready: 1 },
      'Breakpoint',
    ),
    '2 components become variant sets, 2 variants added, 1 already complete.',
  );
  assert.equal(
    describePrepareCounts(
      { plain: 0, sets: 1, setVariants: 12, newVariants: 12, ready: 0 },
      'Breakpoint',
    ),
    '1 set with 12 variants gains Breakpoint, 12 variants added.',
  );
  assert.equal(
    describePrepareCounts(emptyPrepareCounts(), 'Breakpoint'),
    'Select a component or a component set that carries no Breakpoint yet.',
  );
});
