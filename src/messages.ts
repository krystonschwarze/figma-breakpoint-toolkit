/*
 * A collection or variable may live in this file or in an enabled library. Local ones are addressed
 * by id, library ones by key, so both carry an opaque `ref` and a kind that says how to read it.
 */
import type { PrepareCounts, PrepareOutcome } from './variants.ts';

export type SourceKind = 'local' | 'library';

export interface CollectionRef {
  kind: SourceKind;
  ref: string;
}

export interface CollectionInfo extends CollectionRef {
  name: string;
  libraryName: string | null;
}

export interface VariableRef {
  kind: SourceKind;
  ref: string;
}

export interface VariableInfo extends VariableRef {
  name: string;
}

export interface ModeInfo {
  id: string;
  name: string;
}

export interface Settings {
  propertyName: string;
  variantValues: string[];
  collection: CollectionRef | null;
  variable: VariableRef | null;
  targetMode: string | null;
  variantForMode: Record<string, string>;
  widths: Record<string, number>;
  switchVariants: boolean;
  resetNestedModes: boolean;
  setChildrenModes: boolean;
  duplicate: boolean;
  resizeRoot: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  propertyName: 'Breakpoint',
  variantValues: ['Desktop', 'Mobile'],
  collection: null,
  variable: null,
  targetMode: null,
  variantForMode: {},
  widths: { Desktop: 1680, Tablet: 1024, Mobile: 400 },
  switchVariants: true,
  resetNestedModes: true,
  setChildrenModes: false,
  duplicate: false,
  resizeRoot: false,
};

export interface Diagnostic {
  step: string;
  detail: string;
}

export type SelectionState =
  { valid: true; names: string[] } | { valid: false; reason: 'no-selection' | 'no-children' };

export interface ScanResult {
  nodes: number;
  instances: number;
  bound: number;
  values: Record<string, number>;
  options: string[];
  fixedModes: number;
  fixedModesAnyCollection: number;
  rootModes: (string | null)[];
  prepare: PrepareCounts;
}

export type ModeTarget = { kind: 'mode'; modeId: string } | { kind: 'auto' };

export interface ApplyRequest {
  propertyName: string;
  collection: CollectionRef | null;
  target: ModeTarget | null;
  /* Names the chosen breakpoint, for the name of a copy and for the relaunch button. */
  label: string;
  switchVariants: boolean;
  variantValue: string;
  resetNestedModes: boolean;
  setChildrenModes: boolean;
  duplicate: boolean;
  width: number | null;
}

export interface ApplyOutcome {
  nodes: number;
  duplicated: number;
  resized: number;
  resizeKept: number;
  switched: number;
  keptSize: number;
  unchanged: number;
  skippedBound: number;
  failedVariants: number;
  rootModes: number;
  childModes: number;
  cleared: number;
  failedModes: number;
  failures: string[];
}

export type BindOperation = 'bind' | 'unbind';

export interface BindOutcome {
  changed: number;
  unchanged: number;
  failed: number;
  failures: string[];
}

export type UiMessage =
  | { type: 'prepare' }
  | { type: 'ready' }
  | { type: 'reload' }
  | { type: 'rescan' }
  | { type: 'save-settings'; settings: Settings }
  | { type: 'apply'; request: ApplyRequest }
  | { type: 'bind'; propertyName: string; variable: VariableRef }
  | { type: 'unbind'; propertyName: string };

export type PluginMessage =
  | {
      type: 'init';
      diagnostics: Diagnostic[];
      settings: Settings;
      collections: CollectionInfo[];
      libraryError: string | null;
      selection: SelectionState;
    }
  | { type: 'collections'; collections: CollectionInfo[]; libraryError: string | null }
  | {
      type: 'collection';
      collection: CollectionRef | null;
      modes: ModeInfo[];
      variables: VariableInfo[];
      variable: VariableRef | null;
      error: string | null;
    }
  | { type: 'selection'; selection: SelectionState }
  | { type: 'scanning' }
  | { type: 'scan'; scan: ScanResult }
  | { type: 'progress'; done: number; total: number }
  | { type: 'applied'; outcome: ApplyOutcome }
  | { type: 'bound'; outcome: BindOutcome; operation: BindOperation }
  | { type: 'prepared'; outcome: PrepareOutcome }
  | { type: 'error'; message: string };

export function sameRef(a: CollectionRef | null, b: CollectionRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.ref === b.ref;
}

export function refKey(ref: CollectionRef | VariableRef): string {
  return `${ref.kind}:${ref.ref}`;
}
