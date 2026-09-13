import './styles.css';
import {
  bindFieldFocus,
  bindSegmented,
  byId,
  clear,
  fillSelect,
  onPluginMessage,
  postToPlugin,
  readNumber,
  setVisible,
  showNotice,
} from '../../ui-kit/kit.ts';
import type { NoticeKind } from '../../ui-kit/kit.ts';
import {
  describeApply,
  describeBind,
  normalizeName,
  plural,
  resolveVariantChoice,
  widthFor,
} from '../breakpoint.ts';
import type { VariantChoice } from '../breakpoint.ts';
import { DEFAULT_SETTINGS, refKey, sameRef } from '../messages.ts';
import {
  addValue,
  describePrepare,
  describePrepareCounts,
  promoteValue,
  removeValue,
  valueProblem,
} from '../variants.ts';
import type {
  ApplyRequest,
  CollectionInfo,
  Diagnostic,
  ModeInfo,
  ModeTarget,
  PluginMessage,
  ScanResult,
  SelectionState,
  Settings,
  UiMessage,
  VariableInfo,
} from '../messages.ts';

const AUTO_TARGET = '$auto';

const EMPTY_MESSAGES = {
  'no-selection': 'Select a screen to convert, or a component to give the property to.',
  'no-children': 'The selected layer is empty. Select a frame, an instance or a component.',
};

const el = {
  headerMeta: byId('headerMeta'),
  rescan: byId<HTMLButtonElement>('rescan'),
  openSettings: byId<HTMLButtonElement>('openSettings'),
  closeSettings: byId<HTMLButtonElement>('closeSettings'),
  operationSwitch: byId('operationSwitch'),
  emptyView: byId('emptyView'),
  emptyMessage: byId('emptyMessage'),
  switchView: byId('switchView'),
  bindView: byId('bindView'),
  prepareView: byId('prepareView'),
  prepareValues: byId('prepareValues'),
  prepareValuesHint: byId('prepareValuesHint'),
  prepareHint: byId('prepareHint'),
  prepareFooter: byId('prepareFooter'),
  prepareApply: byId<HTMLButtonElement>('prepareApply'),
  modeGroup: byId('modeGroup'),
  modeHint: byId('modeHint'),
  duplicate: byId<HTMLInputElement>('duplicate'),
  resizeRoot: byId<HTMLInputElement>('resizeRoot'),
  resizeRootLabel: byId('resizeRootLabel'),
  frameHint: byId('frameHint'),
  switchVariants: byId<HTMLInputElement>('switchVariants'),
  switchVariantsLabel: byId('switchVariantsLabel'),
  variantValue: byId<HTMLSelectElement>('variantValue'),
  variantHint: byId('variantHint'),
  resetNestedModes: byId<HTMLInputElement>('resetNestedModes'),
  setChildrenModes: byId<HTMLInputElement>('setChildrenModes'),
  modesHint: byId('modesHint'),
  variableSelect: byId<HTMLSelectElement>('variableSelect'),
  variableHint: byId('variableHint'),
  bindHint: byId('bindHint'),
  noticeGroup: byId('noticeGroup'),
  notice: byId('notice'),
  switchFooter: byId('switchFooter'),
  apply: byId<HTMLButtonElement>('apply'),
  bindFooter: byId('bindFooter'),
  bind: byId<HTMLButtonElement>('bind'),
  unbind: byId<HTMLButtonElement>('unbind'),
  settingsView: byId('settingsView'),
  propertyName: byId<HTMLInputElement>('propertyName'),
  collectionSelect: byId<HTMLSelectElement>('collectionSelect'),
  libraryHint: byId('libraryHint'),
  reload: byId<HTMLButtonElement>('reload'),
  widthRows: byId('widthRows'),
  addWidth: byId<HTMLButtonElement>('addWidth'),
};

type Operation = 'switch' | 'bind' | 'prepare';

let operation: Operation = 'switch';
let settings: Settings = { ...DEFAULT_SETTINGS };
let collections: CollectionInfo[] = [];
let libraryError: string | null = null;
let modes: ModeInfo[] = [];
let variables: VariableInfo[] = [];
let collectionError: string | null = null;
let selection: SelectionState = { valid: false, reason: 'no-selection' };
let scan: ScanResult | null = null;
let initialised = false;
let scanning = false;
let busy = false;
let working: HTMLButtonElement | null = null;
let flashing: HTMLButtonElement | null = null;
let flashTimer = 0;

