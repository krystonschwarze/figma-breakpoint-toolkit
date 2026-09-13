import {
  bareName,
  counterpartName,
  describeApply,
  describeBind,
  emptyApplyOutcome,
  errorDetail,
  findVariantProperty,
  normalizeName,
  pickCollection,
  pickVariable,
  recordFailure,
  recordReason,
} from './breakpoint.ts';
import { explainError } from './errors.ts';
import {
  modesOf,
  readCollections,
  resolveCollection,
  resolveVariable,
  stringVariablesOf,
} from './collections.ts';
import { DEFAULT_SETTINGS, sameRef } from './messages.ts';
import type {
  ApplyOutcome,
  ApplyRequest,
  BindOperation,
  BindOutcome,
  CollectionInfo,
  CollectionRef,
  Diagnostic,
  PluginMessage,
  ScanResult,
  SelectionState,
  Settings,
  UiMessage,
} from './messages.ts';
import { readSettings, sanitizeSettings, writeSettings } from './settings.ts';
import {
  describePrepare,
  emptyPrepareCounts,
  emptyPrepareOutcome,
  missingValues,
  variantValueOf,
  withVariantValue,
} from './variants.ts';
import type { PrepareCounts, PrepareOutcome } from './variants.ts';
import { walkTopDown } from './walk.ts';

const MAX_OPTION_LOOKUPS = 50;
const SCAN_DEBOUNCE_MS = 150;
const VARIANT_GAP = 40;
const COPY_GAP = 200;
const DIAGNOSTICS_KEY = 'breakpoint-toolkit.diagnostics';
const LEGACY_DIAGNOSTICS_KEY = 'make-mobile.diagnostics';

figma.showUI(__html__, {
  width: 320,
  height: 660,
  title: 'Breakpoint Toolkit',
  themeColors: true,
});

let settings: Settings = { ...DEFAULT_SETTINGS };
let collections: CollectionInfo[] = [];
let libraryError: string | null = null;
const diagnostics: Diagnostic[] = [];
let started = false;
let active: { ref: CollectionRef; collection: VariableCollection } | null = null;
let lastScan: ScanResult | null = null;
let scanGeneration = 0;
let scanTimer: ReturnType<typeof setTimeout> | undefined;

class StaleScan extends Error {}

function send(message: PluginMessage): void {
  figma.ui.postMessage(message);
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function errorText(error: unknown, fallback: string): string {
  const explained = explainError(errorDetail(error));
  return explained === '' ? fallback : explained;
}

/* A node the walk still holds a reference to may have been replaced by a variant switch. */
function alive(node: SceneNode): boolean {
  try {
    return !node.removed;
  } catch {
    return false;
  }
}

/*
 * The sandbox has no console the user can reach, so a failed step is also parked on the page as
 * plugin data. That is the only channel that survives the plugin window closing, which is what makes
 * a start failure debuggable at all. It is written on failure only.
 */
function note(step: string, error: unknown): void {
  const detail = errorText(error, 'unknown error');
  diagnostics.push({ step, detail });
  console.error(`Breakpoint Toolkit: ${step} failed`, error);
  try {
    figma.currentPage.setPluginData(DIAGNOSTICS_KEY, JSON.stringify(diagnostics));
  } catch {
    /* Nothing else to try. The UI still shows the same text. */
  }
}

function guardSync<T>(step: string, run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    note(step, error);
    return fallback;
  }
}

async function guard<T>(step: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    note(step, error);
    return fallback;
  }
}

function childrenOf(node: SceneNode): readonly SceneNode[] {
  return 'children' in node ? node.children : [];
}

function hasSelectedAncestor(node: SceneNode, selected: ReadonlySet<BaseNode>): boolean {
  let parent = node.parent;
  while (parent) {
    if (selected.has(parent)) return true;
    parent = parent.parent;
  }
  return false;
}

/* A layer selected together with its own ancestor would be walked twice, as a root and as a descendant. */
function roots(): SceneNode[] {
  const selection = figma.currentPage.selection;
  const selected = new Set<BaseNode>(selection);
  return selection.filter((node) => 'children' in node && !hasSelectedAncestor(node, selected));
}

function readSelection(): SelectionState {
  if (figma.currentPage.selection.length === 0) return { valid: false, reason: 'no-selection' };
  const usable = roots();
  if (usable.length === 0) return { valid: false, reason: 'no-children' };
  return { valid: true, names: usable.map((node) => node.name) };
}

