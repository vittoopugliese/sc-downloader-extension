import { StemPresets } from './stem-presets.mjs';

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
  const $ = id => document.getElementById(id);
  const selector = $('stem-presets'), toggle = $('save-locally'), dialog = $('save-dialog');
  $('preset-label').textContent = copy.saved;
  $('save-label').textContent = copy.save;
  toggle.title = copy.off;
  $('preset-folder').title = $('preset-folder').ariaLabel = copy.folder;
  $('preset-reset').title = $('preset-reset').ariaLabel = copy.reset;
  $('save-title').textContent = copy.confirm;
  $('save-description').textContent = copy.description;
  $('save-cancel').textContent = copy.cancel;
  $('save-confirm').textContent = copy.confirm;
  $('save-name-label').textContent = copy.name;
  $('preset-reconnect').textContent = copy.connect;
  let library, active = null, enabled = false, operating = false, inference = false, pending = Promise.resolve(), nextWrite = null, writing = false, writeError = null;
  let ready = initialize();
  function error(cause) {
    console.error('[Stem presets]', cause); report(copy.failed, true);
    if (library?.directory) $('preset-reconnect').hidden = false;
  }
  function controls() {
    onOperation(operating);
    for (const id of ['stem-presets', 'preset-folder', 'preset-reset', 'preset-reconnect', 'save-locally']) $(id).disabled = operating || inference || !library;
    toggle.checked = enabled;
    toggle.disabled ||= !snapshot().info;
    $('preset-reset').hidden = !library?.directory;
    $('preset-folder').classList.toggle('has-custom-folder', !!library?.directory);
    $('preset-destination').textContent = library?.directory?.name || copy.browser;
    $('preset-destination').title = copy.destination;
  }
  async function refresh() {
    const records = await library.list();
    selector.replaceChildren(new Option(records.length ? copy.current : copy.empty, ''));
    selector.options[0].disabled = true;
    for (const record of records) {
      const option = new Option(`${record.title} · ${new Date(record.createdAt).toLocaleDateString(locale)}`, record.id);
      selector.add(option);
    }
    selector.value = active?.id || '';
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
    nextWrite = { target: library, id: active.id, settings: snapshot().settings };
    if (writing) return;
    writing = true; writeError = null;
    pending = (async () => {
      while (nextWrite) {
        const item = nextWrite; nextWrite = null;
        await item.target.update(item.id, item.settings);
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
    operating = true; controls(); report(copy.saving);
    try {
      const info = { ...data.info, title: $('save-name').value.trim() || data.info.title };
      active = await library.save(info, data.settings, data.blobs);
      // Include adjustments made while the WAVs were being written.
      changed(); await pending;
      if (writeError) throw writeError;
      await refresh(); report(copy.stored);
    } catch (cause) { enabled = false; error(cause); }
    finally { operating = false; controls(); }
  }
  toggle.onchange = () => {
    if (!toggle.checked) { enabled = false; controls(); return; }
    toggle.checked = false;
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
      if (snapshot().blobs) await save(); else report(copy.pending);
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
  selector.onchange = async () => {
    const id = selector.value;
    if (!id) { selector.value = active?.id || ''; return; }
    operating = true; controls();
    try {
      await library.authorize(true);
      await pending;
      const data = await library.load(id);
      await restore(data);
      active = data.record; enabled = true;
      $('save-name').value = active.title;
      report(copy.stored);
    } catch (cause) { selector.value = active?.id || ''; error(cause); }
    finally { operating = false; controls(); }
  };
  return {
    ready, changed,
    setBusy(value) { inference = value; controls(); },
    newExtraction() { active = null; enabled = false; selector.value = ''; controls(); },
    async completed() { await ready; await save(); },
  };
}