function send(message: UiMessage): void {
  postToPlugin(message);
}

function saveSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  send({ type: 'save-settings', settings });
}

function notice(kind: NoticeKind, text: string): void {
  setVisible(el.noticeGroup, true);
  showNotice(el.notice, kind, text);
}

function clearNotice(): void {
  setVisible(el.noticeGroup, false);
  el.notice.textContent = '';
}

/* A render fired by a plugin message must not rewrite the control the person is using right now. */
function inUse(control: HTMLElement): boolean {
  return document.activeElement === control;
}

function collectionLabel(collection: CollectionInfo): string {
  return collection.libraryName === null
    ? collection.name
    : `${collection.libraryName} · ${collection.name}`;
}

function currentCollection(): CollectionInfo | undefined {
  return collections.find((collection) => sameRef(collection, settings.collection));
}

function hasModes(): boolean {
  return settings.collection !== null && collectionError === null && modes.length > 0;
}

function variantOptions(): string[] {
  const options = new Set<string>(scan?.options ?? []);
  for (const value of Object.keys(scan?.values ?? {})) options.add(value);
  return [...options];
}

function targetModeName(): string | null {
  return settings.targetMode === null || settings.targetMode === AUTO_TARGET
    ? null
    : settings.targetMode;
}

/* The name the chosen breakpoint goes by: a mode name, a variant option, or Auto. */
function targetLabel(): string {
  if (settings.targetMode === AUTO_TARGET) return 'Auto';
  return settings.targetMode ?? '';
}

function targetWidth(): number | null {
  return widthFor(settings.widths, targetModeName());
}

function modeTarget(): ModeTarget | null {
  if (!hasModes() || settings.targetMode === null) return null;
  if (settings.targetMode === AUTO_TARGET) return { kind: 'auto' };
  const mode = modes.find((entry) => entry.name === settings.targetMode);
  return mode ? { kind: 'mode', modeId: mode.id } : null;
}

// ── breakpoint target ──

interface TargetEntry {
  value: string;
  label: string;
}

/* Without a collection the variant options stand in, so the plugin still works on variants alone. */
function targetEntries(): TargetEntry[] {
  if (hasModes()) {
    return [
      ...modes.map((mode) => ({ value: mode.name, label: mode.name })),
      { value: AUTO_TARGET, label: 'Auto' },
    ];
  }
  return variantOptions().map((option) => ({ value: option, label: option }));
}

/*
 * Picking a target locally is fine at any time, but writing it back before the plugin has sent its
 * settings would save this window's defaults over them.
 */
function ensureTarget(entries: TargetEntry[]): void {
  if (entries.length === 0) return;
  if (entries.some((entry) => entry.value === settings.targetMode)) return;
  const mobile = entries.find((entry) => normalizeName(entry.value) === 'mobile');
  const next = (mobile ?? entries[0])?.value ?? null;
  if (next === settings.targetMode) return;
  if (initialised) saveSettings({ targetMode: next });
  else settings = { ...settings, targetMode: next };
}

function renderModeGroup(): void {
  clear(el.modeGroup);
  const entries = targetEntries();
  setVisible(el.modeGroup, entries.length > 0);

  if (entries.length === 0) {
    el.modeHint.textContent = scanning
      ? 'Scanning the selection.'
      : 'Pick the mode collection in the settings, or select a screen whose instances carry the variant property.';
    return;
  }

  ensureTarget(entries);
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fig-segment segment-text';
    button.dataset.value = entry.value;
    button.textContent = entry.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(entry.value === settings.targetMode));
    button.disabled = busy;
    button.addEventListener('click', () => {
      saveSettings({ targetMode: entry.value });
      render();
    });
    el.modeGroup.appendChild(button);
  }

  const collection = currentCollection();
  el.modeHint.textContent =
    hasModes() && collection
      ? `Sets the mode from ${collectionLabel(collection)} on the selection. Auto clears it instead, so the frame inherits.`
      : 'No mode collection chosen, so only the variant property is switched.';
}

el.modeGroup.addEventListener('keydown', (event: KeyboardEvent) => {
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (delta === 0) return;
  event.preventDefault();
  const segments = Array.from(el.modeGroup.querySelectorAll<HTMLButtonElement>('.fig-segment'));
  const current = segments.findIndex((segment) => segment.getAttribute('aria-selected') === 'true');
  const next = segments[(current + delta + segments.length) % segments.length];
  if (!next) return;
  next.click();
  el.modeGroup.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
});