function safeProperties(instance: InstanceNode): ComponentProperties | null {
  try {
    return instance.componentProperties;
  } catch {
    return null;
  }
}

// ── variant properties ──

function setDefinitions(set: ComponentSetNode): ComponentPropertyDefinitions | null {
  try {
    return set.componentPropertyDefinitions;
  } catch {
    return null;
  }
}

function variantOptionsInSet(set: ComponentSetNode, propertyName: string): string[] | null {
  const definitions = setDefinitions(set);
  if (!definitions) return null;
  const wanted = normalizeName(propertyName);
  const entry = Object.entries(definitions).find(
    ([name, definition]) =>
      definition.type === 'VARIANT' && normalizeName(bareName(name)) === wanted,
  );
  return entry ? (entry[1].variantOptions ?? []) : null;
}

function variantsOf(set: ComponentSetNode): ComponentNode[] {
  return set.children.filter((child): child is ComponentNode => child.type === 'COMPONENT');
}

/*
 * Which variants a missing value is copied from. The first wanted value is the natural source, and a
 * set that does not carry it falls back to whatever its default variant uses.
 */
function sourceValueOf(
  set: ComponentSetNode,
  propertyName: string,
  options: readonly string[],
  wanted: readonly string[],
): string | null {
  const first = wanted[0];
  const present =
    first === undefined
      ? undefined
      : options.find((option) => normalizeName(option) === normalizeName(first));
  if (present !== undefined) return present;
  try {
    return variantValueOf(set.defaultVariant.name, propertyName) ?? options[0] ?? null;
  } catch {
    return options[0] ?? null;
  }
}

function countPrepare(node: SceneNode, counts: PrepareCounts, counted: Set<string>): void {
  const values = settings.variantValues;
  if (values.length === 0) return;

  if (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET') {
    countPrepare(node.parent, counts, counted);
    return;
  }

  if (node.type === 'COMPONENT_SET') {
    if (counted.has(node.id)) return;
    counted.add(node.id);
    const options = variantOptionsInSet(node, settings.propertyName);
    const variants = variantsOf(node).length;
    if (options === null) {
      counts.sets += 1;
      counts.setVariants += variants;
      counts.newVariants += variants * (values.length - 1);
      return;
    }
    const missing = missingValues(options, values);
    if (missing.length === 0) {
      counts.ready += 1;
      return;
    }
    const source = sourceValueOf(node, settings.propertyName, options, values);
    const sources = variantsOf(node).filter(
      (variant) =>
        source !== null &&
        normalizeName(variantValueOf(variant.name, settings.propertyName) ?? '') ===
          normalizeName(source),
    ).length;
    counts.sets += 1;
    counts.setVariants += variants;
    counts.newVariants += sources * missing.length;
    return;
  }

  if (node.type === 'COMPONENT') {
    if (counted.has(node.id)) return;
    counted.add(node.id);
    counts.plain += 1;
    counts.newVariants += values.length - 1;
  }
}

// ── scan ──

interface OptionLookup {
  cache: Map<string, string[]>;
  lookups: number;
}

/*
 * A pure desktop screen only ever shows "Desktop" as a value, so the offered options have to come
 * from the component sets. The union stabilises after a handful of lookups, hence the cap.
 */
async function variantOptionsOf(
  instance: InstanceNode,
  propertyKey: string,
  state: OptionLookup,
): Promise<string[]> {
  if (state.lookups >= MAX_OPTION_LOOKUPS) return [];
  state.lookups += 1;
  try {
    const main = await instance.getMainComponentAsync();
    if (!main) return [];
    const cached = state.cache.get(main.id);
    if (cached) return cached;

    const wanted = normalizeName(bareName(propertyKey));
    let options: string[] = [];
    const set = main.parent;
    if (set?.type === 'COMPONENT_SET') {
      const definition = Object.entries(set.componentPropertyDefinitions).find(
        ([name, entry]) => entry.type === 'VARIANT' && normalizeName(bareName(name)) === wanted,
      );
      options = definition?.[1].variantOptions ?? [];
    }
    state.cache.set(main.id, options);
    return options;
  } catch {
    return [];
  }
}

