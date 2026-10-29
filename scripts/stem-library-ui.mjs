import { StemPresets } from './stem-presets.mjs';
import { createRowMenu } from './stem-row-menu.mjs';
import { mountProjectDialogs } from './stem-project-dialog.mjs';
import { buttonClasses } from './ui-button.mjs';

// Saved projects, saved by hand like FL Studio: Save (Ctrl+S) writes the open project and
// Ctrl+Shift+S saves a copy under a new name. Edits only mark the project as modified (the
// * by its name); nothing is written until Save. Opening another project or an empty one
// asks Save / Don't save / Cancel first, and closing the tab with changes shows Chrome's
// "Leave site?" warning.
const NEW = 'new-project';
const COPY = {
  en: {
    saved: 'Projects', current: 'Choose project', newProject: 'Empty project', newTip: 'Start a new empty project (reloads the page)',
    save: 'Save project', saveKeys: 'Ctrl+S · Ctrl+Shift+S saves a copy with a new name', needAudio: 'Load audio first to save a project.',
    folder: 'Choose project folder', reset: 'Back to browser storage', browser: 'Browser storage', destination: 'Destination',
    saveTitle: 'Save project', confirm: 'Save', cancel: 'Cancel', name: 'Name', untitled: 'Untitled',
    description: 'Saves the audio, the stems, imported samples and every setting. Later saves update this project; edits stay unsaved until you save.',
    unsavedTitle: 'Save changes to this project?', unsavedText: 'Your changes are lost if you do not save them.', discard: "Don't save", unsaved: 'Unsaved changes',
    failed: 'Could not access or save. Check available space and folder permission, then try again.',
    stored: 'Project saved.', saving: 'Saving project…', opened: 'Project loaded.', connect: 'Reconnect folder',
    remove: 'Delete saved project', confirmRemove: 'Delete?', removed: 'Saved project deleted. The open session stays here.',
  },
  es: {
    saved: 'Proyectos', current: 'Elegir proyecto', newProject: 'Proyecto vacío', newTip: 'Empezar un proyecto vacío nuevo (recarga la página)',
    save: 'Guardar proyecto', saveKeys: 'Ctrl+S · Ctrl+Shift+S guarda una copia con otro nombre', needAudio: 'Primero cargá un audio para guardar un proyecto.',
    folder: 'Elegir carpeta de proyectos', reset: 'Volver al almacenamiento del navegador', browser: 'Navegador', destination: 'Destino',
    saveTitle: 'Guardar proyecto', confirm: 'Guardar', cancel: 'Cancelar', name: 'Nombre', untitled: 'Sin título',
    description: 'Guarda el audio, los stems, los samples importados y todos los ajustes. Los siguientes guardados actualizan este proyecto; los cambios no se guardan hasta que guardes.',
    unsavedTitle: '¿Guardar los cambios de este proyecto?', unsavedText: 'Si no los guardás, se pierden.', discard: 'No guardar', unsaved: 'Cambios sin guardar',
    failed: 'No se pudo acceder o guardar. Revisá el espacio disponible y el permiso de la carpeta; volvé a intentarlo.',
    stored: 'Proyecto guardado.', saving: 'Guardando proyecto…', opened: 'Proyecto cargado.', connect: 'Reconectar carpeta',
    remove: 'Eliminar proyecto guardado', confirmRemove: '¿Eliminar?', removed: 'Proyecto guardado eliminado. La sesión abierta sigue acá.',
  },
  de: {
    saved: 'Projekte', current: 'Projekt auswählen', newProject: 'Leeres Projekt', newTip: 'Ein neues leeres Projekt beginnen (lädt die Seite neu)',
    save: 'Projekt speichern', saveKeys: 'Strg+S · Strg+Umschalt+S speichert eine Kopie unter neuem Namen', needAudio: 'Lade zuerst Audio, um ein Projekt zu speichern.',
    folder: 'Projektordner auswählen', reset: 'Zurück zum Browserspeicher', browser: 'Browserspeicher', destination: 'Speicherort',
    saveTitle: 'Projekt speichern', confirm: 'Speichern', cancel: 'Abbrechen', name: 'Name', untitled: 'Ohne Titel',
    description: 'Speichert das Audio, die Stems, importierte Samples und alle Einstellungen. Spätere Speichervorgänge aktualisieren dieses Projekt; Änderungen bleiben bis zum Speichern ungespeichert.',
    unsavedTitle: 'Änderungen an diesem Projekt speichern?', unsavedText: 'Ohne Speichern gehen deine Änderungen verloren.', discard: 'Nicht speichern', unsaved: 'Ungespeicherte Änderungen',
    failed: 'Zugriff oder Speichern fehlgeschlagen. Prüfe Speicherplatz und Ordnerberechtigung und versuche es erneut.',
    stored: 'Projekt gespeichert.', saving: 'Projekt wird gespeichert…', opened: 'Projekt geladen.', connect: 'Ordner erneut verbinden',
    remove: 'Gespeichertes Projekt löschen', confirmRemove: 'Löschen?', removed: 'Gespeichertes Projekt gelöscht. Die offene Sitzung bleibt erhalten.',
  },
  'pt-BR': {
    saved: 'Projetos', current: 'Escolher projeto', newProject: 'Projeto vazio', newTip: 'Começar um novo projeto vazio (recarrega a página)',
    save: 'Salvar projeto', saveKeys: 'Ctrl+S · Ctrl+Shift+S salva uma cópia com outro nome', needAudio: 'Carregue um áudio primeiro para salvar um projeto.',
    folder: 'Escolher pasta de projetos', reset: 'Voltar ao armazenamento do navegador', browser: 'Navegador', destination: 'Destino',
    saveTitle: 'Salvar projeto', confirm: 'Salvar', cancel: 'Cancelar', name: 'Nome', untitled: 'Sem título',
    description: 'Salva o áudio, os stems, os samples importados e todos os ajustes. Os próximos salvamentos atualizam este projeto; as alterações só são salvas quando você salvar.',
    unsavedTitle: 'Salvar as alterações deste projeto?', unsavedText: 'Se você não salvar, as alterações serão perdidas.', discard: 'Não salvar', unsaved: 'Alterações não salvas',
    failed: 'Não foi possível acessar ou salvar. Verifique o espaço e a permissão da pasta e tente novamente.',
    stored: 'Projeto salvo.', saving: 'Salvando projeto…', opened: 'Projeto carregado.', connect: 'Reconectar pasta',
    remove: 'Excluir projeto salvo', confirmRemove: 'Excluir?', removed: 'Projeto salvo excluído. A sessão aberta continua aqui.',
  },
  ru: {
    saved: 'Проекты', current: 'Выбрать проект', newProject: 'Пустой проект', newTip: 'Начать новый пустой проект (страница перезагрузится)',
    save: 'Сохранить проект', saveKeys: 'Ctrl+S · Ctrl+Shift+S сохраняет копию под новым именем', needAudio: 'Сначала загрузите аудио, чтобы сохранить проект.',
    folder: 'Выбрать папку проектов', reset: 'Вернуться к хранилищу браузера', browser: 'Хранилище браузера', destination: 'Место сохранения',
    saveTitle: 'Сохранить проект', confirm: 'Сохранить', cancel: 'Отмена', name: 'Название', untitled: 'Без названия',
    description: 'Сохраняет аудио, стемы, импортированные сэмплы и все настройки. Следующие сохранения обновляют этот проект; изменения не сохраняются, пока вы не нажмёте «Сохранить».',
    unsavedTitle: 'Сохранить изменения в этом проекте?', unsavedText: 'Если не сохранить, изменения будут потеряны.', discard: 'Не сохранять', unsaved: 'Несохранённые изменения',
    failed: 'Не удалось открыть или сохранить. Проверьте свободное место и разрешение на доступ к папке и повторите попытку.',
    stored: 'Проект сохранён.', saving: 'Сохранение проекта…', opened: 'Проект загружен.', connect: 'Подключить папку',
    remove: 'Удалить сохранённый проект', confirmRemove: 'Удалить?', removed: 'Сохранённый проект удалён. Открытая сессия остаётся.',
  },
};
const sameAudio = (a, b) => !!a && !!b && a.length === b.length && a.every((blob, index) => blob === b[index]);