// ── variants ──

function variantChoice(): VariantChoice {
  const modeName = targetModeName();
  return resolveVariantChoice(
    hasModes(),
    modeName,
    variantOptions(),
    modeName === null ? undefined : settings.variantForMode[modeName],
    el.variantValue.value,
  );
}

// ── frame ──

function renderFrame(): void {
  const width = targetWidth();
  const label = targetLabel();
  el.duplicate.checked = settings.duplicate;
  el.duplicate.disabled = busy;
  el.resizeRoot.checked = settings.resizeRoot && width !== null;
  el.resizeRoot.disabled = busy || width === null;
  el.resizeRootLabel.textContent = width === null ? 'Set the width' : `Set the width to ${width}`;

  const parts: string[] = [];
  if (settings.duplicate) {
    parts.push(
      label === ''
        ? 'A copy lands beside the original and carries the change.'
        : `A copy lands beside the original, named after ${label}.`,
    );
  }
  if (width === null && label === 'Auto') {
    parts.push('Auto inherits its breakpoint, so it names no width.');
  } else if (width === null && label !== '') {
    parts.push(`No width for ${label} yet, the settings hold the list.`);
  }
  el.frameHint.textContent = parts.join(' ');
}

function renderVariants(): void {
  el.switchVariants.checked = settings.switchVariants;
  el.switchVariants.disabled = busy;
  el.switchVariantsLabel.textContent = `Switch ${settings.propertyName} on nested instances`;

  const options = variantOptions();
  const { value, needsChoice } = variantChoice();
  setVisible(el.variantValue, needsChoice);
  if (needsChoice && !inUse(el.variantValue)) {
    fillSelect(
      el.variantValue,
      'Pick a value',
      options.map((option) => ({ value: option, label: option })),
    );
    el.variantValue.value = options.includes(value) ? value : '';
  }
  el.variantValue.disabled = !settings.switchVariants || busy;

  if (scanning) {
    el.variantHint.textContent = 'Scanning the selection.';
    return;
  }
  if (!scan) {
    el.variantHint.textContent = '';
    return;
  }

  if (scan.instances === 0) {
    el.variantHint.textContent = `Nothing in the selection carries ${settings.propertyName}.`;
    return;
  }

  const parts = [`${plural(scan.instances, 'instance')} carry ${settings.propertyName}`];
  if (scan.bound > 0) parts.push(`${scan.bound} follow a variable and are left alone`);
  let text = parts.join(', ') + '.';
  const modeName = targetModeName();
  if (needsChoice) {
    text +=
      modeName === null
        ? ' Auto leaves the breakpoint open, so pick the value to switch them to.'
        : ` There is no ${modeName} variant, so pick the value to use for it.`;
  } else if (options.length === 0) {
    text += ` No ${settings.propertyName} variant options were found.`;
  }
  el.variantHint.textContent = text;
}

// ── modes ──

function renderModes(): void {
  const enabled = hasModes() && !busy;
  el.resetNestedModes.checked = settings.resetNestedModes;
  el.resetNestedModes.disabled = !enabled;
  el.setChildrenModes.checked = settings.setChildrenModes;
  el.setChildrenModes.disabled = !enabled;

  if (collectionError !== null) {
    el.modesHint.textContent = collectionError;
    return;
  }
  if (settings.collection === null) {
    el.modesHint.textContent = 'Pick the mode collection in the settings to set or reset modes.';
    return;
  }
  if (modes.length === 0) {
    el.modesHint.textContent = 'Loading the collection.';
    return;
  }
  if (scanning || !scan) {
    el.modesHint.textContent = scanning ? 'Scanning the selection.' : '';
    return;
  }

  const rootNames = scan.rootModes.map((mode) => mode ?? 'Auto');
  const roots =
    rootNames.length === 1
      ? `The selected frame is on ${rootNames[0] ?? 'Auto'}.`
      : `The selected frames are on ${rootNames.join(', ')}.`;
  const nested =
    scan.fixedModes === 0
      ? 'No nested layer has a fixed mode.'
      : `${plural(scan.fixedModes, 'nested layer')} carry a fixed mode and would stop inheriting.`;
  el.modesHint.textContent = `${roots} ${nested}`;
}

