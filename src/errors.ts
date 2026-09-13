interface Explanation {
  readonly match: RegExp;
  readonly text: string;
}

/*
 * Figma's own wording names the internal getter that failed and the node id it failed on, which tells
 * a person nothing about what to do next. Each entry here replaces one of those with the cause and
 * the way out, and anything unknown keeps Figma's text but says who is talking.
 */
const EXPLANATIONS: readonly Explanation[] = [
  {
    match: /does not exist/i,
    text: 'A layer disappeared while the plugin was working. Switching a variant replaces the layers inside it, so a layer that was queued can be gone by the time its turn comes. Nothing is broken, run it again and the rest follows.',
  },
  {
    match: /client storage without a plugin ID|private plugin data in a plugin without an ID/i,
    text: 'Figma refuses to store the settings because manifest.json has no id. Add an id and import the plugin again.',
  },
  {
    match: /permission not specified/i,
    text: 'Reading the libraries needs both "permissions": ["teamlibrary"] and "enableProposedApi": true in manifest.json, and the plugin has to be imported again afterwards.',
  },
  {
    match: /Component set has existing errors/i,
    text: 'That component set is in an error state in Figma, usually a variant whose name does not line up with the others. Fix it in Figma, then run this again.',
  },
  {
    match: /Can only add variant property to a component set/i,
    text: 'A variant property only exists on a component set. Run Prepare on the component itself and the plugin builds the set for you.',
  },
  {
    match: /cannotSetSlotProperty|slot property/i,
    text: 'Slot properties cannot be set from a plugin. Fill that slot in Figma.',
  },
  {
    match: /Cannot unwrap unloaded page|loadAsync/i,
    text: 'That layer sits on a page Figma has not loaded. Open the page once, then run this again.',
  },
  {
    match: /invalid variant|no such variant|variant .*(not found|does not exist)/i,
    text: 'That value does not exist on this component set, so Figma refused it. Check how the property is spelled in the component.',
  },
];

/* Figma prefixes the failing accessor, for example "in get_explicitVariableModes: ...". */
function stripAccessor(detail: string): string {
  return detail.replace(/^in (get|set)_[A-Za-z0-9_]+:\s*/, '').trim();
}

export function explainError(detail: string): string {
  const clean = detail.trim();
  if (clean === '') return '';
  const known = EXPLANATIONS.find((entry) => entry.match.test(clean));
  if (known) return known.text;
  const bare = stripAccessor(clean);
  return bare === '' ? '' : `Figma reported: ${bare}`;
}
