import { DEFAULT_SETTINGS } from './messages.ts';
import type { CollectionRef, Settings } from './messages.ts';
import { sanitizeValues } from './variants.ts';

const KEY_SETTINGS = 'breakpoint-toolkit.settings';
const LEGACY_KEY_SETTINGS = 'make-mobile.settings';
const MAX_VALUES = 6;
const MAX_WIDTHS = 12;
const MIN_WIDTH = 1;
const MAX_WIDTH = 16384;

function refOrNull(value: unknown): CollectionRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  if (input.kind !== 'local' && input.kind !== 'library') return null;
  if (typeof input.ref !== 'string' || input.ref === '') return null;
  return { kind: input.kind, ref: input.ref };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/*
 * A width table someone emptied on purpose stays empty, so only a missing one falls back to the
 * defaults. Widths are whole pixels: Figma accepts fractions, a breakpoint is never one.
 */
function widthsOrNull(value: unknown): Record<string, number> | null {
  if (typeof value !== 'object' || value === null) return null;
  const widths: Record<string, number> = {};
  for (const [name, width] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(widths).length >= MAX_WIDTHS) break;
    const key = name.trim();
    if (key === '') continue;
    if (typeof width !== 'number' || !Number.isFinite(width)) continue;
    const rounded = Math.round(width);
    if (rounded < MIN_WIDTH || rounded > MAX_WIDTH) continue;
    widths[key] = rounded;
  }
  return widths;
}

export function sanitizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ...DEFAULT_SETTINGS,
      variantValues: [...DEFAULT_SETTINGS.variantValues],
      variantForMode: {},
      widths: { ...DEFAULT_SETTINGS.widths },
    };
  }
  const input = raw as Record<string, unknown>;

  const variantForMode: Record<string, string> = {};
  if (typeof input.variantForMode === 'object' && input.variantForMode !== null) {
    for (const [mode, value] of Object.entries(input.variantForMode as Record<string, unknown>)) {
      const clean = nonEmpty(value);
      if (clean !== null) variantForMode[mode] = clean;
    }
  }

  const rawValues = Array.isArray(input.variantValues) ? sanitizeValues(input.variantValues) : [];

  return {
    propertyName: nonEmpty(input.propertyName) ?? DEFAULT_SETTINGS.propertyName,
    variantValues:
      rawValues.length > 0 ? rawValues.slice(0, MAX_VALUES) : [...DEFAULT_SETTINGS.variantValues],
    collection: refOrNull(input.collection),
    variable: refOrNull(input.variable),
    targetMode: nonEmpty(input.targetMode),
    variantForMode,
    widths: widthsOrNull(input.widths) ?? { ...DEFAULT_SETTINGS.widths },
    switchVariants: input.switchVariants !== false,
    resetNestedModes: input.resetNestedModes !== false,
    setChildrenModes: input.setChildrenModes === true,
    duplicate: input.duplicate === true,
    resizeRoot: input.resizeRoot === true,
  };
}

/* Settings written under the plugin's former name are moved over once, then the old key is dropped. */
export async function readSettings(): Promise<Settings> {
  const stored: unknown = await figma.clientStorage.getAsync(KEY_SETTINGS);
  if (stored !== undefined) return sanitizeSettings(stored);

  const legacy: unknown = await figma.clientStorage.getAsync(LEGACY_KEY_SETTINGS);
  if (legacy === undefined) return sanitizeSettings(undefined);

  const settings = sanitizeSettings(legacy);
  await figma.clientStorage.setAsync(KEY_SETTINGS, settings);
  try {
    await figma.clientStorage.deleteAsync(LEGACY_KEY_SETTINGS);
  } catch {
    /* The move already happened, the leftover key is harmless. */
  }
  return settings;
}

export async function writeSettings(settings: Settings): Promise<Settings> {
  const clean = sanitizeSettings(settings);
  await figma.clientStorage.setAsync(KEY_SETTINGS, clean);
  return clean;
}
