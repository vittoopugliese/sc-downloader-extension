import { StemPresets } from './stem-presets.mjs';
import { createRowMenu } from './stem-row-menu.mjs';

export function mountStemLibrary({ locale, snapshot, restore, report, onOperation }) {
  const es = locale === 'es';
  const copy = es ? {
    saved: 'Separaciones guardadas', current: 'Elegir separación', save: 'Guardar localmente', folder: 'Elegir carpeta de presets',
    reset: 'Volver al almacenamiento del navegador', browser: 'Navegador', confirm: 'Guardar separación', cancel: 'Cancelar',
    description: 'Se guardarán el original y los cuatro WAV en el destino elegido. Podrás volver a escucharlos sin separar otra vez. Los ajustes se guardarán automáticamente. Si todavía no separaste el loop, se guardará al terminar.',
    off: 'Desactivar detiene el guardado automático; los presets existentes se conservan.',
    failed: 'No se pudo acceder o guardar. Revisá el espacio disponible y el permiso de la carpeta; volvé a intentarlo.',
    stored: 'Separación guardada.', pending: 'Se guardará al terminar la separación.', saving: 'Guardando separación…',
    destination: 'Destino', name: 'Nombre', connect: 'Reconectar carpeta', empty: 'Sin separaciones guardadas',
  } : {
    saved: 'Saved separations', current: 'Choose separation', save: 'Save locally', folder: 'Choose preset folder',
    reset: 'Reset to browser storage', browser: 'Browser storage', confirm: 'Save separation', cancel: 'Cancel',
    description: 'The original and all four WAVs will be stored in the selected destination. Reopen them without separating again. Mix settings will save automatically. If you have not separated this loop yet, it will save when ready.',
    off: 'Switching off stops automatic saving; existing presets are kept.',
    failed: 'Could not access or save. Check available space and folder permission, then try again.',
    stored: 'Separation saved.', pending: 'Will save when separation finishes.', saving: 'Saving separation…',
    destination: 'Destination', name: 'Name', connect: 'Reconnect folder', empty: 'No saved separations',
  };
  Object.assign(copy, {
    de: {
      saved: 'Gespeicherte Trennungen', current: 'Trennung auswählen', save: 'Lokal speichern', folder: 'Preset-Ordner auswählen',
      reset: 'Zum Browserspeicher zurücksetzen', browser: 'Browserspeicher', confirm: 'Trennung speichern', cancel: 'Abbrechen',
      description: 'Das Original und alle vier WAV-Dateien werden am gewählten Ort gespeichert. Du kannst sie ohne erneute Trennung öffnen. Mix-Einstellungen werden automatisch gespeichert. Falls die Trennung noch aussteht, wird danach gespeichert.',
      off: 'Ausschalten beendet das automatische Speichern. Vorhandene Presets bleiben erhalten.',
      failed: 'Zugriff oder Speichern fehlgeschlagen. Prüfe Speicherplatz und Ordnerberechtigung und versuche es erneut.',
      stored: 'Trennung gespeichert.', pending: 'Wird nach der Trennung gespeichert.', saving: 'Trennung wird gespeichert…',
      destination: 'Speicherort', name: 'Name', connect: 'Ordner erneut verbinden', empty: 'Keine gespeicherten Trennungen',
    },
    'pt-BR': {
      saved: 'Separações salvas', current: 'Escolher separação', save: 'Salvar localmente', folder: 'Escolher pasta de presets',
      reset: 'Voltar ao armazenamento do navegador', browser: 'Navegador', confirm: 'Salvar separação', cancel: 'Cancelar',
      description: 'O original e os quatro WAVs serão salvos no destino escolhido. Você poderá ouvi-los sem separar novamente. Os ajustes serão salvos automaticamente. Se ainda não separou o loop, ele será salvo ao terminar.',
      off: 'Desativar interrompe o salvamento automático; os presets existentes são mantidos.',
      failed: 'Não foi possível acessar ou salvar. Verifique o espaço e a permissão da pasta e tente novamente.',
      stored: 'Separação salva.', pending: 'Será salvo ao terminar a separação.', saving: 'Salvando separação…',
      destination: 'Destino', name: 'Nome', connect: 'Reconectar pasta', empty: 'Nenhuma separação salva',
    },
    ru: {
      saved: 'Сохранённые разделения', current: 'Выбрать разделение', save: 'Сохранить локально', folder: 'Выбрать папку пресетов',
      reset: 'Вернуться к хранилищу браузера', browser: 'Хранилище браузера', confirm: 'Сохранить разделение', cancel: 'Отмена',
      description: 'Оригинал и четыре WAV-файла сохранятся в выбранном месте. Их можно будет открыть без повторного разделения. Настройки микса сохраняются автоматически. Если разделение ещё не выполнено, сохранение произойдёт после его завершения.',
      off: 'Выключение останавливает автосохранение. Существующие пресеты сохраняются.',
      failed: 'Не удалось открыть или сохранить. Проверьте свободное место и разрешение на доступ к папке и повторите попытку.',
      stored: 'Разделение сохранено.', pending: 'Будет сохранено после разделения.', saving: 'Сохранение разделения…',
      destination: 'Место сохранения', name: 'Название', connect: 'Подключить папку', empty: 'Нет сохранённых разделений',
    },
  }[locale]);
  Object.assign(copy, {
    en: { remove: 'Delete saved separation', confirmRemove: 'Delete?', removed: 'Saved separation deleted. The open session stays here.' },
    es: { remove: 'Eliminar separación guardada', confirmRemove: '¿Eliminar?', removed: 'Separación guardada eliminada. La sesión abierta sigue acá.' },
    de: { remove: 'Gespeicherte Trennung löschen', confirmRemove: 'Löschen?', removed: 'Gespeicherte Trennung gelöscht. Die offene Sitzung bleibt erhalten.' },
    'pt-BR': { remove: 'Excluir separação salva', confirmRemove: 'Excluir?', removed: 'Separação salva excluída. A sessão aberta continua aqui.' },
    ru: { remove: 'Удалить сохранённое разделение', confirmRemove: 'Удалить?', removed: 'Сохранённое разделение удалено. Открытая сессия остаётся.' },
  }[locale] || {});
  const $ = id => document.getElementById(id);
  const toggle = $('save-locally'), dialog = $('save-dialog');
  // Saved separations: Player Tools' preset menu. Each row opens on click and has its own
  // two-step delete, which never opens the row.
  let records = [];
  const presetMenu = createRowMenu({ className: 'preset-menu', label: copy.saved, placeholder: copy.current, empty: copy.empty,
    deleteLabel: name => `${copy.remove}: ${name}`, confirm: copy.confirmRemove,
    onSelect: id => open(id), onDelete: id => remove(id) });
  $('stem-presets').replaceWith(presetMenu.element);
  presetMenu.toggle.id = 'stem-presets'; presetMenu.menu.id = 'stem-presets-menu'; presetMenu.toggle.setAttribute('aria-controls', 'stem-presets-menu');
  $('preset-folder').ariaLabel = copy.folder;
  $('preset-reset').title = $('preset-reset').ariaLabel = copy.reset;
  $('save-title').textContent = copy.confirm;
  $('save-description').textContent = copy.description;
  $('save-cancel').textContent = copy.cancel;
  $('save-confirm').textContent = copy.confirm;
  $('save-name-label').textContent = copy.name;
  $('preset-reconnect').textContent = copy.connect;
  // `stored`: imported sample IDs whose audio the active preset already holds.
  let stored = new Set();
  let library, active = null, enabled = false, operating = false, inference = false, pending = Promise.resolve(), nextWrite = null, writing = false, writeError = null;
  let ready = initialize();
  function error(cause) {
    console.error('[Stem presets]', cause); report(copy.failed, 'error');
    if (library?.directory) $('preset-reconnect').hidden = false;
  }
  function controls() {
    onOperation(operating);
    for (const id of ['preset-folder', 'preset-reset', 'preset-reconnect', 'save-locally']) $(id).disabled = operating || inference || !library;
    presetMenu.setDisabled(operating || inference || !library); presetMenu.setBusy(operating);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.title = enabled ? `${copy.save} · ${copy.off}` : copy.save;
    toggle.setAttribute('aria-label', copy.save);
    toggle.disabled ||= !snapshot().info;
    $('preset-reset').hidden = !library?.directory;
    $('preset-folder').classList.toggle('has-custom-folder', !!library?.directory);
    // Where separations are stored: the browser, or the chosen folder (the cross resets it).
    $('preset-folder').title = `${copy.destination}: ${library?.directory?.name || copy.browser} · ${copy.folder}`;
  }
  async function refresh() {
    records = await library.list();
    presetMenu.setItems(records.map(record => ({ id: record.id, name: record.title, title: `${record.title} · ${new Date(record.createdAt).toLocaleDateString(locale)}` })));
    presetMenu.setValue(active?.id || null);
    $('preset-reconnect').hidden = true;
  }
  async function initialize() {
    try {
      library = await StemPresets.current();
      await refresh();
    } catch (cause) { $('preset-reconnect').hidden = !library?.directory; error(cause); }
    controls();
  }
  // Queue settings immediately: pagehide does not have to start a new transaction.
  function changed() {
    if (!enabled || !active) return;
    const data = snapshot();
    nextWrite = { target: library, id: active.id, settings: data.settings, samples: data.samples || [] };
    if (writing) return;
    writing = true; writeError = null;
    pending = (async () => {
      while (nextWrite) {
        const item = nextWrite; nextWrite = null;
        // Sample audio first, then the settings that name it, then drop unused samples.
        const wanted = new Set(item.samples.map(sample => sample.id));
        const missing = item.samples.filter(sample => !stored.has(sample.id));
        if (missing.length) {
          await item.target.saveSamples(item.id, Object.fromEntries(missing.map(sample => [sample.id, sample.blob()])));
          for (const sample of missing) stored.add(sample.id);
        }
        await item.target.update(item.id, item.settings);
        const unused = [...stored].filter(key => !wanted.has(key));
        if (unused.length) { await item.target.removeSamples(item.id, unused); for (const key of unused) stored.delete(key); }
      }
    })().catch(cause => { writeError = cause; nextWrite = null; error(cause); }).finally(() => { writing = false; });
  }
  window.addEventListener('beforeunload', event => {
    if (writing || operating) { event.preventDefault(); event.returnValue = ''; }
  });
  async function save() {
    const data = snapshot();
    if (!enabled || !data.blobs) return;
    if (active) { changed(); return; }
    operating = true; controls(); report(copy.saving, 'loading');
    try {
      const info = { ...data.info, title: $('save-name').value.trim() || data.info.title };
      stored = new Set();
      active = await library.save(info, data.settings, data.blobs);
      // Include adjustments made while the WAVs were being written.
      changed(); await pending;
      if (writeError) throw writeError;
      await refresh(); report(copy.stored, 'success');
    } catch (cause) { enabled = false; error(cause); }
    finally { operating = false; controls(); }
  }
  toggle.onclick = () => {
    if (enabled) { enabled = false; controls(); return; }
    if (active) { enabled = true; changed(); controls(); return; }
    $('save-name').value = snapshot().info?.title || '';
    $('save-destination').textContent = `${copy.destination}: ${library.directory?.name || copy.browser}`;
    dialog.showModal();
  };
  $('save-cancel').onclick = () => dialog.close();
  $('save-confirm').onclick = async () => {
    // Request permission while still handling the confirmation gesture.
    const authorization = library.authorize(true);
    operating = true; controls();
    dialog.close();
    try {
      await authorization;
      if (!library.directory) await navigator.storage?.persist?.().catch(() => false);
      enabled = true; controls();
      if (snapshot().blobs) await save(); else report(copy.pending, 'info');
    } catch (cause) { enabled = false; error(cause); }
    finally { operating = false; controls(); }
  };
  async function destination(promise) {
    operating = true; controls();
    try {
      const next = await promise;
      await pending;
      library = next; active = null; enabled = false;
      await refresh();
    } catch (cause) { if (cause.name !== 'AbortError') error(cause); }
    finally { operating = false; controls(); }
  }
  $('preset-folder').onclick = () => destination(StemPresets.choose());
  $('preset-reset').onclick = () => destination(StemPresets.reset());
  $('preset-reconnect').onclick = async () => {
    try { await library.authorize(true); await refresh(); } catch (cause) { error(cause); }
  };
  async function open(id) {
    if (!id) return;
    presetMenu.setValue(id);
    operating = true; controls();
    try {
      await library.authorize(true);
      await pending;
      const data = await library.load(id);
      stored = new Set(Object.keys(data.samples || {}));
      await restore(data);
      active = data.record; enabled = true;
      $('save-name').value = active.title;
      report(copy.stored, 'success');
    } catch (cause) { presetMenu.setValue(active?.id || null); error(cause); }
    finally { operating = false; controls(); }
  }
  // Deleting the open separation stops its autosave and keeps the session in memory.
  // A failure keeps the row and the data, so it can be retried.
  async function remove(id) {
    const authorization = library.authorize(true);
    operating = true; controls();
    try {
      await authorization;
      if (active?.id === id) { enabled = false; nextWrite = null; }
      await pending;
      await library.remove(id);
      if (active?.id === id) active = null;
      await refresh(); report(copy.removed, 'success');
    } catch (cause) { error(cause); }
    finally { operating = false; controls(); }
  }
  return {
    ready, changed,
    setProjectName(name) { presetMenu.setPlaceholder(name || copy.current); },
    setBusy(value) { inference = value; controls(); },
    newExtraction() { active = null; enabled = false; presetMenu.setValue(null); controls(); },
    async completed() { await ready; await save(); },
  };
}