async function scan(generation: number): Promise<void> {
  const targets = roots();
  const collection = active?.collection ?? null;
  const result: ScanResult = {
    nodes: 0,
    instances: 0,
    bound: 0,
    values: {},
    options: [],
    fixedModes: 0,
    fixedModesAnyCollection: 0,
    rootModes: [],
    prepare: emptyPrepareCounts(),
  };
  const options = new Set<string>();
  const lookup: OptionLookup = { cache: new Map(), lookups: 0 };
  const counted = new Set<string>();

  await walkTopDown(targets, {
    childrenOf,
    alive,
    visit: async (node, isRoot) => {
      result.nodes += 1;
      const explicit = node.explicitVariableModes;
      const modeId = collection ? explicit[collection.id] : undefined;
      if (isRoot) {
        const mode = collection?.modes.find((entry) => entry.modeId === modeId);
        result.rootModes.push(mode ? mode.name : null);
      } else {
        if (Object.keys(explicit).length > 0) result.fixedModesAnyCollection += 1;
        if (modeId !== undefined) result.fixedModes += 1;
      }

      countPrepare(node, result.prepare, counted);

      if (node.type !== 'INSTANCE') return;
      const properties = safeProperties(node);
      const property = properties ? findVariantProperty(properties, settings.propertyName) : null;
      if (!property) return;
      result.instances += 1;
      if (property.bound) result.bound += 1;
      result.values[property.value] = (result.values[property.value] ?? 0) + 1;
      for (const option of await variantOptionsOf(node, property.key, lookup)) options.add(option);
    },
    onYield: async () => {
      await tick();
      if (generation !== scanGeneration) throw new StaleScan();
    },
  });

  if (generation !== scanGeneration) return;
  result.options = [...options];
  lastScan = result;
  send({ type: 'scan', scan: result });
}

function requestScan(): void {
  clearTimeout(scanTimer);
  scanGeneration += 1;
  send({ type: 'scanning' });
  scanTimer = setTimeout(() => {
    const generation = scanGeneration;
    void scan(generation).catch((error: unknown) => {
      if (error instanceof StaleScan) return;
      send({ type: 'error', message: errorText(error, 'The selection could not be scanned.') });
    });
  }, SCAN_DEBOUNCE_MS);
}

// ── apply ──

async function ensureCollection(ref: CollectionRef): Promise<VariableCollection> {
  if (active && sameRef(active.ref, ref)) return active.collection;
  const collection = await resolveCollection(ref);
  active = { ref, collection };
  return collection;
}

function applyMode(node: SceneNode, collection: VariableCollection, modeId: string | null): void {
  if (modeId === null) node.clearExplicitVariableModeForCollection(collection);
  else node.setExplicitVariableModeForCollection(collection, modeId);
}

interface ModePlan {
  collection: VariableCollection;
  modeId: string | null;
  request: ApplyRequest;
  rootSet: ReadonlySet<BaseNode>;
}

function applyModes(node: SceneNode, isRoot: boolean, plan: ModePlan, outcome: ApplyOutcome): void {
  const { collection, modeId, request, rootSet } = plan;
  try {
    if (isRoot) {
      if (request.target !== null) {
        applyMode(node, collection, modeId);
        if (modeId === null) outcome.cleared += 1;
        else outcome.rootModes += 1;
      }
      return;
    }

    const directChild = node.parent !== null && rootSet.has(node.parent);
    if (directChild && request.target !== null && request.setChildrenModes) {
      applyMode(node, collection, modeId);
      outcome.childModes += 1;
      return;
    }

    if (request.resetNestedModes && node.explicitVariableModes[collection.id] !== undefined) {
      node.clearExplicitVariableModeForCollection(collection);
      if (node.explicitVariableModes[collection.id] === undefined) {
        outcome.cleared += 1;
      } else {
        outcome.failedModes += 1;
        recordReason(outcome.failures, node.name, 'the fixed mode was not reset, Figma kept it');
      }
    }
  } catch (error) {
    outcome.failedModes += 1;
    recordFailure(outcome.failures, node.name, error);
  }
}

function insideInstance(node: SceneNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'INSTANCE') return true;
    parent = parent.parent;
  }
  return false;
}

/*
 * Verified against Figma: a layer inside an instance keeps its width through a variant switch, and
 * neither resize nor swapComponent moves it. Only content driven axes follow. Worth reporting rather
 * than leaving someone to wonder why the mobile card is still desktop wide.
 */