// ── bind ──

function renderBind(): void {
  const placeholder =
    settings.collection === null
      ? 'Pick a mode collection in the settings first'
      : variables.length === 0
        ? modes.length === 0
          ? 'Loading the collection'
          : 'No string variables in this collection'
        : 'Pick a variable';
  if (!inUse(el.variableSelect)) {
    fillSelect(
      el.variableSelect,
      placeholder,
      variables.map((variable) => ({ value: refKey(variable), label: variable.name })),
    );
    const known =
      settings.variable !== null &&
      variables.some((variable) => sameRef(variable, settings.variable));
    el.variableSelect.value = known && settings.variable ? refKey(settings.variable) : '';
  }
  el.variableSelect.disabled = variables.length === 0 || busy;
  el.variableHint.textContent = `A string variable whose value per mode names the ${settings.propertyName} variant, for example Desktop and Mobile. Bound instances then follow the mode of their frame.`;

  if (scanning) {
    el.bindHint.textContent = 'Scanning the selection.';
    return;
  }
  if (!scan) {
    el.bindHint.textContent = '';
    return;
  }
  el.bindHint.textContent = `${plural(scan.instances, 'instance')} carry ${settings.propertyName}, ${scan.bound} already follow a variable. Unbind writes the current value back as a plain variant.`;
}

// ── prepare ──

const REMOVE_SVG =
  '<svg viewBox="0 0 8 8" fill="none" aria-hidden="true"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

const MAX_VALUES = 6;

function valueChip(value: string, isDefault: boolean, removable: boolean): HTMLElement {
  const chip = document.createElement('span');
  chip.className = isDefault ? 'value-chip value-chip--default' : 'value-chip';

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'value-chip__name';
  name.textContent = value;
  name.disabled = isDefault || busy;
  name.title = isDefault ? `${value} is the default variant` : `Make ${value} the default`;
  name.addEventListener('click', () => {
    saveSettings({ variantValues: promoteValue(settings.variantValues, value) });
    render();
  });
  chip.appendChild(name);

  if (removable) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'value-chip__remove';
    remove.title = `Remove ${value}`;
    remove.innerHTML = REMOVE_SVG;
    remove.disabled = busy;
    remove.addEventListener('click', () => {
      saveSettings({ variantValues: removeValue(settings.variantValues, value) });
      render();
    });
    chip.appendChild(remove);
  }

  return chip;
}

/* The add chip turns into its own small input, so a value can hold anything but a comma. */
function askForValue(add: HTMLButtonElement): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'value-input';
  input.placeholder = 'Tablet';
  input.spellcheck = false;
  el.prepareValues.replaceChild(input, add);
  input.focus();

  let settled = false;
  const restore = (): void => {
    if (input.parentNode === el.prepareValues) el.prepareValues.replaceChild(add, input);
  };
  const commit = (): void => {
    if (settled) return;
    settled = true;
    const value = input.value.trim();
    /* The row is put back first: a render while the input still hangs in it would skip the rebuild. */
    restore();
    if (value === '') return;
    const problem = valueProblem(value);
    if (problem !== null) {
      notice('error', problem);
      return;
    }
    clearNotice();
    saveSettings({ variantValues: addValue(settings.variantValues, value) });
    render();
  };

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') {
      settled = true;
      restore();
    }
  });
  input.addEventListener('blur', commit);
}

function renderPrepare(): void {
  const values = settings.variantValues;
  if (!el.prepareValues.querySelector('.value-input')) {
    clear(el.prepareValues);
    values.forEach((value, index) => {
      el.prepareValues.appendChild(valueChip(value, index === 0, values.length > 1));
    });

    if (values.length < MAX_VALUES) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'value-add';
      add.textContent = 'Add value';
      add.disabled = busy;
      add.addEventListener('click', () => askForValue(add));
      el.prepareValues.appendChild(add);
    }
  }

  const [first] = values;
  el.prepareValuesHint.textContent =
    first === undefined
      ? 'Add at least one value.'
      : `${first} is the default variant. Click another value to make it the default.`;

  el.prepareHint.textContent = scanning
    ? 'Scanning the selection.'
    : scan
      ? describePrepareCounts(scan.prepare, settings.propertyName)
      : '';
}

function canPrepare(): boolean {
  if (!selection.valid || busy || scanning || !scan) return false;
  if (settings.variantValues.length === 0) return false;
  return scan.prepare.plain > 0 || scan.prepare.sets > 0;
}

