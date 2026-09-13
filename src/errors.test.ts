import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainError } from './errors.ts';

test('explainError replaces the vanished node message with the cause and the way out', () => {
  const raw =
    'in get_explicitVariableModes: The node (instance sublayer or table cell) with id "I4831:77864;4824:177618" does not exist';
  const text = explainError(raw);
  assert.match(text, /disappeared while the plugin was working/);
  assert.match(text, /run it again/);
  assert.doesNotMatch(text, /get_explicitVariableModes/);
  assert.doesNotMatch(text, /I4831/);
});

test('explainError names the manifest id as the cause of a storage failure', () => {
  assert.match(
    explainError(
      'Failed to get client storage key "x": Error: Cannot access client storage without a plugin ID',
    ),
    /manifest\.json has no id/,
  );
  assert.match(
    explainError('in getPluginData: Cannot get private plugin data in a plugin without an ID.'),
    /manifest\.json has no id/,
  );
});

test('explainError turns the library permission error into the two manifest entries', () => {
  assert.match(explainError('permission not specified in manifest'), /teamlibrary/);
});

test('explainError explains a broken component set and the variant property rule', () => {
  assert.match(
    explainError('in get_componentPropertyDefinitions: Component set has existing errors'),
    /error state in Figma/,
  );
  assert.match(
    explainError('in addComponentProperty: Can only add variant property to a component set'),
    /Run Prepare on the component itself/,
  );
});

test('explainError keeps an unknown message but strips the accessor and says who is talking', () => {
  assert.equal(
    explainError('in set_something: Something odd happened'),
    'Figma reported: Something odd happened',
  );
  assert.equal(explainError('Something odd happened'), 'Figma reported: Something odd happened');
});

test('explainError stays empty for an empty detail', () => {
  assert.equal(explainError(''), '');
  assert.equal(explainError('   '), '');
  assert.equal(explainError('in get_x: '), '');
});