async function countKeptSize(node: InstanceNode, outcome: ApplyOutcome): Promise<void> {
  if (!insideInstance(node)) return;
  try {
    const main = await node.getMainComponentAsync();
    if (!main) return;
    const widthKept =
      node.layoutSizingHorizontal === 'FIXED' && Math.abs(node.width - main.width) > 0.5;
    const heightKept =
      node.layoutSizingVertical === 'FIXED' && Math.abs(node.height - main.height) > 0.5;
    if (widthKept || heightKept) outcome.keptSize += 1;
  } catch {
    /* The count is a courtesy, never a reason to fail a run. */
  }
}

async function switchVariant(
  node: InstanceNode,
  request: ApplyRequest,
  outcome: ApplyOutcome,
): Promise<void> {
  const properties = safeProperties(node);
  const property = properties ? findVariantProperty(properties, request.propertyName) : null;
  if (!property) return;
  if (property.bound) {
    outcome.skippedBound += 1;
    return;
  }
  if (property.value === request.variantValue) {
    outcome.unchanged += 1;
    return;
  }

  try {
    node.setProperties({ [property.key]: request.variantValue });
    const after = safeProperties(node);
    const check = after ? findVariantProperty(after, request.propertyName) : null;
    if (check?.value === request.variantValue) {
      outcome.switched += 1;
      await countKeptSize(node, outcome);
    } else {
      outcome.failedVariants += 1;
      recordReason(
        outcome.failures,
        node.name,
        `stayed on ${check?.value ?? 'an unknown value'} instead of ${request.variantValue}`,
      );
    }
  } catch (error) {
    outcome.failedVariants += 1;
    recordFailure(outcome.failures, node.name, error);
  }
}

// ── copies and width ──

/* Every name a breakpoint may go by in this file, so a copy swaps the label instead of stacking it. */
function knownLabels(): string[] {
  const labels = new Set<string>(['Auto']);
  for (const value of settings.variantValues) labels.add(value);
  for (const name of Object.keys(settings.widths)) labels.add(name);
  for (const mode of active?.collection.modes ?? []) labels.add(mode.name);
  return [...labels];
}

/*
 * A copy goes to the right of its original, past the rightmost sibling that shares its row, so it
 * does not land on the next screen. Coordinates are parent relative, hence the sibling check. In an
 * auto layout parent Figma places the copy itself and ignores this.
 */
function placeRight(source: SceneNode, clone: SceneNode): void {
  const parent = source.parent;
  const siblings = parent !== null && 'children' in parent ? parent.children : [];
  const bottom = source.y + source.height;
  let x = source.x + source.width + COPY_GAP;
  for (const sibling of siblings) {
    if (sibling === clone || sibling === source) continue;
    if (sibling.y >= bottom || source.y >= sibling.y + sibling.height) continue;
    x = Math.max(x, sibling.x + sibling.width + COPY_GAP);
  }
  clone.x = x;
  clone.y = source.y;
}

/*
 * The frame itself is the one node a plugin may resize, and only outside an instance. An auto layout
 * frame that hugs on the width axis silently ignores a resize, so that axis is fixed first. The
 * width is read back, because silence is the failure mode here.
 */
function resizeRoot(node: SceneNode, width: number, outcome: ApplyOutcome): void {
  if (node.type === 'INSTANCE' || insideInstance(node)) {
    outcome.resizeKept += 1;
    recordReason(
      outcome.failures,
      node.name,
      'an instance keeps its width, Figma allows no resize',
    );
    return;
  }
  if (!('resize' in node)) {
    outcome.resizeKept += 1;
    recordReason(outcome.failures, node.name, 'this layer has no width to set');
    return;
  }

  try {
    if ('layoutMode' in node) {
      if (node.layoutMode === 'VERTICAL' && node.counterAxisSizingMode === 'AUTO') {
        node.counterAxisSizingMode = 'FIXED';
      }
      if (node.layoutMode === 'HORIZONTAL' && node.primaryAxisSizingMode === 'AUTO') {
        node.primaryAxisSizingMode = 'FIXED';
      }
    }
    node.resize(width, node.height);
    if (Math.abs(node.width - width) <= 0.5) {
      outcome.resized += 1;
    } else {
      outcome.resizeKept += 1;
      recordReason(outcome.failures, node.name, `stayed ${Math.round(node.width)} wide`);
    }
  } catch (error) {
    outcome.resizeKept += 1;
    recordFailure(outcome.failures, node.name, error);
  }
}

/*
 * Renamed and resized before it is placed: with two screens selected the second copy then packs
 * against the first copy at its new width, instead of against the desktop width it started out with.
 */