// ── footer, header, settings ──

function applyLabel(): string {
  const copy = settings.duplicate;
  if (settings.targetMode === AUTO_TARGET) return copy ? 'Copy as Auto' : 'Set to Auto';
  const name = targetModeName();
  if (name === null) return copy ? 'Copy' : 'Apply';
  return copy ? `Copy as ${name}` : `Make ${name}`;
}

function canApply(): boolean {
  if (!selection.valid || busy || scanning) return false;
  const variants = settings.switchVariants && variantChoice().value !== '';
  const modesWork = hasModes() && (modeTarget() !== null || settings.resetNestedModes);
  return variants || modesWork;
}

function renderFooter(): void {
  setVisible(el.switchFooter, operation === 'switch');
  setVisible(el.bindFooter, operation === 'bind');
  setVisible(el.prepareFooter, operation === 'prepare');
  el.prepareApply.disabled = !canPrepare();
  if (!busy && flashing !== el.prepareApply) {
    el.prepareApply.textContent = `Add ${settings.propertyName}`;
  }
  if (!busy && flashing !== el.apply) el.apply.textContent = applyLabel();
  el.apply.disabled = !canApply();

  const idle = selection.valid && !busy && !scanning;
  el.bind.disabled = !idle || settings.variable === null || (scan?.instances ?? 0) === 0;
  el.unbind.disabled = !idle || (scan?.bound ?? 0) === 0;
  if (!busy && flashing !== el.bind) el.bind.textContent = 'Bind';
  if (!busy && flashing !== el.unbind) el.unbind.textContent = 'Unbind';
  el.rescan.disabled = busy;
}

function renderSelection(): void {
  if (selection.valid) {
    const [first = '', ...rest] = selection.names;
    el.headerMeta.textContent = rest.length === 0 ? first : `${first} +${rest.length}`;
    el.headerMeta.title = selection.names.join(', ');
  } else {
    el.headerMeta.textContent = '';
    el.headerMeta.title = '';
    el.emptyMessage.textContent = EMPTY_MESSAGES[selection.reason];
  }
  setVisible(el.emptyView, !selection.valid);
  setVisible(el.switchView, selection.valid && operation === 'switch');
  setVisible(el.bindView, selection.valid && operation === 'bind');
  setVisible(el.prepareView, selection.valid && operation === 'prepare');
}

const MAX_WIDTHS = 12;

/*
 * The table is the source, not the record: every commit reads all rows back, so renaming a
 * breakpoint is the same move as changing its width and no key has to be tracked.
 */
function commitWidths(): void {
  const widths: Record<string, number> = {};
  for (const row of Array.from(el.widthRows.children)) {
    const name = row.querySelector<HTMLInputElement>('input[type="text"]')?.value.trim() ?? '';
    const input = row.querySelector<HTMLInputElement>('input[type="number"]');
    if (name === '' || !input) continue;
    const width = Math.round(readNumber(input, 0));
    if (width < 1) continue;
    widths[name] = width;
  }
  saveSettings({ widths });
  render();
}

function widthRow(name: string, width: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fig-row width-row';

  const nameField = document.createElement('div');
  nameField.className = 'fig-field';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = name;
  nameInput.spellcheck = false;
  nameInput.placeholder = 'Breakpoint';
  nameInput.disabled = busy;
  nameInput.setAttribute('aria-label', 'Breakpoint name');
  nameInput.addEventListener('change', commitWidths);
  nameField.appendChild(nameInput);

  const widthField = document.createElement('div');
  widthField.className = 'fig-field width-row__px';
  const widthInput = document.createElement('input');
  widthInput.type = 'number';
  widthInput.min = '1';
  widthInput.max = '16384';
  widthInput.step = '1';
  widthInput.value = width > 0 ? String(width) : '';
  widthInput.disabled = busy;
  widthInput.setAttribute('aria-label', name === '' ? 'Width' : `Width for ${name}`);
  widthInput.addEventListener('change', commitWidths);
  const affix = document.createElement('span');
  affix.className = 'fig-field__affix';
  affix.textContent = 'px';
  widthField.append(widthInput, affix);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'fig-btn fig-btn--icon';
  remove.title = name === '' ? 'Remove' : `Remove ${name}`;
  remove.innerHTML = REMOVE_SVG;
  remove.disabled = busy;
  remove.addEventListener('click', () => {
    row.remove();
    commitWidths();
  });

  row.append(nameField, widthField, remove);
  bindFieldFocus(row);
  return row;
}

