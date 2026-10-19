import { createButton } from './ui-button.mjs';

// Project windows in the look of the "Extract stems" window (stem-extract-dialog.mjs):
// a name prompt for the first save, and FL Studio's "Save changes?" before another
// project replaces the open one. Both resolve a promise; Escape and the cross cancel.
export function mountProjectDialogs(copy) {
  const dialog = document.createElement('dialog');
  dialog.id = 'project-dialog'; dialog.className = 'extract-dialog project-dialog';
  dialog.setAttribute('aria-labelledby', 'project-dialog-title');
  const head = document.createElement('header'); head.className = 'extract-head';
  const heading = document.createElement('div');
  const title = document.createElement('h3'); title.id = 'project-dialog-title';
  const subtitle = document.createElement('p'); subtitle.className = 'extract-source';
  heading.append(title, subtitle);
  const close = createButton({ icon: 'close', title: copy.cancel, variant: 'ghost', className: 'project-close' });
  head.append(heading, close);
  const body = document.createElement('div'); body.className = 'extract-body';
  const footer = document.createElement('footer'); footer.className = 'extract-actions';
  dialog.append(head, body, footer);
  document.body.append(dialog);
  // The window owns its keys: playlist hotkeys and Space stay out.
  dialog.addEventListener('keydown', event => event.stopPropagation());

  let settle = null;
  function show({ heading: text, detail = '', content, buttons, focus, cancel }) {
    settle?.(cancel);
    title.textContent = text; subtitle.textContent = detail; subtitle.dataset.scdlTooltip = detail;
    body.replaceChildren(...content);
    const spacer = document.createElement('span'); spacer.className = 'extract-spacer';
    footer.replaceChildren(...buttons.slice(0, -2), spacer, ...buttons.slice(-2));
    return new Promise(resolve => {
      settle = value => { settle = null; if (dialog.open) dialog.close(); resolve(value); };
      close.onclick = () => settle?.(cancel);
      dialog.oncancel = event => { event.preventDefault(); settle?.(cancel); };
      dialog.showModal();
      focus.focus({ preventScroll: true });
    });
  }
  const note = text => { const p = document.createElement('p'); p.className = 'extract-note'; p.textContent = text; return p; };
  return {
    // Resolves the chosen name, or null.
    askName({ name = '', destination = '' } = {}) {
      const label = document.createElement('label'); label.className = 'project-name';
      const caption = document.createElement('span'); caption.textContent = copy.name;
      const input = document.createElement('input'); input.id = 'save-name'; input.maxLength = 160; input.value = name;
      input.setAttribute('autocomplete', 'off');
      label.append(caption, input);
      const cancel = createButton({ label: copy.cancel, variant: 'neutral' }); cancel.id = 'save-cancel';
      const confirm = createButton({ icon: 'save', label: copy.confirm, variant: 'accent' }); confirm.id = 'save-confirm';
      const done = () => settle?.(input.value.trim() || name || copy.untitled);
      confirm.onclick = done; cancel.onclick = () => settle?.(null);
      input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); done(); } };
      const promise = show({ heading: copy.saveTitle, detail: destination, content: [label, note(copy.description)], buttons: [cancel, confirm], focus: input, cancel: null });
      input.select();
      return promise;
    },
    // 'save', 'discard' or 'cancel'.
    askUnsaved(name) {
      const discard = createButton({ label: copy.discard, variant: 'ghost', className: 'project-discard' }); discard.id = 'unsaved-discard';
      const cancel = createButton({ label: copy.cancel, variant: 'neutral' }); cancel.id = 'unsaved-cancel';
      const save = createButton({ icon: 'save', label: copy.confirm, variant: 'accent' }); save.id = 'unsaved-save';
      discard.onclick = () => settle?.('discard'); cancel.onclick = () => settle?.('cancel'); save.onclick = () => settle?.('save');
      return show({ heading: copy.unsavedTitle, detail: name, content: [note(copy.unsavedText)], buttons: [discard, cancel, save], focus: save, cancel: 'cancel' });
    },
    isOpen: () => dialog.open,
  };
}
