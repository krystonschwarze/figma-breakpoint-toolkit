import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bareName,
  counterpartName,
  describeApply,
  describeBind,
  emptyApplyOutcome,
  errorDetail,
  findVariantProperty,
  pickCollection,
  pickVariable,
  pickVariantValue,
  recordFailure,
  recordReason,
  resolveVariantChoice,
  widthFor,
} from './breakpoint.ts';
import type { CollectionInfo, VariableInfo } from './messages.ts';

test('bareName strips the id suffix that only non variant properties carry', () => {
  assert.equal(bareName('Label#12:3'), 'Label');
  assert.equal(bareName('Breakpoint'), 'Breakpoint');
});

test('findVariantProperty matches case insensitively and ignores other property types', () => {
  const properties = {
    'Breakpoint#1:2': { type: 'TEXT', value: 'Mobile' },
    ' breakpoint ': { type: 'VARIANT', value: 'Desktop' },
    Size: { type: 'VARIANT', value: 'Large' },
  };
  assert.deepEqual(findVariantProperty(properties, 'Breakpoint'), {
    key: ' breakpoint ',
    value: 'Desktop',
    bound: false,
  });
  assert.equal(findVariantProperty(properties, 'Theme'), null);
  assert.equal(findVariantProperty(properties, '  '), null);
});

test('findVariantProperty reports a variable binding on the value field', () => {
  const properties = {
    Breakpoint: {
      type: 'VARIANT',
      value: 'Desktop',
      boundVariables: { value: { type: 'VARIABLE_ALIAS', id: 'V:1' } },
    },
  };
  assert.equal(findVariantProperty(properties, 'breakpoint')?.bound, true);
});

test('pickVariantValue prefers a remembered choice, then the mode name, then the current value', () => {
  const options = ['Desktop', 'Mobile'];
  assert.equal(pickVariantValue('Tablet', options, 'Desktop', 'Mobile'), 'Desktop');
  assert.equal(pickVariantValue('mobile', options, undefined, 'Desktop'), 'Mobile');
  assert.equal(pickVariantValue('Tablet', options, undefined, 'Mobile'), 'Mobile');
  assert.equal(pickVariantValue('Tablet', options, 'Gone', 'Gone'), 'Desktop');
  assert.equal(pickVariantValue(null, [], undefined, 'Mobile'), 'Mobile');
});

const collections: CollectionInfo[] = [
  { kind: 'local', ref: '1', name: 'Colors', libraryName: null },
  { kind: 'library', ref: 'k1', name: 'Breakpoint', libraryName: 'DS' },
];

test('pickCollection picks the single collection carrying the name', () => {
  assert.deepEqual(pickCollection(collections, 'breakpoint'), { kind: 'library', ref: 'k1' });
  assert.equal(pickCollection(collections, 'Spacing'), null);
});

test('pickCollection refuses to guess between two collections with the same name', () => {
  const twins = [...collections, { ...collections[1]!, kind: 'local' as const, ref: '2' }];
  assert.equal(pickCollection(twins, 'Breakpoint'), null);
});

test('pickVariable matches any segment of the variable path', () => {
  const variables: VariableInfo[] = [
    { kind: 'library', ref: 'v1', name: 'breakpoint/name' },
    { kind: 'library', ref: 'v2', name: 'meta/Columns' },
  ];
  assert.deepEqual(pickVariable(variables, 'Breakpoint'), { kind: 'library', ref: 'v1' });
  assert.deepEqual(pickVariable(variables, 'columns'), { kind: 'library', ref: 'v2' });
});

test('pickVariable takes the only string variable when no name matches', () => {
  const single: VariableInfo[] = [{ kind: 'local', ref: 'v9', name: 'device/current' }];
  assert.deepEqual(pickVariable(single, 'Breakpoint'), { kind: 'local', ref: 'v9' });
  assert.equal(pickVariable([], 'Breakpoint'), null);
});

test('pickVariable refuses to guess between two unrelated candidates', () => {
  const many: VariableInfo[] = [
    { kind: 'local', ref: 'a', name: 'device/current' },
    { kind: 'local', ref: 'b', name: 'device/next' },
  ];
  assert.equal(pickVariable(many, 'Breakpoint'), null);
});

test('describeApply lists only what happened', () => {
  const outcome = {
    ...emptyApplyOutcome(),
    switched: 12,
    skippedBound: 1,
    rootModes: 1,
    cleared: 3,
  };
  assert.equal(
    describeApply(outcome, 'Breakpoint'),
    '12 instances switched, 1 follow a variable, mode set on 1 frame, 3 fixed modes reset.',
  );
  assert.equal(
    describeApply(emptyApplyOutcome(), 'Breakpoint'),
    'Nothing to change. No Breakpoint variant or fixed mode found.',
  );
  assert.match(describeApply({ ...emptyApplyOutcome(), failedVariants: 2 }, 'X'), /2 failed/);
  assert.match(
    describeApply({ ...emptyApplyOutcome(), switched: 3, keptSize: 2 }, 'X'),
    /2 kept the old size because Figma does not let a plugin resize a layer inside an instance/,
  );
});

test('describeBind names the operation', () => {
  assert.equal(
    describeBind({ changed: 3, unchanged: 1, failed: 0, failures: [] }, 'bind'),
    '3 instances bound, 1 already bound.',
  );
  assert.equal(
    describeBind({ changed: 1, unchanged: 0, failed: 2, failures: [] }, 'unbind'),
    '1 instance unbound, 2 failed.',
  );
});