/* A row being typed in must survive a render fired by the sandbox, hence the focus check. */
function renderWidths(): void {
  el.addWidth.disabled = busy || el.widthRows.children.length >= MAX_WIDTHS;
  if (el.widthRows.contains(document.activeElement)) return;
  clear(el.widthRows);
  for (const [name, width] of Object.entries(settings.widths)) {
    el.widthRows.appendChild(widthRow(name, width));
  }
}

function renderSettings(): void {
  if (!inUse(el.propertyName)) el.propertyName.value = settings.propertyName;
  if (!inUse(el.collectionSelect)) {
    fillSelect(
      el.collectionSelect,
      'No collection, switch variants only',
      collections.map((collection) => ({
        value: refKey(collection),
        label: collectionLabel(collection),
      })),
    );
    const collection = currentCollection();
    el.collectionSelect.value = collection ? refKey(collection) : '';
  }

  const libraries = collections.filter((entry) => entry.kind === 'library').length;
  el.libraryHint.textContent =
    libraryError !== null
      ? `Libraries could not be read: ${libraryError}`
      : libraries === 0
        ? 'No library collections found. Enable the design system library in this file to see its collections.'
        : `${plural(libraries, 'library collection')} available.`;

  renderWidths();
}

function render(): void {
  renderSelection();
  renderModeGroup();
  renderFrame();
  renderVariants();
  renderModes();
  renderBind();
  renderPrepare();
  renderFooter();
  renderSettings();
}

function flashDone(button: HTMLButtonElement): void {
  flashing = button;
  button.classList.add('fig-btn--success');
  button.textContent = 'Done';
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    button.classList.remove('fig-btn--success');
    flashing = null;
    renderFooter();
  }, 900);
}

function progressText(done: number, total: number): string {
  return total > 0 ? `Working ${done} of ${total}` : `Working ${done}`;
}

function startWork(button: HTMLButtonElement): void {
  busy = true;
  working = button;
  clearNotice();
  render();
  button.textContent = progressText(0, scan?.nodes ?? 0);
}

function openSettings(): void {
  setVisible(el.settingsView, true);
  el.closeSettings.focus();
}

function closeSettings(): void {
  setVisible(el.settingsView, false);
}

// ── wiring ──

const selectOperation = bindSegmented(el.operationSwitch, (value) => {
  operation = value as Operation;
  clearNotice();
  render();
});

el.switchVariants.addEventListener('change', () => {
  saveSettings({ switchVariants: el.switchVariants.checked });
  render();
});

el.variantValue.addEventListener('change', () => {
  const modeName = targetModeName();
  if (modeName !== null && el.variantValue.value !== '') {
    saveSettings({
      variantForMode: { ...settings.variantForMode, [modeName]: el.variantValue.value },
    });
  }
  renderFooter();
});

for (const [input, key] of [
  [el.resetNestedModes, 'resetNestedModes'],
  [el.setChildrenModes, 'setChildrenModes'],
  [el.duplicate, 'duplicate'],
  [el.resizeRoot, 'resizeRoot'],
] as const) {
  input.addEventListener('change', () => {
    saveSettings({ [key]: input.checked });
    render();
  });
}

el.prepareApply.addEventListener('click', () => {
  if (!canPrepare()) return;
  startWork(el.prepareApply);
  send({ type: 'prepare' });
});

el.variableSelect.addEventListener('change', () => {
  const variable = variables.find((entry) => refKey(entry) === el.variableSelect.value);
  saveSettings({ variable: variable ? { kind: variable.kind, ref: variable.ref } : null });
  renderFooter();
});

el.propertyName.addEventListener('change', () => {
  const value = el.propertyName.value.trim();
  saveSettings({ propertyName: value === '' ? DEFAULT_SETTINGS.propertyName : value });
  scan = null;
  render();
});

el.collectionSelect.addEventListener('change', () => {
  const collection = collections.find((entry) => refKey(entry) === el.collectionSelect.value);
  modes = [];
  variables = [];
  collectionError = null;
  saveSettings({ collection: collection ? { kind: collection.kind, ref: collection.ref } : null });
  render();
});

