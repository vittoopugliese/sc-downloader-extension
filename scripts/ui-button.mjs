// The one button of the Stem Extractor (styles in assets/ui-button.css).
//
// Variants: 'accent' (orange, the Lumberjack look), 'neutral' (grey), 'ghost' (no frame).
// Sizes: 'icon' (34 × 32 square), 'text' (32 high, fits its label), 'tool' (the 32 × 30
// cells of the playlist tool grid). A label without an icon is a text button; with an
// icon it shows both. `pressed` (true/false) makes it a toggle with aria-pressed.
// Static markup uses the same classes: class="ui-btn ui-btn--accent ui-btn--icon".
export function buttonClasses({ variant = 'neutral', size = 'icon' } = {}) {
  return ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`];
}

export function createButton({ icon = '', label = '', title = '', variant = 'neutral', size = label ? 'text' : 'icon', pressed, className = '', onClick } = {}) {
  const control = document.createElement('button');
  control.type = 'button';
  control.classList.add(...buttonClasses({ variant, size }), ...className.split(/\s+/).filter(Boolean));
  setButtonContent(control, { icon, label });
  if (title) { control.title = title; control.setAttribute('aria-label', title); }
  else if (label) control.setAttribute('aria-label', label);
  if (pressed !== undefined) control.setAttribute('aria-pressed', String(!!pressed));
  if (onClick) control.addEventListener('click', onClick);
  return control;
}

// Replaces icon and label, keeping classes, title and listeners.
export function setButtonContent(control, { icon = '', label = '' }) {
  const parts = [];
  if (icon) parts.push(globalThis.SCIcons.create(icon, 'ui-btn-icon'));
  if (label) { const text = document.createElement('span'); text.className = 'ui-btn-label'; text.textContent = label; parts.push(text); }
  control.replaceChildren(...parts);
}
