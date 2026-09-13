/*
 * Figma plugin UI kit. The canonical copy is the repo carrying a .ui-kit-canonical marker.
 * Sync into the sibling plugin repos with `npm run sync:ui-kit`.
 */

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function postToPlugin<TMessage>(message: TMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

export function onPluginMessage<TMessage>(handler: (message: TMessage) => void): void {
  window.addEventListener('message', (event: MessageEvent) => {
    const message = (event.data as { pluginMessage?: TMessage } | null)?.pluginMessage;
    if (message !== undefined && message !== null) handler(message);
  });
}

export function setVisible(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function icon(paths: string, viewBox = '0 0 14 14'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

export type NoticeKind = 'info' | 'success' | 'error';

/**
 * Errors stay until something replaces them. An error that fades after a few seconds is an error
 * nobody reads, which is exactly how a failure ends up looking like nothing happened at all.
 * Pass an explicit timeout to override.
 */
export function showNotice(
  el: HTMLElement,
  kind: NoticeKind,
  text: string,
  timeoutMs = kind === 'error' ? 0 : 4000,
): void {
  el.className = kind === 'info' ? 'fig-notice' : `fig-notice fig-notice--${kind}`;
  el.textContent = text;
  el.hidden = false;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  window.clearTimeout(noticeTimers.get(el));
  if (timeoutMs > 0) {
    noticeTimers.set(
      el,
      window.setTimeout(() => {
        el.hidden = true;
        el.textContent = '';
      }, timeoutMs),
    );
  }
}

const noticeTimers = new WeakMap<HTMLElement, number>();

export function bindSegmented(
  group: HTMLElement,
  onChange: (value: string) => void,
): (value: string) => void {
  const segments = Array.from(group.querySelectorAll<HTMLButtonElement>('.fig-segment'));

  function select(value: string, notify: boolean): void {
    for (const segment of segments) {
      segment.setAttribute('aria-selected', String(segment.dataset.value === value));
    }
    if (notify) onChange(value);
  }

  group.setAttribute('role', 'tablist');
  for (const segment of segments) {
    segment.type = 'button';
    segment.setAttribute('role', 'tab');
    segment.addEventListener('click', () => select(segment.dataset.value ?? '', true));
  }

  group.addEventListener('keydown', (event: KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const current = segments.findIndex((s) => s.getAttribute('aria-selected') === 'true');
    const next = segments[(current + delta + segments.length) % segments.length];
    if (!next) return;
    next.focus();
    select(next.dataset.value ?? '', true);
  });

  return (value: string) => select(value, false);
}

/* A click anywhere in the padded field area should focus its input, matching Figma's own inputs. */
export function bindFieldFocus(root: ParentNode = document): void {
  for (const field of Array.from(root.querySelectorAll<HTMLElement>('.fig-field'))) {
    field.addEventListener('mousedown', (event: MouseEvent) => {
      const input = field.querySelector('input');
      if (!input || event.target === input) return;
      event.preventDefault();
      input.focus();
      input.select();
    });
  }
}

export function readNumber(input: HTMLInputElement, fallback = 0): number {
  const value = Number.parseFloat(input.value);
  if (!Number.isFinite(value)) return fallback;
  const min = Number.parseFloat(input.min);
  const max = Number.parseFloat(input.max);
  let result = value;
  if (Number.isFinite(min)) result = Math.max(min, result);
  if (Number.isFinite(max)) result = Math.min(max, result);
  return result;
}

export function fillSelect(
  select: HTMLSelectElement,
  placeholder: string,
  items: readonly { value: string; label: string }[],
): void {
  const previous = select.value;
  clear(select);
  select.appendChild(new Option(placeholder, ''));
  for (const item of items) select.appendChild(new Option(item.label, item.value));
  if (items.some((item) => item.value === previous)) select.value = previous;
}
