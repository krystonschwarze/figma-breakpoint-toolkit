import type {
  CollectionInfo,
  CollectionRef,
  ModeInfo,
  VariableInfo,
  VariableRef,
} from './messages.ts';

export interface CollectionList {
  collections: CollectionInfo[];
  libraryError: string | null;
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

export async function readCollections(): Promise<CollectionList> {
  const local: CollectionInfo[] = (await figma.variables.getLocalVariableCollectionsAsync()).map(
    (collection) => ({
      kind: 'local',
      ref: collection.id,
      name: collection.name,
      libraryName: null,
    }),
  );

  let library: CollectionInfo[] = [];
  let libraryError: string | null = null;
  try {
    const available = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    library = available.map((collection) => ({
      kind: 'library',
      ref: collection.key,
      name: collection.name,
      libraryName: collection.libraryName,
    }));
  } catch (error) {
    /* A file with no enabled libraries, or no network, must not take the local path down with it. */
    const detail = error instanceof Error ? error.message : 'Libraries could not be read.';
    libraryError = detail.includes('permission not specified')
      ? 'manifest.json needs both "permissions": ["teamlibrary"] and "enableProposedApi": true, and the plugin has to be re-imported afterwards.'
      : detail;
  }

  return { collections: [...local.sort(byName), ...library.sort(byName)], libraryError };
}

/*
 * A library collection only becomes a VariableCollection object once one of its variables has been
 * imported. Both mode calls need that object, and its id is the key explicitVariableModes uses.
 */
export async function resolveCollection(ref: CollectionRef): Promise<VariableCollection> {
  if (ref.kind === 'local') {
    const collection = await figma.variables.getVariableCollectionByIdAsync(ref.ref);
    if (!collection) throw new Error('That collection no longer exists in this file.');
    return collection;
  }

  const variables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(ref.ref);
  const first = variables[0];
  if (!first) {
    throw new Error(
      'This library collection publishes no variables, so its modes cannot be read here. Add one variable to it in the library and publish.',
    );
  }
  const imported = await figma.variables.importVariableByKeyAsync(first.key);
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    imported.variableCollectionId,
  );
  if (!collection) throw new Error('The library collection could not be loaded.');
  return collection;
}

export function modesOf(collection: VariableCollection): ModeInfo[] {
  return collection.modes.map((mode) => ({ id: mode.modeId, name: mode.name }));
}

export async function stringVariablesOf(ref: CollectionRef): Promise<VariableInfo[]> {
  if (ref.kind === 'local') {
    const all = await figma.variables.getLocalVariablesAsync('STRING');
    return all
      .filter((variable) => variable.variableCollectionId === ref.ref)
      .map((variable): VariableInfo => ({ kind: 'local', ref: variable.id, name: variable.name }))
      .sort(byName);
  }

  const all = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(ref.ref);
  return all
    .filter((variable) => variable.resolvedType === 'STRING')
    .map((variable): VariableInfo => ({ kind: 'library', ref: variable.key, name: variable.name }))
    .sort(byName);
}

export async function resolveVariable(ref: VariableRef): Promise<Variable> {
  if (ref.kind === 'local') {
    const variable = await figma.variables.getVariableByIdAsync(ref.ref);
    if (!variable) throw new Error('That variable no longer exists in this file.');
    return variable;
  }
  return figma.variables.importVariableByKeyAsync(ref.ref);
}
