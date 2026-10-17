// Toast alerts for the Stem Extractor, on top of Toastify JS (vendored, MIT). Each toast is a
// card with a colored edge, an icon, a title and an optional message, like Burnt's toasts.
// Styles live in assets/ui-toast.css. Toasts stack at the top center, below the pinned
// header (see `configureToasts`), and pause while hovered.
//
// toast({ title, message, variant, duration, id, progress }):
// - variant: 'success' | 'error' | 'warning' | 'info' | 'loading'.
// - duration in ms; -1 keeps it until dismissed. Loading toasts stay by default.
// - id: a toast with the same id and variant is updated in place (progress text and bar);
//   with another variant it is replaced. Without an id, the same text replaces itself
//   instead of stacking twice.
// - progress: 0–1 draws a bar under the text.
import Toastify from './vendor/toastify/toastify.min.mjs';

const VARIANTS = Object.freeze({
  success: { icon: 'check', duration: 4000, live: 'polite' },
  error: { icon: 'close', duration: 9000, live: 'assertive' },
  warning: { icon: 'warning', duration: 6000, live: 'assertive' },
  info: { icon: 'info', duration: 5000, live: 'polite' },
  loading: { icon: '', duration: -1, live: 'polite' },
});
const open = new Map();
let settings = { top: () => 0, closeLabel: 'Close' };
let announcers = null;
let viewport;
let positioning = 0;

function positionToasts() {
  positioning = 0;
  if (!viewport) return;
  const modal = [...document.querySelectorAll('dialog:modal')].at(-1);
  const parent = modal || document.body;
  if (viewport.parentElement !== parent) {
    if (viewport.matches(':popover-open')) viewport.hidePopover();
    parent.append(viewport);
  }
  viewport.hidden = false;
  if (!viewport.matches(':popover-open')) viewport.showPopover();
  viewport.style.setProperty('--toast-offset', `${modal ? 0 : Math.max(0, Math.min(innerHeight / 2, settings.top() || 0))}px`);
}

function toastViewport() {
  if (viewport) { positionToasts(); return viewport; }
  viewport = document.createElement('div'); viewport.className = 'ui-toast-viewport'; viewport.popover = 'manual';
  const schedule = () => { positioning ||= requestAnimationFrame(positionToasts); };
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('toggle', event => { if (event.target instanceof HTMLDialogElement) schedule(); }, true);
  positionToasts();
  return viewport;
}

// `top` returns the y offset in pixels (for example the bottom of a pinned header).
export function configureToasts(options) { settings = { ...settings, ...options }; }

// Screen readers hear toasts through two live regions that exist before any toast does.
function announce(text, live) {
  if (!announcers) {
    announcers = Object.fromEntries(['polite', 'assertive'].map(level => {
      const region = document.createElement('div'); region.className = 'ui-toast-announcer';
      region.setAttribute('aria-live', level); region.setAttribute('role', level === 'assertive' ? 'alert' : 'status');
      toastViewport().append(region); return [level, region];
    }));
  }
  const region = announcers[live];
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = text; });
}

function fill(entry, { title, message, variant, progress }) {
  const { node } = entry, config = VARIANTS[variant];
  node.dataset.variant = variant;
  const badge = node.querySelector('.ui-toast-icon');
  badge.replaceChildren(...(config.icon ? [globalThis.SCIcons.create(config.icon)] : []));
  node.querySelector('.ui-toast-title').textContent = title;
  const body = node.querySelector('.ui-toast-message');
  body.textContent = message; body.hidden = !message;
  const bar = node.querySelector('.ui-toast-progress');
  bar.hidden = !Number.isFinite(progress);
  if (Number.isFinite(progress)) bar.style.setProperty('--toast-progress', String(Math.min(1, Math.max(0, progress))));
  entry.variant = variant;
}

export function dismissToast(id) {
  const entry = open.get(id);
  if (!entry) return;
  open.delete(id); entry.instance.hideToast();
}

export function toast({ title, message = '', variant = 'info', duration, id = '', progress = null } = {}) {
  if (!title) return null;
  if (!VARIANTS[variant]) variant = 'info';
  const key = id || `${variant}\n${title}\n${message}`, current = open.get(key);
  if (current && id && current.variant === variant && variant === 'loading') {
    const changed = current.node.querySelector('.ui-toast-title').textContent !== title;
    fill(current, { title, message, variant, progress });
    if (changed && variant !== 'loading') announce([title, message].filter(Boolean).join('. '), VARIANTS[variant].live);
    return current;
  }
  if (current) dismissToast(key);
  // Keep rapid edits from covering the workspace with stale notices.
  const notices = [...open].filter(([, entry]) => entry.variant !== 'loading');
  if (notices.length >= 4) dismissToast(notices[0][0]);
  const node = document.createElement('div'); node.className = 'ui-toast-content';
  node.innerHTML = '<span class="ui-toast-icon" aria-hidden="true"></span><div class="ui-toast-text"><strong class="ui-toast-title"></strong><p class="ui-toast-message"></p><span class="ui-toast-progress" hidden></span></div><button class="ui-toast-close" type="button"></button>';
  const close = node.querySelector('.ui-toast-close');
  close.setAttribute('aria-label', settings.closeLabel); close.dataset.scdlTooltip = settings.closeLabel;
  close.append(globalThis.SCIcons.create('close'));
  const entry = { node, variant };
  fill(entry, { title, message, variant, progress });
  entry.instance = Toastify({ node, duration: duration ?? VARIANTS[variant].duration, gravity: 'top', position: 'center',
    selector: toastViewport(), className: 'ui-toast', ariaLive: '', stopOnFocus: true,
    callback() { if (open.get(key) === entry) open.delete(key); } });
  close.onclick = event => { event.stopPropagation(); if (open.get(key) === entry) open.delete(key); entry.instance.hideToast(); };
  entry.instance.showToast();
  // Toastify pauses on hover; keyboard users need the same time to read and dismiss.
  const element = entry.instance.toastElement;
  element.addEventListener('focusin', () => clearTimeout(element.timeOutValue));
  element.addEventListener('focusout', () => {
    if (entry.instance.options.duration > 0 && !element.matches(':hover')) {
      element.timeOutValue = setTimeout(() => dismissToast(key), entry.instance.options.duration);
    }
  });
  open.set(key, entry);
  announce([title, message].filter(Boolean).join('. '), VARIANTS[variant].live);
  return entry;
}
