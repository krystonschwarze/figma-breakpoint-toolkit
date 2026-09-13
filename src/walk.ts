export interface WalkOptions<T> {
  readonly childrenOf: (node: T) => readonly T[];
  readonly visit: (node: T, isRoot: boolean) => void | Promise<void>;
  /* Switching a variant replaces the layers inside it, so a queued sibling can be gone by its turn. */
  readonly alive?: (node: T) => boolean;
  readonly yieldEvery?: number;
  readonly onYield?: (visited: number) => void | Promise<void>;
}

/*
 * Pre-order, and the children of a node are read only after that node has been visited. Switching an
 * instance to another variant replaces its whole subtree, so a list collected up front would point at
 * layers that no longer exist and miss the ones that took their place.
 */
export async function walkTopDown<T>(
  roots: readonly T[],
  options: WalkOptions<T>,
): Promise<number> {
  const yieldEvery = options.yieldEvery ?? 40;
  let visited = 0;

  async function step(node: T, isRoot: boolean): Promise<void> {
    if (options.alive && !options.alive(node)) return;
    await options.visit(node, isRoot);
    visited += 1;
    if (options.onYield && visited % yieldEvery === 0) await options.onYield(visited);
    for (const child of [...options.childrenOf(node)]) await step(child, false);
  }

  for (const root of roots) await step(root, true);
  return visited;
}
