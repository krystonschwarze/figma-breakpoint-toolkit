import assert from 'node:assert/strict';
import { test } from 'node:test';
import { walkTopDown } from './walk.ts';

interface FakeNode {
  name: string;
  children: FakeNode[];
}

function node(name: string, children: FakeNode[] = []): FakeNode {
  return { name, children };
}

test('walkTopDown visits parents before children in document order', async () => {
  const tree = node('root', [node('a', [node('a1')]), node('b')]);
  const order: string[] = [];
  const visited = await walkTopDown([tree], {
    childrenOf: (n) => n.children,
    visit: (n, isRoot) => {
      order.push(isRoot ? `${n.name}*` : n.name);
    },
  });
  assert.deepEqual(order, ['root*', 'a', 'a1', 'b']);
  assert.equal(visited, 4);
});

test('walkTopDown reads children only after the visit, so a swapped subtree is followed', async () => {
  const tree = node('root', [node('outer', [node('desktop-child')])]);
  const order: string[] = [];
  await walkTopDown([tree], {
    childrenOf: (n) => n.children,
    visit: (n) => {
      order.push(n.name);
      if (n.name === 'outer') n.children = [node('mobile-child')];
    },
  });
  assert.deepEqual(order, ['root', 'outer', 'mobile-child']);
});

test('walkTopDown yields at the configured interval and handles several roots', async () => {
  const roots = [node('r1', [node('x'), node('y')]), node('r2', [node('z')])];
  const yields: number[] = [];
  const visited = await walkTopDown(roots, {
    childrenOf: (n) => n.children,
    visit: () => undefined,
    yieldEvery: 2,
    onYield: (count) => {
      yields.push(count);
    },
  });
  assert.equal(visited, 5);
  assert.deepEqual(yields, [2, 4]);
});

test('walkTopDown skips a node that no longer exists and keeps going', async () => {
  const gone = node('gone');
  const tree = node('root', [node('a'), gone, node('b')]);
  const order: string[] = [];
  const visited = await walkTopDown([tree], {
    childrenOf: (n) => n.children,
    alive: (n) => n !== gone,
    visit: (n) => {
      order.push(n.name);
    },
  });
  assert.deepEqual(order, ['root', 'a', 'b']);
  assert.equal(visited, 3);
});
