import { explainError } from './errors.ts';
import type {
  ApplyOutcome,
  BindOperation,
  BindOutcome,
  CollectionInfo,
  CollectionRef,
  VariableInfo,
  VariableRef,
} from './messages.ts';

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/* Text, boolean and swap properties carry a `#id` suffix in their key. Variants never do. */
export function bareName(propertyKey: string): string {
  const hash = propertyKey.indexOf('#');
  return hash === -1 ? propertyKey : propertyKey.slice(0, hash);
}

export interface PropertyLike {
  readonly type: string;
  readonly value: string | boolean;
  readonly boundVariables?: { readonly value?: unknown };
}

export interface VariantProperty {
  key: string;
  value: string;
  bound: boolean;
}

export function findVariantProperty(
  properties: Readonly<Record<string, PropertyLike>>,
  wanted: string,
): VariantProperty | null {
  const target = normalizeName(wanted);
  if (target === '') return null;
  for (const [key, property] of Object.entries(properties)) {
    if (property.type !== 'VARIANT') continue;
    if (normalizeName(bareName(key)) !== target) continue;
    return {
      key,
      value: String(property.value),
      bound: property.boundVariables?.value !== undefined,
    };
  }
  return null;
}

/*
 * An explicit earlier choice for this mode wins, then the option that carries the mode's own name.
 * Only when neither exists does the list fall back to whatever is first, so a Tablet target with no
 * Tablet variant keeps what the person picked last time rather than guessing.
 */
export function pickVariantValue(
  modeName: string | null,
  options: readonly string[],
  remembered: string | undefined,
  current: string,
): string {
  if (remembered !== undefined && options.includes(remembered)) return remembered;
  if (modeName !== null) {
    const byName = options.find((option) => normalizeName(option) === normalizeName(modeName));
    if (byName !== undefined) return byName;
  }
  if (options.includes(current)) return current;
  return options[0] ?? current;
}

/* Auto picking only happens when the name is unambiguous. Two matches mean a person has to choose. */
export function pickCollection(
  collections: readonly CollectionInfo[],
  wanted: string,
): CollectionRef | null {
  const target = normalizeName(wanted);
  const matches = collections.filter((collection) => normalizeName(collection.name) === target);
  const match = matches.length === 1 ? matches[0] : undefined;
  return match ? { kind: match.kind, ref: match.ref } : null;
}

/*
 * The variable that names the breakpoint is rarely called exactly like the property: in a real
 * system it sits at `breakpoint/name`. So any path segment may carry the name, and a collection that
 * publishes a single string variable needs no guessing at all.
 */
export function pickVariable(
  variables: readonly VariableInfo[],
  wanted: string,
): VariableRef | null {
  const target = normalizeName(wanted);
  const named = variables.filter((variable) =>
    variable.name.split('/').some((segment) => normalizeName(segment) === target),
  );
  const candidates = named.length > 0 ? named : variables;
  const match = candidates.length === 1 ? candidates[0] : undefined;
  return match ? { kind: match.kind, ref: match.ref } : null;
}

/* A breakpoint without a width, and Auto, leave the frame alone. Names are matched like everywhere. */
export function widthFor(
  widths: Readonly<Record<string, number>>,
  label: string | null,
): number | null {
  if (label === null) return null;
  const target = normalizeName(label);
  if (target === '') return null;
  for (const [name, width] of Object.entries(widths)) {
    if (normalizeName(name) === target) return width;
  }
  return null;
}

/*
 * The name of a copy. A screen already called "Home / Desktop" becomes "Home / Desktop" with the
 * label swapped rather than stacked, so a round trip does not grow the name. The separator that was
 * there is kept, and a trailing label only counts when a word boundary sits in front of it.
 */
export function counterpartName(name: string, label: string, known: readonly string[]): string {
  const trimmed = name.trim();
  if (label === '') return trimmed;

  const candidates = [...known].filter((entry) => entry !== '').sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    if (trimmed.length < candidate.length) continue;
    const cut = trimmed.length - candidate.length;
    if (normalizeName(trimmed.slice(cut)) !== normalizeName(candidate)) continue;
    const head = trimmed.slice(0, cut);
    if (head !== '' && /[a-z0-9]$/i.test(head)) continue;
    const base = head.replace(/[\s/|,+·-]+$/, '');
    if (base === '') return label;
    const separator = head.slice(base.length);
    return `${base}${separator === '' ? ' ' : separator}${label}`;
  }
  return `${trimmed} ${label}`;
}