test('recordFailure keeps only the first few messages', () => {
  const failures: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    recordFailure(failures, `Layer ${index}`, new Error('something odd'));
  }
  assert.equal(failures.length, 5);
  assert.equal(failures[0], 'Layer 0: Figma reported: something odd');
});

test('recordReason keeps our own wording and honours the same cap', () => {
  const failures: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    recordReason(failures, `Layer ${index}`, 'stayed on Desktop instead of Mobile');
  }
  assert.equal(failures.length, 5);
  assert.equal(failures[0], 'Layer 0: stayed on Desktop instead of Mobile');
});

test('errorDetail digs the message out of the shapes a sandbox actually throws', () => {
  assert.equal(errorDetail(new Error('boom')), 'boom');
  assert.equal(errorDetail('  plain string  '), 'plain string');
  assert.equal(errorDetail({ message: 'from an object' }), 'from an object');
  assert.equal(errorDetail({ code: 7 }), '{"code":7}');
  assert.equal(errorDetail(new Error('')), '[object Error]');
  assert.equal(errorDetail(undefined), '');
  assert.equal(errorDetail(null), '');
  assert.equal(errorDetail(42), '42');
});

test('errorDetail survives a value that cannot be serialised', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(errorDetail(cyclic), '[object Object]');
});

test('recordFailure explains a string throw instead of dropping it', () => {
  const failures: string[] = [];
  recordFailure(failures, 'Card', 'invalid variant value');
  recordFailure(failures, 'Nav', {});
  recordFailure(failures, 'Foot', undefined);
  assert.match(failures[0] ?? '', /^Card: That value does not exist on this component set/);
  assert.equal(failures[1], 'Nav: Figma reported: [object Object]');
  assert.equal(failures[2], 'Foot: unknown error');
});

test('resolveVariantChoice only asks when the breakpoint does not name a variant', () => {
  const options = ['Desktop', 'Mobile'];
  assert.deepEqual(resolveVariantChoice(true, 'Mobile', options, undefined, ''), {
    value: 'Mobile',
    needsChoice: false,
  });
  assert.deepEqual(resolveVariantChoice(true, 'mobile', options, undefined, ''), {
    value: 'Mobile',
    needsChoice: false,
  });
  assert.deepEqual(resolveVariantChoice(true, 'Tablet', options, 'Desktop', ''), {
    value: 'Desktop',
    needsChoice: true,
  });
  assert.deepEqual(resolveVariantChoice(true, null, options, undefined, 'Mobile'), {
    value: 'Mobile',
    needsChoice: true,
  });
});

test('resolveVariantChoice treats the breakpoint itself as the value without a collection', () => {
  const options = ['Desktop', 'Mobile'];
  assert.deepEqual(resolveVariantChoice(false, 'Mobile', options, undefined, ''), {
    value: 'Mobile',
    needsChoice: false,
  });
  assert.deepEqual(resolveVariantChoice(false, 'Gone', options, undefined, ''), {
    value: 'Desktop',
    needsChoice: false,
  });
});

test('resolveVariantChoice has nothing to offer when the scan found no options', () => {
  assert.deepEqual(resolveVariantChoice(true, 'Mobile', [], 'Mobile', 'Mobile'), {
    value: '',
    needsChoice: false,
  });
});

test('widthFor matches the breakpoint name without regard to case', () => {
  const widths = { Desktop: 1680, ' mobile ': 400 };
  assert.equal(widthFor(widths, 'desktop'), 1680);
  assert.equal(widthFor(widths, 'Mobile'), 400);
  assert.equal(widthFor(widths, 'Tablet'), null);
  assert.equal(widthFor(widths, null), null);
  assert.equal(widthFor(widths, '  '), null);
});

test('counterpartName swaps a trailing breakpoint instead of stacking it', () => {
  const known = ['Desktop', 'Mobile', 'Auto', 'Desktop wide'];
  assert.equal(counterpartName('Home / Desktop', 'Mobile', known), 'Home / Mobile');
  assert.equal(counterpartName('Home Desktop', 'Mobile', known), 'Home Mobile');
  assert.equal(counterpartName('Home - desktop', 'Mobile', known), 'Home - Mobile');
  assert.equal(counterpartName('Home / Desktop wide', 'Mobile', known), 'Home / Mobile');
});

test('counterpartName appends where no breakpoint is in the name', () => {
  const known = ['Desktop', 'Mobile'];
  assert.equal(counterpartName('  Home  ', 'Mobile', known), 'Home Mobile');
  assert.equal(counterpartName('Home', '', known), 'Home');
});

test('counterpartName leaves a word that merely ends in a breakpoint alone', () => {
  assert.equal(counterpartName('Superdesktop', 'Mobile', ['Desktop']), 'Superdesktop Mobile');
});

test('counterpartName keeps a name that is nothing but the breakpoint short', () => {
  assert.equal(counterpartName('Desktop', 'Mobile', ['Desktop', 'Mobile']), 'Mobile');
});

test('describeApply reports copies, widths and a width that would not move', () => {
  const outcome = emptyApplyOutcome();
  outcome.duplicated = 2;
  outcome.resized = 2;
  outcome.switched = 7;
  assert.equal(
    describeApply(outcome, 'Breakpoint'),
    '2 copies created, width set on 2 frames, 7 instances switched.',
  );

  const kept = emptyApplyOutcome();
  kept.duplicated = 1;
  kept.resizeKept = 1;
  assert.equal(describeApply(kept, 'Breakpoint'), '1 copy created, 1 frame kept the width.');
});