function duplicateRoots(
  sources: readonly SceneNode[],
  request: ApplyRequest,
  width: number | null,
  outcome: ApplyOutcome,
): SceneNode[] {
  const labels = knownLabels();
  const clones: SceneNode[] = [];
  for (const source of sources) {
    try {
      const clone = source.clone();
      clone.name = counterpartName(source.name, request.label, labels);
      if (width !== null) resizeRoot(clone, width, outcome);
      placeRight(source, clone);
      outcome.duplicated += 1;
      clones.push(clone);
    } catch (error) {
      recordFailure(outcome.failures, source.name, error);
    }
  }
  return clones;
}

/*
 * The button Figma offers on the frame itself, under Plugins in the right panel. Its label comes from
 * the manifest, the line under it names the breakpoint the frame carries now.
 */
function markRelaunch(node: SceneNode, label: string): void {
  try {
    node.setRelaunchData({ switch: label === '' ? '' : `Now ${label}` });
  } catch {
    /* Plugin data needs the manifest id. The button is a courtesy, never worth failing a run for. */
  }
}

async function apply(request: ApplyRequest): Promise<ApplyOutcome> {
  const sources = roots();
  if (sources.length === 0) throw new Error('Select a frame, section or instance first.');
  if (request.switchVariants && request.variantValue === '') {
    throw new Error('Pick the variant value to switch to.');
  }

  /* Resolved before anything is written, so a stale collection does not leave a copy behind. */
  const touchesModes = request.target !== null;
  let collection: VariableCollection | null = null;
  let modeId: string | null = null;
  if (touchesModes || request.resetNestedModes) {
    if (!request.collection) throw new Error('Pick the mode collection in the settings first.');
    collection = await ensureCollection(request.collection);
    if (request.target?.kind === 'mode') {
      const wanted = request.target.modeId;
      if (!collection.modes.some((mode) => mode.modeId === wanted)) {
        throw new Error('That mode no longer exists in the collection.');
      }
      modeId = wanted;
    }
  }

  const outcome = emptyApplyOutcome();
  const asked = request.width;
  const width = asked !== null && Number.isFinite(asked) && asked > 0 ? asked : null;
  const targets = request.duplicate
    ? duplicateRoots(sources, request, width, outcome)
    : [...sources];
  if (targets.length === 0) throw new Error('The selection could not be copied.');

  /* A copy is already resized, at the point where its own width still decides where it lands. */
  if (!request.duplicate && width !== null) {
    for (const target of targets) resizeRoot(target, width, outcome);
  }

  const plan: ModePlan | null = collection
    ? { collection, modeId, request, rootSet: new Set<BaseNode>(targets) }
    : null;
  const total = lastScan?.nodes ?? 0;

  await walkTopDown(targets, {
    childrenOf,
    alive,
    visit: async (node, isRoot) => {
      outcome.nodes += 1;
      if (plan) applyModes(node, isRoot, plan, outcome);
      if (request.switchVariants && node.type === 'INSTANCE') {
        await switchVariant(node, request, outcome);
      }
    },
    onYield: async (visited) => {
      send({ type: 'progress', done: visited, total });
      await tick();
    },
  });

  for (const target of targets) markRelaunch(target, request.label);
  if (request.duplicate) {
    figma.currentPage.selection = targets;
    figma.viewport.scrollAndZoomIntoView(targets);
  }

  figma.commitUndo();
  return outcome;
}

// ── prepare ──

interface PrepareTargets {
  plain: ComponentNode[];
  sets: ComponentSetNode[];
}

/*
 * Collected before anything is written. Combining as variants reparents the component into a brand
 * new set, so a walk that acts as it goes would then descend into a tree it has just replaced.
 */