export interface VariantChoice {
  value: string;
  needsChoice: boolean;
}

/*
 * The value only has to be asked for when the chosen breakpoint does not name a variant: with a mode
 * collection the mode name usually matches an option, and without one the breakpoint choice already
 * is the variant value.
 */
export function resolveVariantChoice(
  hasModes: boolean,
  target: string | null,
  options: readonly string[],
  remembered: string | undefined,
  current: string,
): VariantChoice {
  if (options.length === 0) return { value: '', needsChoice: false };

  if (!hasModes) {
    const value = target !== null && options.includes(target) ? target : (options[0] ?? '');
    return { value, needsChoice: false };
  }

  const named =
    target === null
      ? undefined
      : options.find((option) => normalizeName(option) === normalizeName(target));
  if (named !== undefined) return { value: named, needsChoice: false };

  return {
    value: pickVariantValue(target, options, remembered, current),
    needsChoice: true,
  };
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

export function emptyApplyOutcome(): ApplyOutcome {
  return {
    nodes: 0,
    duplicated: 0,
    resized: 0,
    resizeKept: 0,
    switched: 0,
    keptSize: 0,
    unchanged: 0,
    skippedBound: 0,
    failedVariants: 0,
    rootModes: 0,
    childModes: 0,
    cleared: 0,
    failedModes: 0,
    failures: [],
  };
}

export function describeApply(outcome: ApplyOutcome, propertyName: string): string {
  const parts: string[] = [];
  if (outcome.duplicated > 0) parts.push(`${plural(outcome.duplicated, 'copy', 'copies')} created`);
  if (outcome.resized > 0) parts.push(`width set on ${plural(outcome.resized, 'frame')}`);
  if (outcome.resizeKept > 0) parts.push(`${plural(outcome.resizeKept, 'frame')} kept the width`);
  if (outcome.switched > 0) parts.push(`${plural(outcome.switched, 'instance')} switched`);
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} already there`);
  if (outcome.skippedBound > 0) parts.push(`${outcome.skippedBound} follow a variable`);
  if (outcome.rootModes > 0) parts.push(`mode set on ${plural(outcome.rootModes, 'frame')}`);
  if (outcome.childModes > 0)
    parts.push(`mode set on ${plural(outcome.childModes, 'child', 'children')}`);
  if (outcome.cleared > 0) parts.push(`${plural(outcome.cleared, 'fixed mode')} reset`);
  if (outcome.keptSize > 0) {
    parts.push(
      `${outcome.keptSize} kept the old size because Figma does not let a plugin resize a layer inside an instance`,
    );
  }
  const failed = outcome.failedVariants + outcome.failedModes;
  if (failed > 0) parts.push(`${failed} failed`);
  if (parts.length === 0)
    return `Nothing to change. No ${propertyName} variant or fixed mode found.`;
  return parts.join(', ') + '.';
}

export function describeBind(outcome: BindOutcome, operation: BindOperation): string {
  const verb = operation === 'bind' ? 'bound' : 'unbound';
  const parts = [`${plural(outcome.changed, 'instance')} ${verb}`];
  if (outcome.unchanged > 0) parts.push(`${outcome.unchanged} already ${verb}`);
  if (outcome.failed > 0) parts.push(`${outcome.failed} failed`);
  return parts.join(', ') + '.';
}

/*
 * The plugin sandbox does not only throw Error objects: some API failures arrive as a bare string or
 * as a plain object carrying a message. An `instanceof Error` check alone turns those into a silent
 * fallback text, which is how a real cause ends up invisible.
 */
export function errorDetail(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
    try {
      const json = JSON.stringify(error);
      if (json !== undefined && json !== '{}') return json;
    } catch {
      /* A value that cannot be serialised still has a tag worth reporting. */
    }
    return Object.prototype.toString.call(error);
  }
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  return '';
}

export const MAX_FAILURES = 5;

/* For a value Figma threw at us. Its wording names an internal getter, so it gets translated. */
export function recordFailure(failures: string[], name: string, error: unknown): void {
  recordReason(failures, name, explainError(errorDetail(error)) || 'unknown error');
}

/* For a reason of our own, for example a read back that did not show the value we just wrote. */
export function recordReason(failures: string[], name: string, reason: string): void {
  if (failures.length >= MAX_FAILURES) return;
  failures.push(`${name}: ${reason}`);
}