el.addWidth.addEventListener('click', () => {
  if (el.addWidth.disabled) return;
  const row = widthRow('', 0);
  el.widthRows.appendChild(row);
  row.querySelector('input')?.focus();
  el.addWidth.disabled = el.widthRows.children.length >= MAX_WIDTHS;
});

el.reload.addEventListener('click', () => {
  el.reload.disabled = true;
  send({ type: 'reload' });
});

el.rescan.addEventListener('click', () => {
  clearNotice();
  send({ type: 'rescan' });
});

el.apply.addEventListener('click', () => {
  if (!canApply()) return;
  const request: ApplyRequest = {
    propertyName: settings.propertyName,
    collection: settings.collection,
    target: modeTarget(),
    switchVariants: settings.switchVariants,
    variantValue: variantChoice().value,
    resetNestedModes: settings.resetNestedModes && hasModes(),
    setChildrenModes: settings.setChildrenModes,
    label: targetLabel(),
    duplicate: settings.duplicate,
    width: settings.resizeRoot ? targetWidth() : null,
  };
  startWork(el.apply);
  send({ type: 'apply', request });
});

el.bind.addEventListener('click', () => {
  if (el.bind.disabled || settings.variable === null) return;
  startWork(el.bind);
  send({ type: 'bind', propertyName: settings.propertyName, variable: settings.variable });
});

el.unbind.addEventListener('click', () => {
  if (el.unbind.disabled) return;
  startWork(el.unbind);
  send({ type: 'unbind', propertyName: settings.propertyName });
});

el.openSettings.addEventListener('click', openSettings);
el.closeSettings.addEventListener('click', closeSettings);

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && !el.settingsView.hidden) closeSettings();
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    if (operation === 'switch') el.apply.click();
    if (operation === 'prepare') el.prepareApply.click();
  }
});

function showDiagnostics(entries: readonly Diagnostic[]): void {
  if (entries.length === 0) return;
  notice('error', entries.map((entry) => `Could not ${entry.step}: ${entry.detail}`).join('\n'));
}

function withFailures(summary: string, failures: readonly string[]): string {
  return failures.length === 0 ? summary : `${summary}\n${failures.join('\n')}`;
}

onPluginMessage<PluginMessage>((message) => {
  switch (message.type) {
    case 'init':
      initialised = true;
      settings = message.settings;
      collections = message.collections;
      libraryError = message.libraryError;
      selection = message.selection;
      showDiagnostics(message.diagnostics);
      render();
      return;

    case 'collections':
      collections = message.collections;
      libraryError = message.libraryError;
      el.reload.disabled = false;
      render();
      return;

    case 'collection':
      modes = message.modes;
      variables = message.variables;
      collectionError = message.error;
      settings = { ...settings, variable: message.variable };
      render();
      return;

    case 'selection':
      selection = message.selection;
      render();
      return;

    case 'scanning':
      scanning = true;
      render();
      return;

    case 'scan':
      scan = message.scan;
      scanning = false;
      render();
      return;

    case 'progress':
      if (working) working.textContent = progressText(message.done, message.total);
      return;

    case 'applied': {
      busy = false;
      working = null;
      const failed = message.outcome.failedVariants + message.outcome.failedModes;
      notice(
        failed > 0 ? 'error' : 'success',
        withFailures(
          describeApply(message.outcome, settings.propertyName),
          message.outcome.failures,
        ),
      );
      flashDone(el.apply);
      render();
      return;
    }

    case 'prepared':
      busy = false;
      working = null;
      notice(
        message.outcome.failed > 0 ? 'error' : 'success',
        withFailures(
          describePrepare(message.outcome, settings.propertyName),
          message.outcome.failures,
        ),
      );
      flashDone(el.prepareApply);
      render();
      return;

    case 'bound':
      busy = false;
      working = null;
      notice(
        message.outcome.failed > 0 ? 'error' : 'success',
        withFailures(describeBind(message.outcome, message.operation), message.outcome.failures),
      );
      flashDone(message.operation === 'bind' ? el.bind : el.unbind);
      render();
      return;

    case 'error':
      busy = false;
      working = null;
      scanning = false;
      el.reload.disabled = false;
      notice('error', message.message);
      render();
      return;
  }
});

bindFieldFocus();
selectOperation('switch');
render();
/* Figma drops messages posted before this iframe listens, so the state is requested, not awaited. */
send({ type: 'ready' });
