import { createButton } from './ui-button.mjs';

// "Extract stems from sample", like FL Studio's dialog: which stems become tracks, what
// happens to the source when done, and whether the new tracks sit under the source.
// The host runs the separation and shows its progress in the library spinner and a toast;
// the dialog keeps one status line. While it runs, Cancel stops it and the window stays
// open to retry; the close button only hides the window.
// Choices are remembered per browser.
const STORE = 'stems.extractOptions';
const ORDER = ['drums', 'bass', 'other', 'vocals'];

export function mountExtractDialog({ t, stemName, onExtract, onCancel, onClearModel }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'extract-dialog'; dialog.className = 'extract-dialog';
  dialog.setAttribute('aria-labelledby', 'extract-title');
  const head = document.createElement('header'); head.className = 'extract-head';
  const title = document.createElement('h3'); title.id = 'extract-title'; title.textContent = t('Extract stems from sample', 'Separar stems del sample');
  const source = document.createElement('p'); source.className = 'extract-source';
  const close = createButton({ icon: 'close', title: t('Close', 'Cerrar'), variant: 'ghost', className: 'extract-close' });
  const heading = document.createElement('div'); heading.append(title, source);
  head.append(heading, close);

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch {}
  const chosen = new Set(Array.isArray(saved.stems) && saved.stems.some(stem => ORDER.includes(stem)) ? saved.stems.filter(stem => ORDER.includes(stem)) : ORDER);
  const check = (label, checked, hint = '') => {
    const wrap = document.createElement('label'); wrap.className = 'extract-check';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    const text = document.createElement('span'); text.textContent = label;
    if (hint) wrap.dataset.scdlTooltip = hint;
    wrap.append(input, text);
    return { wrap, input };
  };
  const stems = document.createElement('fieldset'); stems.className = 'extract-stems';
  const legend = document.createElement('legend'); legend.textContent = t('Stems', 'Stems'); stems.append(legend);
  const stemInputs = new Map();
  for (const stem of ORDER) {
    const item = check(stemName(stem), chosen.has(stem));
    item.input.name = 'extract-stem'; item.input.value = stem; item.wrap.dataset.stem = stem;
    stemInputs.set(stem, item.input); stems.append(item.wrap);
  }
  const when = document.createElement('div'); when.className = 'extract-when';
  const action = document.createElement('select'); action.id = 'extract-when';
  // Remove source leaves only the chosen stems; a library sample leaves the project too.
  const removeOption = new Option(t('Remove source', 'Eliminar origen'), 'delete');
  action.append(new Option(t('Mute source', 'Silenciar origen'), 'mute'), removeOption, new Option(t('Do nothing', 'No hacer nada'), 'none'));
  action.value = ['none', 'delete'].includes(saved.when) ? saved.when : 'mute';
  const whenLabel = document.createElement('label'); whenLabel.htmlFor = action.id; whenLabel.textContent = t('when done', 'al terminar');
  when.append(action, whenLabel);
  const group = check(t('Group playlist tracks', 'Agrupar pistas en la playlist'), saved.group !== false,
    t('The new tracks go right under the source track; otherwise they go at the end.', 'Las pistas nuevas van justo debajo de la pista de origen; si no, van al final.'));
  group.wrap.classList.add('extract-group'); group.input.id = 'extract-group';
  const message = document.createElement('p'); message.className = 'extract-message'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const note = document.createElement('p'); note.className = 'extract-note';
  note.textContent = t('Runs on this device. The first time downloads a 166 MB model. Up to 2 minutes of audio.', 'Corre en tu equipo. La primera vez descarga un modelo de 166 MB. Hasta 2 minutos de audio.');
  const footer = document.createElement('footer'); footer.className = 'extract-actions';
  const clear = createButton({ icon: 'trash', label: t('Remove model (166 MB)', 'Eliminar modelo (166 MB)'), variant: 'ghost', className: 'extract-clear' });
  clear.id = 'clear-cache';
  const cancel = createButton({ label: t('Cancel', 'Cancelar'), variant: 'neutral' }); cancel.id = 'cancel';
  const extract = createButton({ icon: 'layers', label: t('Extract', 'Separar'), variant: 'accent' }); extract.id = 'separate';
  const spacer = document.createElement('span'); spacer.className = 'extract-spacer';
  footer.append(clear, spacer, cancel, extract);
  const body = document.createElement('div'); body.className = 'extract-body';
  body.append(stems, when, group.wrap, message, note);
  dialog.append(head, body, footer);
  document.body.append(dialog);

  let running = false, original = false, ready = false;
  const options = () => ({ stems: ORDER.filter(stem => stemInputs.get(stem).checked), when: action.value, group: group.input.checked });
  function remember() { try { localStorage.setItem(STORE, JSON.stringify(options())); } catch {} }
  function render() {
    const none = !options().stems.length;
    extract.disabled = running || !ready || none;
    extract.dataset.scdlTooltip = none ? t('Choose at least one stem', 'Elegí al menos un stem') : '';
    for (const input of [...stemInputs.values(), action, group.input]) input.disabled = running;
    // The original's stems always have their own four tracks under it, and it stays.
    group.wrap.hidden = original; removeOption.hidden = removeOption.disabled = original;
    if (original && action.value === 'delete') action.value = 'mute';
    clear.disabled = running;
  }
  for (const input of [...stemInputs.values(), action, group.input]) input.addEventListener('change', () => { remember(); render(); });
  extract.onclick = () => { if (!extract.disabled) { remember(); onExtract(options()); } };
  cancel.onclick = () => { if (running) onCancel(); else dialog.close(); };
  close.onclick = () => dialog.close();
  clear.onclick = () => onClearModel();
  // Escape hides the window; a running separation continues and shows in the header.
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  render();
  return {
    element: dialog,
    // `name`: the sample; `original`: it is the session's source audio.
    open({ name = '', isOriginal = false } = {}) {
      original = isOriginal; source.textContent = name; source.dataset.scdlTooltip = name;
      if (!running) message.textContent = '';
      render();
      if (!dialog.open) dialog.showModal();
      (extract.disabled ? cancel : extract).focus({ preventScroll: true });
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    // Extract is enabled once there is audio to separate.
    setReady(value) { ready = !!value; render(); },
    setRunning(value) { running = !!value; render(); },
    // The step's text; `value` (0..1 or null) shows in the toast, not here.
    setProgress(value, text = message.textContent) { message.textContent = text; },
    setMessage(text) { message.textContent = text; },
  };
}
