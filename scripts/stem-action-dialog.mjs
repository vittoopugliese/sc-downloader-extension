import { createButton } from './ui-button.mjs';

// A bounded project operation: the chosen action is returned only after a click.
// Closing the dialog (including Escape) always cancels; callers perform the work.
export function mountActionDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'extract-dialog project-dialog'; dialog.id = 'channel-action-dialog';
  dialog.setAttribute('aria-labelledby', 'channel-action-title');
  const header = document.createElement('header'); header.className = 'extract-head';
  const title = document.createElement('h3'); title.id = 'channel-action-title';
  const close = createButton({ icon: 'close', title: 'Cancel', variant: 'ghost' });
  header.append(title, close);
  const body = document.createElement('div'); body.className = 'extract-body';
  const message = document.createElement('p'); message.className = 'extract-note'; body.append(message);
  const footer = document.createElement('footer'); footer.className = 'extract-actions channel-action-buttons';
  dialog.append(header, body, footer); document.body.append(dialog);
  let resolve = null, returnFocus = null;
  function finish(value = null) {
    const done = resolve; resolve = null;
    if (dialog.open) dialog.close();
    if (done && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    done?.(value);
  }
  close.onclick = () => finish();
  dialog.oncancel = event => { event.preventDefault(); finish(); };
  // A queued close event from the preceding action must not cancel a newly opened dialog.
  dialog.onclose = () => { if (resolve && !dialog.open) finish(); };
  dialog.addEventListener('keydown', event => event.stopPropagation());
  return {
    ask({ heading, detail, choices, cancel = 'Cancel' }) {
      if (resolve) return Promise.resolve(null);
      returnFocus = document.activeElement;
      title.textContent = heading; message.textContent = detail; close.setAttribute('aria-label', cancel); close.dataset.scdlTooltip = cancel;
      const cancelButton = createButton({ label: cancel, variant: 'neutral', onClick: () => finish() });
      cancelButton.dataset.action = 'cancel';
      footer.replaceChildren(cancelButton, ...choices.map(choice => {
        const button = createButton({ label: choice.label, variant: choice.danger ? 'neutral' : 'accent', onClick: () => finish(choice.value) });
        button.dataset.action = choice.value; button.classList.toggle('is-danger', !!choice.danger); return button;
      }));
      return new Promise(done => { resolve = done; dialog.showModal(); cancelButton.focus(); });
    },
    dispose() { finish(); dialog.remove(); },
  };
}