// `snapshot()` → { info, settings, blobs: [original] | [original + 4 stems] | null, samples: [{ id, name, blob() }] };
// `canSave()` says there is audio to save; `restore(data)` opens a loaded project.
export function mountStemLibrary({ locale, snapshot, restore, report, onOperation, canSave }) {
  const copy = { ...COPY.en, ...(COPY[locale] || {}) };
  const $ = id => document.getElementById(id);
  const saveButton = $('save-project'), dialogs = mountProjectDialogs(copy);
  let records = [], library = null, active = null, operating = false, inference = false, leaving = false;
  // `revision` counts edits; the stored copy matches `savedRevision` (-1: nothing stored).
  let revision = 0, savedRevision = 0, shownDirty = null, projectName = '';
  // The stored audio (to write WAVs only when they change) and the stored sample IDs.
  let savedBlobs = null, stored = new Set();
  const presetMenu = createRowMenu({ className: 'preset-menu', label: copy.saved, placeholder: copy.current,
    deleteLabel: name => `${copy.remove}: ${name}`, confirm: copy.confirmRemove,
    onSelect: id => { if (id === NEW) startEmpty(); else open(id); }, onDelete: id => remove(id) });
  $('stem-presets').replaceWith(presetMenu.element);
  presetMenu.toggle.classList.add(...buttonClasses({ size: 'text' }));
  presetMenu.toggle.id = 'stem-presets'; presetMenu.menu.id = 'stem-presets-menu'; presetMenu.toggle.setAttribute('aria-controls', 'stem-presets-menu');
  $('preset-folder').ariaLabel = copy.folder;
  $('preset-reset').dataset.scdlTooltip = $('preset-reset').ariaLabel = copy.reset;
  $('preset-reconnect').textContent = copy.connect;
  const ready = initialize();

  const dirty = () => revision !== savedRevision && canSave();
  const busy = () => operating || inference || !library;
  const currentName = () => active?.title || projectName || copy.untitled;
  function error(cause) {
    console.error('[Stem projects]', cause); report(copy.failed, 'error');
    if (library?.directory) $('preset-reconnect').hidden = false;
  }
  function renderDirty() {
    const value = dirty();
    if (value === shownDirty) return;
    shownDirty = value;
    presetMenu.setModified(value, copy.unsaved);
    saveButton.classList.toggle('has-changes', value);
    document.title = (value ? '* ' : '') + document.title.replace(/^\* /, '');
  }
  function controls() {
    onOperation(operating);
    for (const id of ['preset-folder', 'preset-reset', 'preset-reconnect']) $(id).disabled = busy();
    presetMenu.setDisabled(busy()); presetMenu.setBusy(operating);
    saveButton.disabled = busy() || !canSave();
    saveButton.dataset.scdlTooltip = canSave() ? `${copy.save} (${copy.saveKeys})` : `${copy.save} · ${copy.needAudio}`;
    saveButton.setAttribute('aria-label', copy.save);
    $('preset-reset').hidden = !library?.directory;
    $('preset-folder').classList.toggle('has-custom-folder', !!library?.directory);
    // Where projects are stored: the browser, or the chosen folder (the cross resets it).
    $('preset-folder').dataset.scdlTooltip = `${copy.destination}: ${library?.directory?.name || copy.browser} · ${copy.folder}`;
    shownDirty = null; renderDirty();
  }
  async function refresh() {
    records = await library.list();
    presetMenu.setItems([{ id: NEW, name: copy.newProject, title: copy.newTip, deletable: false, className: 'row-menu-new' },
      ...records.map(record => ({ id: record.id, name: record.title, title: `${record.title} · ${new Date(record.createdAt).toLocaleDateString(locale)}` }))]);
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
  // Edits only bump the revision: saving is by hand.
  function changed() { revision++; renderDirty(); }
  function markClean() { savedRevision = revision; controls(); }

  // Writes the open project, or asks for a name first (a new project, or Save As).
  // Resolves true once everything is stored.
  async function save({ as = false } = {}) {
    if (busy() || dialogs.isOpen()) return false;
    if (!canSave()) { report(copy.needAudio, 'info'); return false; }
    let name = null;
    if (!active || as) {
      name = await dialogs.askName({ name: as ? `${currentName()} (2)` : currentName(), destination: `${copy.destination}: ${library.directory?.name || copy.browser}` });
      if (name === null) return false;
    }
    operating = true; controls(); report(copy.saving, 'loading');
    try {
      // Folder permission is requested while the click's activation lasts.
      await library.authorize(true);
      if (!library.directory) await navigator.storage?.persist?.().catch(() => false);
      const data = snapshot(), at = revision;
      if (!data.blobs) throw new Error('No audio to save');
      if (name !== null) {
        const samples = Object.fromEntries(data.samples.map(sample => [sample.id, sample.blob()]));
        active = await library.save({ ...data.info, title: name }, data.settings, data.blobs, samples);
        stored = new Set(Object.keys(samples));
      } else await write(active.id, data);
      savedBlobs = data.blobs; savedRevision = at;
      await refresh(); report(copy.stored, 'success');
      return true;
    } catch (cause) { error(cause); return false; }
    finally { operating = false; controls(); }
  }
  async function write(id, data) {
    // Sample audio first, then the settings that name it, then drop unused samples.
    const missing = data.samples.filter(sample => !stored.has(sample.id));
    if (missing.length) {
      await library.saveSamples(id, Object.fromEntries(missing.map(sample => [sample.id, sample.blob()])));
      for (const sample of missing) stored.add(sample.id);
    }
    await library.update(id, data.settings, sameAudio(data.blobs, savedBlobs) ? null : data.blobs);
    const wanted = new Set(data.samples.map(sample => sample.id)), unused = [...stored].filter(key => !wanted.has(key));
    if (unused.length) { await library.removeSamples(id, unused); for (const key of unused) stored.delete(key); }
  }
  // Before the open project is replaced: true to go on (saved or discarded), false to stay.
  async function confirmDiscard() {
    if (!dirty()) return true;
    const choice = await dialogs.askUnsaved(currentName());
    if (choice === 'save') return save();
    return choice === 'discard';
  }
  saveButton.onclick = event => save({ as: event.shiftKey });
  // Ctrl/Cmd+S saves anywhere on the page, also inside fields; the browser's "Save page" never opens.
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    if (!event.repeat && !dialogs.isOpen()) save({ as: event.shiftKey });
  }, true);
  // Chrome shows its own "Leave site?" dialog; its text and buttons cannot be changed.
  window.addEventListener('beforeunload', event => {
    if (operating || inference || (dirty() && !leaving)) { event.preventDefault(); event.returnValue = ''; }
  });
  async function startEmpty() {
    presetMenu.setValue(active?.id || null);
    if (!await confirmDiscard()) return;
    leaving = true;
    const url = new URL(location.href);
    for (const key of ['job', 'recording']) url.searchParams.delete(key);
    location.assign(url);
  }
  async function destination(promise) {
    operating = true; controls();
    try {
      const next = await promise;
      // The open project stays as it is; its next Save asks for a name in the new place.
      library = next; active = null; savedBlobs = null; stored = new Set();
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
    presetMenu.setValue(active?.id || null);
    if (!await confirmDiscard()) return;
    presetMenu.setValue(id);
    operating = true; controls();
    try {
      await library.authorize(true);
      const data = await library.load(id);
      await restore(data);
      active = data.record; savedBlobs = data.blobs; stored = new Set(Object.keys(data.samples || {}));
      markClean(); report(copy.opened, 'success');
    } catch (cause) { presetMenu.setValue(active?.id || null); error(cause); }
    finally { operating = false; controls(); }
  }
  // Deleting the open project keeps the session in memory, now unsaved.
  // A failure keeps the row and the data, so it can be retried.
  async function remove(id) {
    const authorization = library.authorize(true);
    operating = true; controls();
    try {
      await authorization;
      await library.remove(id);
      if (active?.id === id) { active = null; savedBlobs = null; stored = new Set(); savedRevision = -1; }
      await refresh(); report(copy.removed, 'success');
    } catch (cause) { error(cause); }
    finally { operating = false; controls(); }
  }
  return {
    ready, changed, markClean, confirmDiscard, save,
    isDirty: dirty,
    setProjectName(name) { projectName = name || ''; presetMenu.setPlaceholder(name || copy.current); controls(); },
    setBusy(value) { inference = value; controls(); },
    // New audio starts a new, unsaved project.
    newExtraction() { active = null; savedBlobs = null; stored = new Set(); presetMenu.setValue(null); controls(); },
  };
}
