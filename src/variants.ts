import { normalizeName, plural } from './breakpoint.ts';

export interface VariantPair {
  key: string;
  value: string;
}

export function parseVariantName(name: string): VariantPair[] {
  return name
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const equals = part.indexOf('=');
      return equals === -1
        ? { key: part, value: '' }
        : { key: part.slice(0, equals).trim(), value: part.slice(equals + 1).trim() };
    });
}

export function formatVariantName(pairs: readonly VariantPair[]): string {
  return pairs.map((pair) => `${pair.key}=${pair.value}`).join(', ');
}

export function variantValueOf(name: string, property: string): string | null {
  const target = normalizeName(property);
  const pair = parseVariantName(name).find((entry) => normalizeName(entry.key) === target);
  return pair ? pair.value : null;
}

/* A property that is not part of the name yet is appended, which is where Figma itself puts it. */
export function withVariantValue(name: string, property: string, value: string): string {
  const target = normalizeName(property);
  const pairs = parseVariantName(name);
  const index = pairs.findIndex((entry) => normalizeName(entry.key) === target);
  if (index === -1) return formatVariantName([...pairs, { key: property, value }]);
  const next = [...pairs];
  next[index] = { key: pairs[index]?.key ?? property, value };
  return formatVariantName(next);
}

/*
 * A comma or an equals sign cannot be part of a variant value: Figma builds variant names as
 * `Prop=Value, Prop2=Value2`, and a value carrying either one puts the whole set into an error state.
 * Verified against Figma, which even renamed such a variant to `Property 1=Breakpoint=Desktop, wide`.
 */
export function valueProblem(value: string): string | null {
  const clean = value.trim();
  if (clean === '') return 'Type a value first.';
  if (clean.includes(',') || clean.includes('=')) {
    return 'Figma builds variant names from commas and equals signs, so a value cannot contain either.';
  }
  return null;
}

export function sanitizeValues(input: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (valueProblem(value) !== null || seen.has(normalizeName(value))) continue;
    seen.add(normalizeName(value));
    values.push(value);
  }
  return values;
}

export function addValue(values: readonly string[], value: string): string[] {
  const clean = value.trim();
  if (valueProblem(clean) !== null) return [...values];
  if (values.some((entry) => normalizeName(entry) === normalizeName(clean))) return [...values];
  return [...values, clean];
}

export function removeValue(values: readonly string[], value: string): string[] {
  const next = values.filter((entry) => normalizeName(entry) !== normalizeName(value));
  return next.length === 0 ? [...values] : next;
}

/* The first value is the default variant, so promoting one is how the default is chosen. */
export function promoteValue(values: readonly string[], value: string): string[] {
  const target = normalizeName(value);
  if (!values.some((entry) => normalizeName(entry) === target)) return [...values];
  return [
    ...values.filter((entry) => normalizeName(entry) === target),
    ...values.filter((entry) => normalizeName(entry) !== target),
  ];
}

export function missingValues(options: readonly string[], wanted: readonly string[]): string[] {
  const present = new Set(options.map((option) => normalizeName(option)));
  return wanted.filter((value) => !present.has(normalizeName(value)));
}

export interface PrepareCounts {
  plain: number;
  sets: number;
  setVariants: number;
  newVariants: number;
  ready: number;
}

export function emptyPrepareCounts(): PrepareCounts {
  return { plain: 0, sets: 0, setVariants: 0, newVariants: 0, ready: 0 };
}

export function describePrepareCounts(counts: PrepareCounts, propertyName: string): string {
  const parts: string[] = [];
  if (counts.plain > 0) {
    parts.push(
      counts.plain === 1
        ? '1 component becomes a variant set'
        : `${counts.plain} components become variant sets`,
    );
  }
  if (counts.sets > 0) {
    parts.push(
      counts.sets === 1
        ? `1 set with ${plural(counts.setVariants, 'variant')} gains ${propertyName}`
        : `${counts.sets} sets with ${plural(counts.setVariants, 'variant')} gain ${propertyName}`,
    );
  }
  if (counts.newVariants > 0) parts.push(`${plural(counts.newVariants, 'variant')} added`);
  if (counts.ready > 0) parts.push(`${counts.ready} already complete`);
  if (parts.length === 0) {
    return `Select a component or a component set that carries no ${propertyName} yet.`;
  }
  return parts.join(', ') + '.';
}

export interface PrepareOutcome {
  created: number;
  extended: number;
  variants: number;
  skipped: number;
  failed: number;
  failures: string[];
}

export function emptyPrepareOutcome(): PrepareOutcome {
  return { created: 0, extended: 0, variants: 0, skipped: 0, failed: 0, failures: [] };
}

export function describePrepare(outcome: PrepareOutcome, propertyName: string): string {
  const parts: string[] = [];
  if (outcome.created > 0) {
    parts.push(
      `${outcome.created} ${outcome.created === 1 ? 'component' : 'components'} now carry ${propertyName}`,
    );
  }
  if (outcome.extended > 0) {
    parts.push(`${outcome.extended} ${outcome.extended === 1 ? 'set' : 'sets'} extended`);
  }
  if (outcome.variants > 0) {
    parts.push(`${outcome.variants} ${outcome.variants === 1 ? 'variant' : 'variants'} added`);
  }
  if (outcome.skipped > 0) parts.push(`${outcome.skipped} already complete`);
  if (outcome.failed > 0) parts.push(`${outcome.failed} failed`);
  if (parts.length === 0) return `Nothing to prepare. Select a component without ${propertyName}.`;
  return parts.join(', ') + '.';
}