function collectPrepareTargets(): PrepareTargets {
  const plain = new Map<string, ComponentNode>();
  const sets = new Map<string, ComponentSetNode>();

  function visit(node: SceneNode): void {
    if (node.type === 'COMPONENT_SET') {
      sets.set(node.id, node);
      return;
    }
    if (node.type === 'COMPONENT') {
      /* Clicking a single variant means the set it belongs to, which is where the property lives. */
      const parent = node.parent;
      if (parent?.type === 'COMPONENT_SET') sets.set(parent.id, parent);
      else plain.set(node.id, node);
    }
    if ('children' in node) for (const child of node.children) visit(child);
  }

  for (const root of roots()) visit(root);
  return { plain: [...plain.values()], sets: [...sets.values()] };
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function childrenBox(nodes: readonly SceneNode[]): Box | null {
  if (nodes.length === 0) return null;
  return nodes.reduce<Box>(
    (box, node) => ({
      minX: Math.min(box.minX, node.x),
      minY: Math.min(box.minY, node.y),
      maxX: Math.max(box.maxX, node.x + node.width),
      maxY: Math.max(box.maxY, node.y + node.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

/* A set does not grow with the variants an API call appends, so it is resized around them. */
function fitSetAroundVariants(set: ComponentSetNode): void {
  const box = childrenBox(set.children);
  if (!box) return;
  set.resizeWithoutConstraints(
    Math.max(1, box.maxX + Math.max(0, box.minX)),
    Math.max(1, box.maxY + Math.max(0, box.minY)),
  );
}

function preparePlain(
  component: ComponentNode,
  propertyName: string,
  values: readonly string[],
  outcome: PrepareOutcome,
): void {
  const parent = component.parent;
  const first = values[0];
  if (!parent || first === undefined) {
    outcome.skipped += 1;
    return;
  }

  const setName = component.name;
  try {
    /* The first value stays top left, which is what makes it the default variant Figma hands out. */
    component.name = `${propertyName}=${first}`;
    const copies: ComponentNode[] = [];
    let y = component.y + component.height + VARIANT_GAP;
    for (const value of values.slice(1)) {
      const copy = component.clone();
      parent.appendChild(copy);
      copy.name = `${propertyName}=${value}`;
      copy.x = component.x;
      copy.y = y;
      y += copy.height + VARIANT_GAP;
      copies.push(copy);
    }

    try {
      const set = figma.combineAsVariants([component, ...copies], parent);
      set.name = setName;
      const options = variantOptionsInSet(set, propertyName) ?? [];
      if (missingValues(options, values).length > 0) {
        outcome.failed += 1;
        recordReason(outcome.failures, setName, 'the set came out without every value');
        return;
      }
      outcome.created += 1;
      outcome.variants += copies.length;
    } catch (error) {
      /* Without this the component is left renamed and the copies stay next to it. */
      for (const copy of copies) copy.remove();
      component.name = setName;
      throw error;
    }
  } catch (error) {
    outcome.failed += 1;
    recordFailure(outcome.failures, setName, error);
  }
}

function prepareSet(
  set: ComponentSetNode,
  propertyName: string,
  values: readonly string[],
  outcome: PrepareOutcome,
): void {
  try {
    let options = variantOptionsInSet(set, propertyName);
    let extended = false;
    const first = values[0];
    if (options === null && first !== undefined) {
      set.addComponentProperty(propertyName, 'VARIANT', first);
      options = variantOptionsInSet(set, propertyName) ?? [first];
      extended = true;
    }
    if (options === null) {
      outcome.skipped += 1;
      return;
    }

    const missing = missingValues(options, values);
    if (missing.length === 0) {
      if (extended) outcome.extended += 1;
      else outcome.skipped += 1;
      return;
    }

    const source = sourceValueOf(set, propertyName, options, values);
    const sources = variantsOf(set).filter(
      (variant) =>
        source !== null &&
        normalizeName(variantValueOf(variant.name, propertyName) ?? '') === normalizeName(source),
    );
    const box = childrenBox(sources);
    if (sources.length === 0 || !box) {
      outcome.failed += 1;
      recordReason(outcome.failures, set.name, 'there is no variant to copy the new value from');
      return;
    }

    /*
     * Each new value gets its own column to the right, so the default variant stays top left. A set
     * with auto layout places its own children, and writing coordinates into it only fights it.
     */
    const flows = set.layoutMode !== 'NONE';
    let offset = (childrenBox(set.children)?.maxX ?? box.maxX) + VARIANT_GAP - box.minX;
    for (const value of missing) {
      for (const variant of sources) {
        const copy = variant.clone();
        set.appendChild(copy);
        copy.name = withVariantValue(variant.name, propertyName, value);
        if (!flows) {
          copy.x = variant.x + offset;
          copy.y = variant.y;
        }
        outcome.variants += 1;
      }
      offset += box.maxX - box.minX + VARIANT_GAP;
    }
    if (!flows) fitSetAroundVariants(set);

    const after = variantOptionsInSet(set, propertyName) ?? [];
    const stillMissing = missingValues(after, values);
    if (stillMissing.length > 0) {
      outcome.failed += 1;
      recordReason(outcome.failures, set.name, `${stillMissing.join(', ')} did not stick`);
      return;
    }
    outcome.extended += 1;
  } catch (error) {
    outcome.failed += 1;
    recordFailure(outcome.failures, set.name, error);
  }
}

function prepare(): PrepareOutcome {
  const values = settings.variantValues;
  if (values.length === 0) throw new Error('Add at least one value, for example Desktop, Mobile.');

  const targets = collectPrepareTargets();
  if (targets.plain.length === 0 && targets.sets.length === 0) {
    throw new Error('Select a component or a component set first.');
  }

  const outcome = emptyPrepareOutcome();
  for (const component of targets.plain) {
    preparePlain(component, settings.propertyName, values, outcome);
  }
  for (const set of targets.sets) {
    prepareSet(set, settings.propertyName, values, outcome);
  }

  figma.commitUndo();
  return outcome;
}

// ── bind ──

async function rebind(propertyName: string, variable: Variable | null): Promise<BindOutcome> {
  const targets = roots();
  if (targets.length === 0) throw new Error('Select a frame, section or instance first.');

  const alias = variable ? figma.variables.createVariableAlias(variable) : null;
  const outcome: BindOutcome = { changed: 0, unchanged: 0, failed: 0, failures: [] };
  const total = lastScan?.nodes ?? 0;

  await walkTopDown(targets, {
    childrenOf,
    alive,
    visit: (node) => {
      if (node.type !== 'INSTANCE') return;
      const properties = safeProperties(node);
      const property = properties ? findVariantProperty(properties, propertyName) : null;
      if (!properties || !property) return;

      const current = properties[property.key]?.boundVariables?.value;
      if (alias ? current?.id === alias.id : current === undefined) {
        outcome.unchanged += 1;
        return;
      }

      try {
        node.setProperties({ [property.key]: alias ?? property.value });
        const after = safeProperties(node)?.[property.key]?.boundVariables?.value;
        const stuck = alias ? after?.id === alias.id : after === undefined;
        if (stuck) {
          outcome.changed += 1;
        } else {
          outcome.failed += 1;
          recordReason(
            outcome.failures,
            node.name,
            alias ? 'the binding did not stick' : 'the binding stayed in place',
          );
        }
      } catch (error) {
        outcome.failed += 1;
        recordFailure(outcome.failures, node.name, error);
      }
    },
    onYield: async (visited) => {
      send({ type: 'progress', done: visited, total });
      await tick();
    },
  });

  figma.commitUndo();
  return outcome;
}

// ── collections and settings ──

async function loadCollection(ref: CollectionRef | null): Promise<void> {
  if (ref === null) {
    active = null;
    send({
      type: 'collection',
      collection: null,
      modes: [],
      variables: [],
      variable: settings.variable,
      error: null,
    });
    requestScan();
    return;
  }

  try {
    const collection = await resolveCollection(ref);
    active = { ref, collection };
    const variables = await stringVariablesOf(ref);
    const known =
      settings.variable !== null &&
      variables.some((variable) => sameRef(variable, settings.variable));
    if (!known) {
      settings = { ...settings, variable: pickVariable(variables, settings.propertyName) };
      await writeSettings(settings);
    }
    send({
      type: 'collection',
      collection: ref,
      modes: modesOf(collection),
      variables,
      variable: settings.variable,
      error: null,
    });
  } catch (error) {
    active = null;
    send({
      type: 'collection',
      collection: ref,
      modes: [],
      variables: [],
      variable: settings.variable,
      error: errorText(error, 'The collection could not be loaded.'),
    });
  }
  requestScan();
}

async function finishBind(
  operation: BindOperation,
  propertyName: string,
  variable: Variable | null,
): Promise<void> {
  const outcome = await rebind(propertyName, variable);
  send({ type: 'bound', outcome, operation });
  figma.notify(describeBind(outcome, operation), { error: outcome.failed > 0 });
  requestScan();
}

async function handleMessage(message: UiMessage): Promise<void> {
  switch (message.type) {
    /*
     * Figma drops messages posted before the iframe is listening, so the UI asks for its state.
     * Answering before start() has finished would hand it the defaults, and the UI would save those
     * back over the collection start is still resolving. Start sends its own init in that case.
     */
    case 'ready':
      if (!started) return;
      sendInit();
      if (active) {
        send({
          type: 'collection',
          collection: active.ref,
          modes: modesOf(active.collection),
          variables: await stringVariablesOf(active.ref),
          variable: settings.variable,
          error: null,
        });
      }
      requestScan();
      return;

    case 'reload': {
      const list = await readCollections();
      collections = list.collections;
      libraryError = list.libraryError;
      send({ type: 'collections', collections, libraryError: libraryError });
      return;
    }

    case 'rescan':
      requestScan();
      return;

    case 'save-settings': {
      const next = sanitizeSettings(message.settings);
      const collectionChanged = !sameRef(next.collection, settings.collection);
      const propertyChanged = next.propertyName !== settings.propertyName;
      settings = next;
      await writeSettings(settings);
      if (collectionChanged) await loadCollection(settings.collection);
      else if (propertyChanged) requestScan();
      return;
    }

    case 'apply': {
      const outcome = await apply(message.request);
      send({ type: 'applied', outcome });
      figma.notify(describeApply(outcome, message.request.propertyName), {
        error: outcome.failedVariants + outcome.failedModes > 0,
      });
      requestScan();
      return;
    }

    case 'bind': {
      const variable = await resolveVariable(message.variable);
      if (variable.resolvedType !== 'STRING') {
        throw new Error('Only a string variable can drive a variant property.');
      }
      await finishBind('bind', message.propertyName, variable);
      return;
    }

    case 'unbind':
      await finishBind('unbind', message.propertyName, null);
      return;

    case 'prepare': {
      const outcome = prepare();
      send({ type: 'prepared', outcome });
      figma.notify(describePrepare(outcome, settings.propertyName), {
        error: outcome.failed > 0,
      });
      requestScan();
      return;
    }
  }
}

figma.ui.onmessage = (message: UiMessage) => {
  void handleMessage(message).catch((error: unknown) => {
    const detail = errorText(error, 'Unknown error');
    send({ type: 'error', message: detail });
    figma.notify(detail, { error: true });
  });
};

figma.on('selectionchange', () => {
  if (!started) return;
  send({
    type: 'selection',
    selection: guardSync('read the selection', readSelection, {
      valid: false,
      reason: 'no-selection',
    }),
  });
  requestScan();
});

function sendInit(): void {
  send({
    type: 'init',
    diagnostics,
    settings,
    collections,
    libraryError,
    selection: guardSync('read the selection', readSelection, {
      valid: false,
      reason: 'no-selection',
    }),
  });
}

/*
 * Every step stands on its own. A plugin that refuses to open because one call failed is a plugin
 * nobody can debug, so a broken step degrades to its fallback and says so in the window instead.
 */
async function start(): Promise<void> {
  settings = await guard('read the settings', readSettings, { ...DEFAULT_SETTINGS });

  const list = await guard('read the variable collections', readCollections, {
    collections: [],
    libraryError: null,
  });
  collections = list.collections;
  libraryError = list.libraryError;

  const stillThere =
    settings.collection !== null &&
    collections.some((collection) => sameRef(collection, settings.collection));
  if (!stillThere) {
    settings = { ...settings, collection: pickCollection(collections, settings.propertyName) };
    if (settings.collection !== null) {
      await guard('store the settings', () => writeSettings(settings), settings);
    }
  }

  started = true;
  sendInit();
  await guard('load the mode collection', () => loadCollection(settings.collection), undefined);

  if (diagnostics.length === 0) {
    /* A cause that has been fixed must not keep haunting the file it was recorded in. */
    try {
      for (const key of [DIAGNOSTICS_KEY, LEGACY_DIAGNOSTICS_KEY]) {
        if (figma.currentPage.getPluginData(key) !== '') figma.currentPage.setPluginData(key, '');
      }
    } catch {
      /* Reading or writing plugin data is not essential here. */
    }
  }

  if (diagnostics.length > 0) {
    const summary = diagnostics
      .map((entry) => `Could not ${entry.step}: ${entry.detail}`)
      .join('\n');
    send({ type: 'error', message: summary });
    figma.notify(`Breakpoint Toolkit: ${diagnostics.length} step(s) failed, see the window.`, {
      error: true,
    });
  }
}

void start().catch((error: unknown) => {
  const detail = errorText(error, 'Breakpoint Toolkit could not start.');
  note('start', error);
  send({ type: 'error', message: detail });
  figma.notify(detail, { error: true });
});
