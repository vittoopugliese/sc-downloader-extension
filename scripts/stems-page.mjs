import { createInstruments } from './stem-instruments.mjs';
import { mountChannelRack, PLUGIN_ICONS } from './stem-channel-rack.mjs';
import { mountPianoRoll } from './stem-piano.mjs';
import { createEqualizedOutput } from './local-audio-output.mjs';
import { createStemLoop } from './stem-loop.mjs';
import { SAMPLE_RATE, MAX_SECONDS, STEMS, encodeWav } from './stem-audio.mjs';
import { MODEL } from './stem-model.mjs';
import { mountStemLibrary } from './stem-library-ui.mjs';
import { contextMenu, createKnob, mountPlaylist } from './stem-playlist.mjs';
import { mountModuleWindow } from './stem-module-window.mjs';
import { spectrumOf } from './stem-spectrum.mjs';

const translations = {
  en: {
    pageTitle: 'Stem Extractor · Player Tools', workspace: 'Separate. Mix. Make it yours.', experimental: 'Experimental', selected: 'SELECTED LOOP',
    separationLabel: 'Separation', extract: 'Unpack your sound.', local: 'On-device',
    intro: 'Separate vocals, drums, bass and other instruments locally. Your audio stays in Chrome.',
    details: 'First use downloads a 166 MB model. Processing can take a few minutes and uses substantial memory. Up to 2 minutes, at original speed without effects.',
    separate: 'Separate loop', cancel: 'Cancel', clearCache: 'Remove model', playGame: 'Play Lumberjack game', hideGame: 'Close Lumberjack game', gameTitle: 'Lumberjack game',
    clearCacheTip: 'Remove model: deletes the 166 MB separation model from the browser cache to free space. Saved separations stay; the next separation downloads it again.', playTip: 'Play / pause the playlist (Space)', pauseTip: 'Pause the playlist (Space)', gameTip: 'Play Lumberjack while the stems are separated', transport: 'Transport',
    listenCompareLabel: 'Listen and compare', listen: 'Find your mix.', play: 'Play', stop: 'Pause', original: 'Original', mix: 'Stem mix',
    lows: 'Lows', mids: 'Mids', highs: 'Highs', position: 'Position',
    ready: 'Ready. Separate this loop to compare the four stems.', preparing: 'Preparing the selected loop…', downloading: 'Downloading model',
    cache: 'Reading cached model', verify: 'Verifying model…', load: 'Loading separation model…', running: 'Separating segment',
    cancelled: 'Cancelled. You can try again.', cleared: 'Cached model removed.', complete: 'Stems ready. Inference time:',
    drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals', mute: 'Mute', solo: 'Solo', volume: 'Volume', download: 'Download',
    resetVolume: 'Double-click to reset', another: 'Another tab is separating audio. Wait for it to finish or cancel it first.',
    failed: 'Separation failed. Retry, or try a shorter loop and close other heavy tabs.', prepareFailed: 'The extension could not prepare this loop.',
    infoFailed: 'The selected loop could not be loaded.', timeout: 'Separation timed out. Try a shorter loop.', invalidAudio: 'The loop audio is invalid.',
    tooLong: 'The rendered loop exceeds 2 minutes.', cacheClearFailed: 'The cached model could not be removed.', playbackFailed: 'Audio playback could not start.', loop: 'Loop',
  },
  es: {
    pageTitle: 'Separador de stems · Player Tools', workspace: 'Separá. Mezclá. Hacelo tuyo.', experimental: 'Experimental', selected: 'LOOP SELECCIONADO',
    separationLabel: 'Separación', extract: 'Separá tu sonido.', local: 'En tu equipo',
    intro: 'Separá voz, batería, bajo y otros instrumentos localmente. Tu audio se queda en Chrome.',
    details: 'El primer uso descarga un modelo de 166 MB. El proceso puede tardar unos minutos y consume bastante memoria. Hasta 2 minutos, a velocidad original y sin efectos.',
    separate: 'Separar loop', cancel: 'Cancelar', clearCache: 'Eliminar modelo', playGame: 'Jugar a Lumberjack', hideGame: 'Cerrar Lumberjack', gameTitle: 'Juego Lumberjack',
    clearCacheTip: 'Eliminar modelo: borra de la caché del navegador el modelo de separación de 166 MB para liberar espacio. Las separaciones guardadas se conservan; la próxima separación lo vuelve a descargar.', playTip: 'Reproducir / pausar la playlist (Espacio)', pauseTip: 'Pausar la playlist (Espacio)', gameTip: 'Jugá a Lumberjack mientras se separan los stems', transport: 'Transporte',
    listenCompareLabel: 'Escuchar y comparar', listen: 'Encontrá tu mezcla.', play: 'Reproducir', stop: 'Pausar', original: 'Original', mix: 'Mezcla de stems',
    lows: 'Graves', mids: 'Medios', highs: 'Agudos', position: 'Posición',
    ready: 'Listo. Separá este loop para comparar los cuatro stems.', preparing: 'Preparando el loop seleccionado…', downloading: 'Descargando modelo',
    cache: 'Leyendo modelo de la caché', verify: 'Verificando modelo…', load: 'Cargando modelo de separación…', running: 'Separando fragmento',
    cancelled: 'Cancelado. Podés volver a intentarlo.', cleared: 'Modelo eliminado de la caché.', complete: 'Stems listos. Tiempo de inferencia:',
    drums: 'Batería', bass: 'Bajo', other: 'Otros', vocals: 'Voz', mute: 'Silenciar', solo: 'Solo', volume: 'Volumen', download: 'Descargar',
    resetVolume: 'Doble clic para restablecer', another: 'Otra pestaña está separando audio. Esperá a que termine o cancelala primero.',
    failed: 'No se pudo separar. Reintentá o probá un loop más corto y cerrá otras pestañas pesadas.', prepareFailed: 'La extensión no pudo preparar este loop.',
    infoFailed: 'No se pudo cargar el loop seleccionado.', timeout: 'La separación tardó demasiado. Probá con un loop más corto.', invalidAudio: 'El audio del loop no es válido.',
    tooLong: 'El loop procesado supera los 2 minutos.', cacheClearFailed: 'No se pudo eliminar el modelo de la caché.', playbackFailed: 'No se pudo iniciar la reproducción.', loop: 'Loop',
  },
  de: {
    pageTitle: 'Stem-Extraktor · Player Tools', workspace: 'Trennen. Mischen. Deinen Sound finden.', experimental: 'Experimentell', selected: 'AUSGEWÄHLTER LOOP',
    separationLabel: 'Stem-Trennung', extract: 'Entfalte deinen Sound.', local: 'Auf diesem Gerät',
    intro: 'Trenne Gesang, Schlagzeug, Bass und andere Instrumente lokal. Dein Audio bleibt in Chrome.',
    details: 'Bei der ersten Verwendung wird ein 166-MB-Modell heruntergeladen. Die Verarbeitung kann einige Minuten dauern und benötigt viel Arbeitsspeicher. Bis zu 2 Minuten, in Originalgeschwindigkeit und ohne Effekte.',
    separate: 'Loop trennen', cancel: 'Abbrechen', clearCache: 'Modell entfernen', playGame: 'Lumberjack spielen', hideGame: 'Lumberjack schließen', gameTitle: 'Lumberjack-Spiel',
    clearCacheTip: 'Modell entfernen: löscht das 166-MB-Trennmodell aus dem Browser-Cache, um Platz zu schaffen. Gespeicherte Trennungen bleiben erhalten; die nächste Trennung lädt es erneut herunter.', playTip: 'Playlist abspielen / pausieren (Leertaste)', pauseTip: 'Playlist pausieren (Leertaste)', gameTip: 'Lumberjack spielen, während die Stems getrennt werden', transport: 'Transport',
    listenCompareLabel: 'Anhören und vergleichen', listen: 'Finde deinen Mix.', play: 'Abspielen', stop: 'Pausieren', original: 'Original', mix: 'Stem-Mix',
    lows: 'Bässe', mids: 'Mitten', highs: 'Höhen', position: 'Position',
    ready: 'Bereit. Trenne diesen Loop, um die vier Stems zu vergleichen.', preparing: 'Ausgewählter Loop wird vorbereitet…', downloading: 'Modell wird heruntergeladen',
    cache: 'Modell wird aus dem Cache gelesen', verify: 'Modell wird überprüft…', load: 'Trennungsmodell wird geladen…', running: 'Segment wird getrennt',
    cancelled: 'Abgebrochen. Du kannst es erneut versuchen.', cleared: 'Modell aus dem Cache entfernt.', complete: 'Stems sind fertig. Verarbeitungszeit:',
    drums: 'Schlagzeug', bass: 'Bass', other: 'Andere', vocals: 'Gesang', mute: 'Stumm', solo: 'Solo', volume: 'Lautstärke', download: 'Herunterladen',
    resetVolume: 'Zum Zurücksetzen doppelklicken', another: 'Ein anderer Tab trennt gerade Audio. Warte, bis er fertig ist, oder brich ihn zuerst ab.',
    failed: 'Die Trennung ist fehlgeschlagen. Versuche es erneut oder verwende einen kürzeren Loop und schließe andere ressourcenintensive Tabs.', prepareFailed: 'Die Erweiterung konnte diesen Loop nicht vorbereiten.',
    infoFailed: 'Der ausgewählte Loop konnte nicht geladen werden.', timeout: 'Zeitüberschreitung bei der Trennung. Versuche einen kürzeren Loop.', invalidAudio: 'Das Loop-Audio ist ungültig.',
    tooLong: 'Der gerenderte Loop ist länger als 2 Minuten.', cacheClearFailed: 'Das Modell konnte nicht aus dem Cache entfernt werden.', playbackFailed: 'Die Audiowiedergabe konnte nicht gestartet werden.', loop: 'Loop',
  },
  'pt-BR': {
    pageTitle: 'Separador de stems · Player Tools', workspace: 'Separe. Misture. Crie seu som.', experimental: 'Experimental', selected: 'LOOP SELECIONADO',
    separationLabel: 'Separação', extract: 'Abra seu som.', local: 'Neste dispositivo',
    intro: 'Separe vocais, bateria, baixo e outros instrumentos localmente. Seu áudio permanece no Chrome.',
    details: 'No primeiro uso, um modelo de 166 MB será baixado. O processamento pode levar alguns minutos e usar bastante memória. Até 2 minutos, na velocidade original e sem efeitos.',
    separate: 'Separar loop', cancel: 'Cancelar', clearCache: 'Remover modelo', playGame: 'Jogar Lumberjack', hideGame: 'Fechar Lumberjack', gameTitle: 'Jogo Lumberjack',
    clearCacheTip: 'Remover modelo: apaga do cache do navegador o modelo de separação de 166 MB para liberar espaço. As separações salvas continuam; a próxima separação baixa o modelo de novo.', playTip: 'Reproduzir / pausar a playlist (Espaço)', pauseTip: 'Pausar a playlist (Espaço)', gameTip: 'Jogue Lumberjack enquanto os stems são separados', transport: 'Transporte',
    listenCompareLabel: 'Ouvir e comparar', listen: 'Encontre sua mixagem.', play: 'Reproduzir', stop: 'Pausar', original: 'Original', mix: 'Mixagem de stems',
    lows: 'Graves', mids: 'Médios', highs: 'Agudos', position: 'Posição',
    ready: 'Tudo pronto. Separe este loop para comparar os quatro stems.', preparing: 'Preparando o loop selecionado…', downloading: 'Baixando modelo',
    cache: 'Lendo modelo do cache', verify: 'Verificando modelo…', load: 'Carregando modelo de separação…', running: 'Separando segmento',
    cancelled: 'Cancelado. Você pode tentar novamente.', cleared: 'Modelo removido do cache.', complete: 'Stems prontos. Tempo de inferência:',
    drums: 'Bateria', bass: 'Baixo', other: 'Outros', vocals: 'Vocais', mute: 'Silenciar', solo: 'Solo', volume: 'Volume', download: 'Baixar',
    resetVolume: 'Clique duas vezes para redefinir', another: 'Outra aba está separando áudio. Aguarde a conclusão ou cancele-a primeiro.',
    failed: 'Falha na separação. Tente novamente ou use um loop mais curto e feche outras abas pesadas.', prepareFailed: 'A extensão não conseguiu preparar este loop.',
    infoFailed: 'Não foi possível carregar o loop selecionado.', timeout: 'O tempo da separação se esgotou. Tente um loop mais curto.', invalidAudio: 'O áudio do loop é inválido.',
    tooLong: 'O loop renderizado excede 2 minutos.', cacheClearFailed: 'Não foi possível remover o modelo do cache.', playbackFailed: 'Não foi possível iniciar a reprodução.', loop: 'Loop',
  },
  ru: {
    pageTitle: 'Разделение на стемы · Player Tools', workspace: 'Разделяйте. Микшируйте. Создавайте своё.', experimental: 'Экспериментальная функция', selected: 'ВЫБРАННЫЙ ЛУП',
    separationLabel: 'Разделение', extract: 'Разберите звук на части.', local: 'На этом устройстве',
    intro: 'Разделяйте вокал, ударные, бас и другие инструменты локально. Аудио остается в Chrome.',
    details: 'При первом запуске загружается модель размером 166 МБ. Обработка может занять несколько минут и требует много памяти. До 2 минут, с исходной скоростью и без эффектов.',
    separate: 'Разделить луп', cancel: 'Отменить', clearCache: 'Удалить модель', playGame: 'Играть в Lumberjack', hideGame: 'Закрыть Lumberjack', gameTitle: 'Игра Lumberjack',
    clearCacheTip: 'Удалить модель: стирает из кэша браузера модель разделения на 166 МБ, чтобы освободить место. Сохранённые разделения остаются; при следующем разделении модель загрузится снова.', playTip: 'Воспроизвести / пауза плейлиста (Пробел)', pauseTip: 'Пауза плейлиста (Пробел)', gameTip: 'Играть в Lumberjack, пока стемы разделяются', transport: 'Транспорт',
    listenCompareLabel: 'Прослушать и сравнить', listen: 'Создайте свой микс.', play: 'Воспроизвести', stop: 'Пауза', original: 'Оригинал', mix: 'Микс стемов',
    lows: 'Низкие', mids: 'Средние', highs: 'Высокие', position: 'Позиция',
    ready: 'Готово. Разделите этот луп, чтобы сравнить четыре стема.', preparing: 'Подготовка выбранного лупа…', downloading: 'Загрузка модели',
    cache: 'Чтение модели из кеша', verify: 'Проверка модели…', load: 'Загрузка модели разделения…', running: 'Разделение фрагмента',
    cancelled: 'Отменено. Можно попробовать еще раз.', cleared: 'Модель удалена из кеша.', complete: 'Стемы готовы. Время обработки:',
    drums: 'Ударные', bass: 'Бас', other: 'Другое', vocals: 'Вокал', mute: 'Без звука', solo: 'Соло', volume: 'Громкость', download: 'Скачать',
    resetVolume: 'Дважды щелкните для сброса', another: 'В другой вкладке уже разделяется аудио. Дождитесь завершения или сначала отмените операцию.',
    failed: 'Не удалось разделить аудио. Повторите попытку либо выберите более короткий луп и закройте другие ресурсоемкие вкладки.', prepareFailed: 'Расширению не удалось подготовить этот луп.',
    infoFailed: 'Не удалось загрузить выбранный луп.', timeout: 'Время ожидания разделения истекло. Попробуйте более короткий луп.', invalidAudio: 'Аудио лупа недействительно.',
    tooLong: 'Обработанный луп длиннее 2 минут.', cacheClearFailed: 'Не удалось удалить модель из кеша.', playbackFailed: 'Не удалось запустить воспроизведение.', loop: 'Луп',
  },
};
const browserLanguage = globalThis.chrome?.i18n?.getUILanguage?.() || navigator.languages?.[0] || navigator.language || 'en';
const language = browserLanguage.replace('_', '-').toLowerCase();
const locale = language.startsWith('es') ? 'es' : language.startsWith('de') ? 'de' : language.startsWith('pt') ? 'pt-BR' : language.startsWith('ru') ? 'ru' : 'en';
const text = key => translations[locale][key] || translations.en[key] || key;
const pt = globalThis.SCPlayerToolsText.t;
const formatOneDecimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatTwoDecimals = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = id => document.getElementById(id);
document.documentElement.lang = locale;
document.title = text('pageTitle');
globalThis.SCPlayerToolsText.localize(document.querySelector('main'));
document.querySelectorAll('[data-copy]').forEach(node => { node.textContent = text(node.dataset.copy); });
document.querySelectorAll('[data-copy-title]').forEach(node => { node.title = text(node.dataset.copyTitle); node.setAttribute('aria-label', node.title); });
document.querySelectorAll('[data-copy-aria-label]').forEach(node => { node.setAttribute('aria-label', text(node.dataset.copyAriaLabel)); });
// Local inline icons keep the extension page self-contained.
const iconPaths = {
  music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  sliders: '<path d="M4 4v6m0 4v6M12 4v10m0 4v2M20 4v2m0 4v10M1 10h6m2 4h6m2-8h6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  drums: '<ellipse cx="12" cy="9" rx="9" ry="4"/><path d="M3 9v8c0 5 18 5 18 0V9M7 13v6m10-6v6M5 2l6 4m8-4-5 4"/>',
  bass: '<path d="M5 12v2m4-7v12m4-16v18m4-15v12m4-9v6"/>',
  other: '<path d="M3 4h18v16H3zM7 4v9h3V4m4 0v9h3V4M9 13v7m6-7v7"/>',
  vocals: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5M15 11h.01M18 14h.01"/>',
  save: '<path d="M5 3h11l5 5v13H3V3h2Zm2 0v6h8V3M7 21v-7h10v7"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
};
function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true');
  node.classList.add('icon'); node.innerHTML = iconPaths[name] || iconPaths.music;
  return node;
}
$('separate').title = `${text('separate')} · ${text('details')}`;
$('toggle-game').title = text('gameTip'); $('toggle-game').setAttribute('aria-label', text('playGame'));
$('clear-cache').title = text('clearCacheTip'); $('clear-cache').setAttribute('aria-label', text('clearCache'));
$('transport').setAttribute('aria-label', text('transport'));
document.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
function playLabel(active) {
  const label = text(active ? 'stop' : 'play');
  $('play').replaceChildren(icon(active ? 'pause' : 'play'));
  $('play').title = text(active ? 'pauseTip' : 'playTip'); $('play').setAttribute('aria-label', label);
  $('play').setAttribute('aria-pressed', String(active));
}
playLabel(false);
const padStyle = document.createElement('style');
padStyle.textContent = globalThis.SCSamplerCore.PAD_STYLES;
document.head.append(padStyle);
const waveforms = new Set();
const stemLoop = createStemLoop({ viewportChanged() {
  for (const view of waveforms) view.draw();
  updatePlayheads();
}, duration: () => Math.max(original?.duration || 0, playlist.duration()), changed: () => syncLoop() });
// The A–B selection loops the playlist; clearing it loops the whole arrangement.
function syncLoop() {
  const { startMs, endMs } = stemLoop.range();
  playlist.setLoopRange(stemLoop.selected() ? { start: startMs / 1000, end: endMs / 1000 } : null);
}
const zoomTools = document.createElement('div'); zoomTools.className = 'stem-zoom-tools';
for (const [label, title, action] of [
  ['−', pt('Zoom out'), () => stemLoop.zoomAt(offset() * 1000, 1)],
  ['+', pt('Zoom in'), () => stemLoop.zoomAt(offset() * 1000, -1)],
  ['↔', pt('Show all audio'), () => stemLoop.resetZoom()],
]) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.title = title; button.setAttribute('aria-label', title); button.onclick = action; zoomTools.append(button);
}
const zoomHint = document.createElement('span');
zoomHint.textContent = pt('Wheel: zoom · Shift + wheel: pan');
zoomTools.append(zoomHint); $('original-waveform').before(zoomTools);
function seekTo(value) { playlist.seek(Math.max(0, value)); updatePlayheads(); }
const offset = () => playlist.now();
function updatePlayheads() {
  if (!original) return;
  const at = offset(), active = playlist.playing();
  const percent = stemLoop.percent(Math.max(0, at) * 1000);
  for (const view of waveforms) {
    view.playhead.style.left = `${percent}%`;
    view.playhead.hidden = percent < 0 || percent > 100;
    view.element.setAttribute('aria-valuenow', at.toFixed(1));
  }
}
function mountWaveform(parent, buffer, label) {
  const element = document.createElement('div'); element.className = 'waveform';
  element.tabIndex = 0; element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', label); element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', String(buffer.duration)); element.setAttribute('aria-valuenow', '0');
  element.addEventListener('keydown', event => {
    const steps = { ArrowLeft: -0.1, ArrowDown: -0.1, ArrowRight: 0.1, ArrowUp: 0.1 };
    if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    seekTo(event.key === 'Home' ? 0 : event.key === 'End' ? original.duration : offset() + steps[event.key]);
  });
  const canvas = document.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label);
  const playhead = document.createElement('span'); playhead.className = 'waveform-playhead'; playhead.setAttribute('aria-hidden', 'true');
  element.append(canvas, playhead); parent.append(element);
  const disposeLoop = stemLoop.mount(element, seekTo);
  const controller = new AbortController();
  const view = { element, playhead, draw: () => drawWaveform(), dispose() { disposeLoop(); controller.abort(); observer.disconnect(); waveforms.delete(view); element.remove(); } };
  waveforms.add(view);
  const ui = { waveformCanvas: canvas };
  const waveformCollapsed = false, waveformSamples = [], waveformDrawPreview = null;
  let waveformSpectrum, waveformStaticKey = '', waveformRevision = 0;
  const loopState = { durationMs: buffer.duration * 1000 };
  const visibleWaveformWindow = () => stemLoop.viewport();
  const loopPercentInWindow = (time, range) => (time - range.startMs) / (range.endMs - range.startMs) * 100;
  // Copied from tempo-control-main.js: same physical-pixel peak aggregation,
  // RGB energy mapping as the Player Tools looper. Use a fixed amplitude
  // scale so quiet separation residuals stay quiet-looking across stems.
  function drawWaveform() {
    if (!ui?.waveformCanvas || waveformCollapsed || !ui.waveformCanvas.getClientRects().length || document.hidden) return;
    const canvas = ui.waveformCanvas;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const windowRange = visibleWaveformWindow();
    const displayedRange = waveformDrawPreview || loopState;
    const drawKey = JSON.stringify([waveformRevision, width, height, scale,
      loopState.durationMs, windowRange?.startMs, windowRange?.endMs,
      displayedRange.startMs, displayedRange.endMs, loopState.active]);
    if (drawKey === waveformStaticKey) return;
    waveformStaticKey = drawKey;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#0e1216";
    context.fillRect(0, 0, width, height);
    if (!windowRange) return;
    const durationMs = loopState.durationMs;
    const samples = waveformSpectrum?.peaks || waveformSamples;
    const complete = Number.isFinite(displayedRange.startMs) && Number.isFinite(displayedRange.endMs);
    const start = complete ? loopPercentInWindow(displayedRange.startMs, windowRange) : -1;
    const end = complete ? loopPercentInWindow(displayedRange.endMs, windowRange) : -1;
    // One column per physical pixel; peak aggregation preserves short transients.
    if (!samples.length) return;
    const bands = waveformSpectrum?.bands;
    const sourceDuration = waveformSpectrum?.durationMs || durationMs;
    const windowSpan = windowRange.endMs - windowRange.startMs;
    const detailChannels = windowSpan < durationMs
      ? Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)) : null;
    for (let x = 0; x < width; x += 1) {
      const from = (windowRange.startMs + x / width * (windowRange.endMs - windowRange.startMs)) / sourceDuration * samples.length;
      const to = (windowRange.startMs + (x + 1) / width * (windowRange.endMs - windowRange.startMs)) / sourceDuration * samples.length;
      let peak = 0, low = 0, mid = 0, high = 0;
      for (let i = Math.max(0, Math.floor(from)); i < Math.min(samples.length, Math.max(Math.floor(from) + 1, Math.ceil(to))); i += 1) {
        peak = Math.max(peak, Math.abs(Number(samples[i]) || 0));
        if (bands) { low += bands[i * 3]; mid += bands[i * 3 + 1]; high += bands[i * 3 + 2]; }
      }
      if (detailChannels) {
        // Read the original PCM at zoomed resolution so transient boundaries
        // remain precise instead of enlarging the overview's 5 ms bins.
        const first = Math.max(0, Math.floor((windowRange.startMs + x / width * windowSpan) * buffer.sampleRate / 1000));
        const last = Math.min(buffer.length, Math.max(first + 1, Math.ceil((windowRange.startMs + (x + 1) / width * windowSpan) * buffer.sampleRate / 1000)));
        peak = 0;
        for (const channel of detailChannels) for (let i = first; i < last; i++) peak = Math.max(peak, Math.abs(channel[i]));
      }
      const energy = Math.max(low, mid, high);
      context.fillStyle = bands && energy > 0
        ? 'rgb(' + [low, mid, high].map(value => Math.round(55 + 190 * Math.sqrt(value / energy))).join(',') + ')'
        : '#858d96';
      const percent = x / width * 100;
      context.globalAlpha = complete && (percent < start || percent > end) ? .58 : .96;
      const barHeight = Math.min(1, peak) * height * .88;
      context.fillRect(x, (height - barHeight) / 2, 1, barHeight);
    }
    context.globalAlpha = 1;
  }


  const observer = new ResizeObserver(drawWaveform); observer.observe(canvas);
  spectrumOf(buffer).then(spectrum => {
    if (controller.signal.aborted) return;
    waveformSpectrum = spectrum; waveformRevision++; drawWaveform(); updatePlayheads();
  }).catch(error => { if (error.name !== 'AbortError') console.error('[Stems waveform]', error); });
  return view;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) for (const view of waveforms) view.draw();
});
const jobId = new URL(location.href).searchParams.get('job');
let original, buffers = [], context, outputs = [], urls = [];
let busy = false, revision = 0, worker, rejectWorker, title = text('loop'), initialized = false;
let info = null, wavs = [], rate = 1, keepTone = false, toneNode, toneReady, toneLatency = 0, libraryOperating = false;
let libraryUI, importReady = false;
// The playlist is the only song transport. Each stem is a channel whose header persists
// across playlist redraws; the channel rack and piano roll are plugins below it.
const channels = new Map();
function reconcileChannels() {
  const keys = new Set(playlist.tracks().map(track => track.stem || track.id));
  for (const [key, item] of channels) if (!keys.has(key)) { item.head.remove(); channels.delete(key); }
}
// The header play button is the transport; the playlist toolbar joins the header with
// the speed slider next to the tempo controls.
// Tool windows (FL Studio's F6–F10): buttons in the Playlist tool rows, windows created below.
const say = (en, es) => locale === 'es' ? es : en;
let moduleWindows = {};
const WINDOWS = [
  { id: 'rack', icon: PLUGIN_ICONS.rack, name: say('Channel rack', 'Channel rack'), key: 'F6', keys: ['f6'], color: '#7bd88f',
    detail: say('the focused track cut into eight pads and its step patterns', 'la pista enfocada cortada en ocho pads y sus patrones de pasos') },
  { id: 'piano', icon: PLUGIN_ICONS.piano, name: say('Piano roll', 'Piano roll'), key: 'F7', keys: ['f7'], color: '#c792ea',
    detail: say('notes of the focused pattern', 'las notas del patrón enfocado') },
  { id: 'eq', icon: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6', name: say('Parametric EQ', 'EQ paramétrico'), key: 'F9', keys: ['f9'], color: '#4fc3f7',
    detail: say('equalizer of the selected channel, or of the master', 'ecualizador del canal seleccionado o del master') },
  { id: 'recorder', icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>', name: say('Recorder', 'Grabadora'), key: 'F10', keys: ['f10'], color: '#ff4d6d',
    detail: say('records the final mix to a WAV', 'graba la mezcla final en un WAV') },
].map(item => ({ ...item, toggle: () => moduleWindows[item.id]?.toggle() }));
const playlist = mountPlaylist({ container: $('playlist'), toolbarHost: $('transport'), playButton: false, windows: WINDOWS,
  // One line: separate and play, tempo and speed, edits, then model and game utilities.
  toolbarStart: [$('separate'), $('cancel'), $('play')], tempoControls: [document.querySelector('.stem-tempo')], toolbarEnd: [$('clear-cache'), $('toggle-game')],
  onPatternAction(action, id) { const pattern = id.slice('pattern:'.length); if (action === 'duplicate') instruments?.duplicatePattern(pattern); else instruments?.deletePattern(pattern); },
  audio: playlistAudio, channel: channelForTrack,
  onLoopChange(range) { stemLoop.setRange(range ? { startMs: range.start * 1000, endMs: range.end * 1000, durationMs: original?.duration * 1000 || range.end * 1000 } : null); },
  onChange() { reconcileChannels(); renderChannels(); instruments?.sync(); libraryUI?.changed(); },
  // Selecting a pattern clip opens that pattern, as double-clicking one does in FL Studio.
  onSelect(asset) { if (asset?.pattern) instruments?.focusPattern(asset.id.slice('pattern:'.length)); },
  onTransport(active) {
    if (active) instruments?.stop();
    toneNode?.port.postMessage({ rate, keepTone, reset: true }); playLabel(active); updatePlayheads();
  } });
const mixOutput = createEqualizedOutput({ audioContext: () => context ||= new AudioContext({ sampleRate: SAMPLE_RATE }) });
// Tracks are instruments: their own audio is what the channel rack cuts into pads.
const instrumentTracks = () => playlist.tracks().map(track => ({ key: track.stem || track.id,
  name: track.stem ? text(track.stem) : track.name, buffer: playlist.trackSource(track.id)?.buffer || null }));
const instruments = createInstruments({ playlist, tracks: instrumentTracks, rate: () => rate, report: playbackError,
  changed: () => libraryUI?.changed(),
  async audio() { const io = await playlistAudio(); toneNode?.port.postMessage({ rate, keepTone, reset: true }); return io; } });
const pluginAudio = { audioContext: () => mixOutput.getPlaybackContext(), output: () => mixOutput.input() };
const channelRack = mountChannelRack({ container: $('mix-tools'), instruments, ...pluginAudio, locale, report: playbackError });
const pianoRoll = mountPianoRoll({ container: $('mix-tools'), instruments, ...pluginAudio, report: playbackError });
const equalizerUI = globalThis.SCParametricEQUI.mount({
  container: $('mix-tools'), effects: mixOutput, isAllowed: () => true, authorize: async () => true,
  onChange: () => libraryUI?.changed(), pro: false,
  iconUrl: new URL('../assets/icons/eq.svg', import.meta.url).href,
  resetIconUrl: new URL('../assets/icons/cross.svg', import.meta.url).href,
});
const recorderUI = globalThis.SCRecordUI.mount({
  container: $('mix-tools'), effects: mixOutput,
  moduleUrl: new URL('./record-processor.js', import.meta.url).href,
  iconUrl: new URL('../assets/icons/record.svg', import.meta.url).href,
});
equalizerUI.setCollapsed(false);
recorderUI.setCollapsed(false);
channelRack.setCollapsed(false); pianoRoll.setCollapsed(false);
// The four modules are windows now: always expanded, opened from their buttons or keys.
{
  const sections = { rack: $('stem-rack'), piano: $('stem-piano-roll'), eq: $('scdl-parametric-eq'), recorder: $('scdl-record') };
  const sizes = { rack: { width: 940, height: 470, offset: 0 }, piano: { width: 940, height: 470, offset: 28 }, eq: { width: 680, height: 380, offset: 56 }, recorder: { width: 600, height: 300, offset: 84 } };
  const visibility = { eq: value => equalizerUI.setVisible(value), recorder: value => recorderUI.setVisible(value) };
  const shown = { rack: () => channelRack.open(), piano: () => pianoRoll.open() };
  for (const item of WINDOWS) {
    const section = sections[item.id];
    section.hidden = false;
    moduleWindows[item.id] = mountModuleWindow({ id: item.id, section, header: section.querySelector('.tool-section-header'), home: $('mix-tools'),
      t: say, size: sizes[item.id], setVisible: visibility[item.id], onShow: shown[item.id],
      onChange: open => playlist.windowButton(item.id)?.setAttribute('aria-pressed', String(open)) });
  }
}
function revealAudition() {
  $('audition').hidden = false;
  // With results, the source row also holds the transport: keep it to one line.
  document.querySelector('.prepare').classList.add('has-results');
}
const localCopy = ({
  es: ['Cargar audio del equipo', 'Elegí un archivo y un fragmento de hasta 2 minutos.', 'Cargar fragmento', 'Nombre', 'Inicio (s)', 'Fin (s)', 'Cancelar', 'Leyendo audio…', 'No se pudo leer el audio. Probá otro archivo o un formato compatible con Chrome.', 'Elegí un rango válido de hasta 2 minutos dentro del archivo.', 'Elegí un audio del equipo o una separación guardada.'],
  en: ['Load audio from computer', 'Choose a file and a segment up to 2 minutes.', 'Load segment', 'Name', 'Start (s)', 'End (s)', 'Cancel', 'Reading audio…', 'Could not read audio. Try another file or a format supported by Chrome.', 'Choose a valid range up to 2 minutes within the file.', 'Choose local audio or a saved separation.'],
  de: ['Audio vom Computer laden', 'Datei und einen Ausschnitt von bis zu 2 Minuten auswählen.', 'Ausschnitt laden', 'Name', 'Start (s)', 'Ende (s)', 'Abbrechen', 'Audio wird gelesen…', 'Audio konnte nicht gelesen werden. Versuche eine andere Datei oder ein von Chrome unterstütztes Format.', 'Wähle einen gültigen Bereich von bis zu 2 Minuten innerhalb der Datei.', 'Wähle lokales Audio oder eine gespeicherte Trennung.'],
  'pt-BR': ['Carregar áudio do computador', 'Escolha um arquivo e um trecho de até 2 minutos.', 'Carregar trecho', 'Nome', 'Início (s)', 'Fim (s)', 'Cancelar', 'Lendo áudio…', 'Não foi possível ler o áudio. Tente outro arquivo ou formato compatível com o Chrome.', 'Escolha um intervalo válido de até 2 minutos dentro do arquivo.', 'Escolha um áudio local ou uma separação salva.'],
  ru: ['Загрузить аудио с компьютера', 'Выберите файл и фрагмент до 2 минут.', 'Загрузить фрагмент', 'Название', 'Начало (с)', 'Конец (с)', 'Отмена', 'Чтение аудио…', 'Не удалось прочитать аудио. Попробуйте другой файл или формат, поддерживаемый Chrome.', 'Выберите допустимый фрагмент до 2 минут в пределах файла.', 'Выберите локальное аудио или сохранённое разделение.'],
})[locale] || [];
for (const [id, index] of Object.entries({ 'import-title': 2, 'import-confirm': 2,
  'import-name-label': 3, 'import-start-label': 4, 'import-end-label': 5, 'import-cancel': 6, 'import-range-hint': 1 })) $(id).textContent = localCopy[index];
let importDraft = null;
$('import-audio-label').textContent = ({ es: 'Cargar', en: 'Load', de: 'Laden', 'pt-BR': 'Carregar', ru: 'Загрузить' })[locale] || 'Load';
$('import-audio').title = localCopy[0];
$('import-audio').onclick = () => $('audio-file').click();
$('audio-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || busy || libraryOperating) return;
  setBusy(true); $('cancel').hidden = true; status(localCopy[7]);
  try {
    if (!file.size || file.size > 256 * 1024 * 1024) throw new Error('Invalid file size (maximum 256 MiB)');
    const decoded = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(await file.arrayBuffer());
    if (!decoded.length) throw new Error('Empty audio');
    // Hide sub-millisecond resampling differences in the editable range.
    const duration = Math.round(decoded.duration * 1000) / 1000 || decoded.duration;
    importDraft = { file, decoded, duration };
    $('import-name').value = file.name.replace(/\.[^.]+$/, '').slice(0, 160) || file.name;
    $('import-file-info').textContent = `${file.name} · ${formatTwoDecimals.format(decoded.duration)} s · ${decoded.numberOfChannels} ch · ${(file.size / 1024 / 1024).toFixed(2)} MiB`;
    $('import-start').value = '0'; $('import-end').value = String(Math.min(MAX_SECONDS, duration));
    $('import-start').max = $('import-end').max = String(duration);
    $('import-error').textContent = '';
    $('import-dialog').showModal();
    status(original || initialized ? text('ready') : localCopy[10]);
  } catch (error) { console.error('[Stems import]', error); importDraft = null; setBusy(false); status(localCopy[8], true); }
};
$('import-cancel').onclick = () => $('import-dialog').close();
$('import-dialog').addEventListener('close', () => { importDraft = null; setBusy(false); });
$('import-form').onsubmit = event => {
  event.preventDefault();
  if (!importDraft) return;
  const { file, decoded, duration } = importDraft;
  const start = Number($('import-start').value), end = Number($('import-end').value);
  const first = Math.round(start * SAMPLE_RATE), last = Math.min(decoded.length, Math.round(end * SAMPLE_RATE));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || end <= start ||
      end - start > MAX_SECONDS || last <= first || last - first > MAX_SECONDS * SAMPLE_RATE) {
    $('import-error').textContent = localCopy[9]; return;
  }
  const channels = [0, Math.min(1, decoded.numberOfChannels - 1)].map(channel => decoded.getChannelData(channel).slice(first, last));
  if (channels.some(channel => !channel.every(Number.isFinite))) { $('import-error').textContent = localCopy[8]; return; }
  const next = audioBuffer(channels);
  disposeResults();
  for (const view of waveforms) view.dispose();
  original = next; wavs = []; rate = 1; keepTone = false; renderTempo(); playlist.setRate(rate);
  renderInfo({ title: $('import-name').value.trim() || file.name, artist: '', artworkUrl: '', durationMs: decoded.duration * 1000,
    trimRange: { startMs: first / SAMPLE_RATE * 1000, endMs: last / SAMPLE_RATE * 1000 },
    localFile: { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, channels: decoded.numberOfChannels } });
  initialized = true; libraryUI.newExtraction();
  revealAudition();
  mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
  showOriginal();
  $('import-dialog').close(); status(text('ready'));
};
const settings = () => ({ ...instruments.snapshot(),
  states: STEMS.map(stem => { const track = playlist.track(stem); return { muted: !!track?.mute, solo: false, gain: track?.gain ?? 1 }; }),
  original: { muted: !!playlist.track('original')?.mute, gain: playlist.track('original')?.gain ?? 1 },
  rate, keepTone, eq: mixOutput.snapshot().eq, playlist: playlist.snapshot() });
libraryUI = mountStemLibrary({ locale, report: status,
  onOperation(value) { libraryOperating = value; $('separate').disabled = value || busy || !initialized; $('cancel').disabled = value; $('import-audio').disabled = value || busy || !importReady; },
  snapshot: () => ({ info, settings: settings(), blobs: wavs.length === 5 ? wavs : null }),
  restore: async ({ record, blobs }) => {
    // Decode/validate before replacing the current session. Missing/corrupt files
    // leave the current separation intact.
    const decoder = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const decoded = [];
    for (const blob of blobs) {
      const buffer = await decoder.decodeAudioData(await blob.arrayBuffer());
      if (buffer.numberOfChannels !== 2 || !buffer.length || buffer.duration > MAX_SECONDS + 1 / SAMPLE_RATE ||
          (decoded.length && buffer.length !== decoded[0].length)) throw new Error('Invalid preset WAV');
      for (let channel = 0; channel < 2; channel++) if (!buffer.getChannelData(channel).every(Number.isFinite)) throw new Error('Invalid PCM');
      decoded.push(buffer);
    }
    disposeResults();
    for (const view of waveforms) view.dispose();
    original = decoded[0];
    renderInfo(record.info);
    revealAudition();
    mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
    showResults({ outputs: decoded.slice(1).map(buffer => [buffer.getChannelData(0), buffer.getChannelData(1)]), seconds: 0 }, record.settings);
    wavs = blobs;
    initialized = true;
  },
});

function renderTempo() {
  $('stem-rate').value = rate;
  $('stem-rate').style.setProperty('--range-fill', `${(rate - .1) / 2.9 * 100}%`);
  // Same truncated display as the Player Tools speed readout.
  $('stem-rate-value').textContent = `${(Math.floor(rate * 1000 + 1e-9) / 1000).toFixed(3)}x`;
  $('stem-rate').setAttribute('aria-valuetext', $('stem-rate-value').textContent);
  $('stem-keep-tone').checked = keepTone;
}
function changeTempo(value = rate, preserve = keepTone) {
  const next = Number(value);
  if (!Number.isFinite(next)) { renderTempo(); return; }
  rate = Math.round(Math.max(.1, Math.min(3, next)) * 10000) / 10000;
  keepTone = preserve;
  playlist.setRate(rate);
  toneNode?.port.postMessage({ rate, keepTone });
  instruments.rateChanged(); renderTempo(); libraryUI.changed();
}
$('stem-rate').oninput = event => changeTempo(event.target.value);
$('stem-rate').ondblclick = () => changeTempo(1);
$('stem-keep-tone').onchange = event => changeTempo(rate, event.target.checked);
$('stem-rate').title = $('stem-rate-value').title = pt('Playback speed of the whole session (0.1×–3×). Unlike BPM, it changes how fast the audio plays. Double-click to reset to 1×.');
renderTempo();

async function prepareTone() {
  if (!toneReady) toneReady = (async () => {
    await context.audioWorklet.addModule(new URL('./stem-tone-processor.mjs', import.meta.url));
    const node = new AudioWorkletNode(context, 'scdl-stem-tone', { outputChannelCount: [2], channelCount: 2 });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tone processor timeout')), 15000);
      node.port.onmessage = ({ data }) => {
        clearTimeout(timer);
        if (data.type === 'ready') { toneLatency = data.latency; resolve(); } else reject(new Error(data.message));
      };
      node.onprocessorerror = () => { clearTimeout(timer); reject(new Error('Tone processor failed')); };
    }).catch(error => { node.port.postMessage({ type: 'dispose' }); node.disconnect(); throw error; });
    toneNode = node;
    node.onprocessorerror = () => {
      playlist.pause(); node.disconnect(); toneNode = null; toneReady = null;
      playbackError(new Error('Tone processor failed'));
    };
    toneNode.connect(mixOutput.input());
  })().catch(error => { toneReady = null; throw error; });
  await toneReady;
}
// The playlist plays into the shared context: Keep Tone, then EQ and recorder.
async function playlistAudio() {
  const playback = mixOutput.getPlaybackContext();
  await playback.resume();
  try { await prepareTone(); return { context: playback, output: toneNode }; }
  catch (error) { console.error('[Stems tone]', error); return { context: playback, output: mixOutput.input() }; }
}

// Status lines go away after 10 s; progress messages stay while a task runs.
let statusTimer = 0;
function status(message, error = false) {
  $('status').textContent = message; $('status').classList.toggle('error', error);
  clearTimeout(statusTimer);
  if (message && !busy) statusTimer = setTimeout(() => { if (!busy) { $('status').textContent = ''; $('status').classList.remove('error'); } }, 10000);
}
function localizedError(key) { const error = new Error(text(key)); error.localized = true; return error; }
function playbackError(error) { console.error('[Stems playback]', error); status(text('playbackFailed'), true); }
async function message(type) {
  const result = await chrome.runtime.sendMessage({ type, jobId });
  if (!result?.success) {
    const error = localizedError(type === 'STEM_LOOP_INFO' ? 'infoFailed' : 'prepareFailed');
    // Keep the preparation failure actionable, without exposing signed media URLs.
    const detail = typeof result?.error === 'string'
      ? result.error.replace(/https?:\/\/[^\s]+/gi, '[URL]').slice(0, 400) : '';
    if (detail) error.message += ` ${detail}`;
    else if (Number.isInteger(result?.status)) error.message += ` HTTP ${result.status}.`;
    throw error;
  }
  return result;
}
function setBusy(value) {
  busy = value;
  $('separate').disabled = value || libraryOperating || !initialized;
  $('cancel').hidden = !value;
  $('clear-cache').disabled = value;
  $('progress').hidden = !value;
  $('status').classList.toggle('is-loading', value);
  libraryUI?.setBusy(value);
  // The last message of a finished task also expires.
  if (!value && $('status').textContent) status($('status').textContent, $('status').classList.contains('error'));
}
function audioBuffer(channels) {
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: channels[0].length, sampleRate: SAMPLE_RATE });
  channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
  return buffer;
}
// Channel headers mirror the playlist tracks.
function renderChannels() {
  for (const [stem, item] of channels) {
    const track = playlist.track(stem);
    if (!track) continue;
    item.enable.setAttribute('aria-checked', String(!track.mute));
    const silent = !playlist.audible(track) || track.gain === 0;
    item.head.classList.toggle('is-silent', silent);
    item.volume.show(Math.round(track.gain * 100));
  }
}
function editChannel(stem, change, options) {
  playlist.edit(state => change(state.tracks.find(track => (track.stem || track.id) === stem), state), options);
}
// Header row: enable (right-click: hear only this), name, volume and a ⋮ menu with the rack,
// piano roll and WAV. Right-clicking the header opens the same menu.
function buildChannel(stem, wav, trackName = null) {
  const name = trackName || (stem === 'original' ? text('original') : text(stem));
  const head = document.createElement('div'); head.className = `stem ${trackName ? 'pl-user-head' : 'pl-stem-head'}`; head.dataset.stem = stem;
  const heading = document.createElement('h2'), label = document.createElement('span'); label.className = 'stem-name';
  label.append(icon(STEMS.includes(stem) ? stem : 'music'), document.createTextNode(trackName ? '' : name)); heading.append(label);
  if (trackName) {
    const rename = document.createElement('input'); rename.className = 'pl-track-name'; rename.value = name; rename.maxLength = 160;
    rename.setAttribute('aria-label', pt('Name'));
    rename.onchange = () => editChannel(stem, track => { track.name = rename.value.trim() || name; });
    heading.append(rename);
  }
  const enable = document.createElement('button'); enable.type = 'button'; enable.className = 'stem-enable stem-solo';
  enable.setAttribute('role', 'switch'); enable.setAttribute('aria-label', pt('Enable $1', name));
  enable.title = pt('Enable/disable $1 · Right-click: hear only this track', name);
  enable.onclick = () => editChannel(stem, track => { track.mute = !track.mute; });
  const hearOnly = () => playlist.edit(state => { for (const track of state.tracks) { track.mute = (track.stem || track.id) !== stem; track.solo = false; } });
  enable.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); hearOnly(); };
  const volume = createKnob({ label: `${text('volume')} ${name}`, min: 0, max: 200, step: 1, coarse: 10, value: 100, reset: 100,
    hint: text('resetVolume'), format: value => `${value}%`,
    onInput: value => editChannel(stem, track => { track.gain = value / 100; }, { live: true }),
    onCommit: value => editChannel(stem, track => { track.gain = value / 100; }) });
  volume.wrap.classList.add('is-inline', 'stem-volume');
  const link = document.createElement('a'); link.className = 'download';
  const url = wav ? URL.createObjectURL(wav) : ''; if (url) urls.push(url);
  link.href = url; link.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)}_${stem}.wav`;
  // FL's channel options: focus this track in the channel rack or the piano roll, or save its WAV.
  const editorHint = wav ? '' : pt('Add a sample to this track to use its editors.');
  const menu = event => contextMenu(event, [
    { label: pt('Channel rack'), icon: PLUGIN_ICONS.rack, disabled: !wav, title: editorHint, action: () => { instruments.focus(stem); moduleWindows.rack.reveal(); channelRack.open(); } },
    { label: pt('Piano roll'), icon: PLUGIN_ICONS.piano, disabled: !wav, title: editorHint, action: () => { instruments.focus(stem); moduleWindows.piano.reveal(); pianoRoll.open(); } },
    { label: pt('Download WAV'), icon: iconPaths.download, disabled: !wav, action: () => link.click() },
    '-',
    { label: pt('Hear only this track'), icon: iconPaths.music, action: hearOnly },
  ]);
  const more = document.createElement('button'); more.type = 'button'; more.className = 'stem-more';
  more.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
  more.title = pt('Track options: $1 · or right-click the track', name); more.setAttribute('aria-label', more.title); more.setAttribute('aria-haspopup', 'menu');
  more.onclick = menu;
  head.oncontextmenu = event => { if (!event.target.closest('input')) menu(event); };
  head.append(enable, heading, volume.wrap, more);
  const item = { head, enable, volume };
  channels.set(stem, item);
  return item;
}
function channelForTrack(track, source) {
  if (!original) return null;
  const key = track.stem || track.id, previous = channels.get(key);
  if (previous && previous.buffer === source?.buffer) return previous;
  previous?.head.remove();
  const item = buildChannel(key, source ? wavOf(source.buffer) : null, track.stem ? null : track.name);
  item.buffer = source?.buffer;
  return item;
}
function startSession(saved = null) {
  const sources = [original, ...buffers].map((buffer, index) => {
    const stem = index ? STEMS[index - 1] : 'original';
    // With stems, the original starts muted so the mix is not doubled.
    const mute = index ? false : saved?.original ? saved.original.muted === true : buffers.length > 0;
    return { id: `audio-${stem}`, stem, name: index ? text(stem) : text('original'), buffer, mute };
  });
  // The stem mix lives in `states` (as before the playlist); the arrangement adds clips.
  const tracks = saved?.states && [...STEMS.map((stem, i) => ({ stem, gain: saved.states[i]?.gain, mute: saved.states[i]?.muted === true })),
    ...(saved.original ? [{ stem: 'original', gain: saved.original.gain, mute: saved.original.muted === true }] : [])];
  playlist.setSession({ sources, saved: saved && { ...saved.playlist, tracks } });
  $('original-waveform').hidden = true; zoomTools.hidden = true;
  renderChannels();
}
const wavOf = buffer => new Blob([encodeWav([buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))], buffer.sampleRate)], { type: 'audio/wav' });
// Before separation the playlist holds the source audio alone.
function showOriginal() {
  wavs = [];
  startSession(); syncLoop();
}
function disposeResults() {
  mixOutput.setEqualizer(null); equalizerUI.reset();
  playlist.pause(); instruments.restore({ instruments: {}, patterns: [] });
  for (const item of channels.values()) item.head.remove();
  channels.clear();
  stemLoop.reset(); buffers = []; outputs = [];
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
  for (const view of waveforms) if (!$('original-waveform').contains(view.element)) view.dispose();
}
function showResults(result, saved = null) {
  disposeResults();
  mixOutput.setEqualizer(globalThis.SCParametricEQ.normalize(saved?.eq)); equalizerUI.reset();
  outputs = result.outputs;
  buffers = outputs.map(audioBuffer);
  rate = Number.isFinite(saved?.rate) ? Math.max(.1, Math.min(3, saved.rate)) : 1;
  keepTone = !!saved?.keepTone;
  renderTempo(); playlist.setRate(rate);
  wavs = [wavOf(original)];
  for (const output of outputs) wavs.push(new Blob([encodeWav(output)], { type: 'audio/wav' }));
  outputs = [];
  // Patterns first: the saved playlist holds their clips.
  instruments.restore(saved);
  startSession(saved); instruments.focus('drums');
  syncLoop();
  status(`${text('complete')} ${formatOneDecimal.format(result.seconds)} s.`);
}

function runWorker(channels) {
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL('./stem-worker.mjs', import.meta.url), { type: 'module' });
    rejectWorker = reject;
    const timeout = setTimeout(() => reject(localizedError('timeout')), 20 * 60 * 1000);
    const finish = (fn, value) => { clearTimeout(timeout); rejectWorker = null; fn(value); };
    rejectWorker = error => finish(reject, error);
    worker.onerror = () => finish(reject, localizedError('failed'));
    worker.onmessageerror = () => finish(reject, localizedError('failed'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'complete') return finish(resolve, data);
      if (data.type === 'error') return finish(reject, localizedError('failed'));
      if (data.type !== 'progress') return;
      if (data.phase === 'download' || data.phase === 'cache') {
        $('progress').value = data.received / data.total;
        status(`${text(data.phase === 'download' ? 'downloading' : 'cache')}: ${(data.received / 1e6).toFixed(0)} / 166 MB`);
      } else if (data.phase === 'run') {
        $('progress').value = data.completed / data.total;
        status(`${text('running')} ${Math.min(data.completed + 1, data.total)} / ${data.total}…`);
      } else if (data.phase === 'load' || data.phase === 'verify') {
        $('progress').removeAttribute('value'); status(text(data.phase));
      }
    };
    worker.postMessage({ type: 'separate', channels }, channels.map(channel => channel.buffer));
  });
}
async function separate() {
  if (busy || libraryOperating) return;
  if (buffers.length) libraryUI.newExtraction();
  const version = ++revision;
  setBusy(true); $('progress').removeAttribute('value');
  try {
    await navigator.locks.request('scdl-stem-inference', { ifAvailable: true }, async lock => {
      if (!lock) throw localizedError('another');
      if (!original) {
        status(text('preparing'));
        const result = await message('STEM_LOOP_RENDER');
        if (version !== revision) return;
        if (!/^data:audio\/[^;,]+;base64,/.test(result.instrument?.dataUrl || '')) throw localizedError('invalidAudio');
        const bytes = await (await fetch(result.instrument.dataUrl)).arrayBuffer();
        const decoder = new OfflineAudioContext(2, 1, SAMPLE_RATE);
        const decoded = await decoder.decodeAudioData(bytes);
        if (version !== revision) return;
        if (!decoded.length || decoded.duration > MAX_SECONDS + 1 / SAMPLE_RATE) throw localizedError('tooLong');
        original = audioBuffer([decoded.getChannelData(0), decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1))]);
        revealAudition();
        mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
        showOriginal();
      }
      if (version !== revision) return;
      const result = await runWorker([original.getChannelData(0).slice(), original.getChannelData(1).slice()]);
      if (version === revision) { showResults(result); await libraryUI.completed(); }
    });
  } catch (error) {
    if (version === revision) { console.error('[Stems]', error); status(error.localized ? error.message : text('failed'), true); }
  } finally {
    if (version === revision) { worker?.terminate(); worker = null; rejectWorker = null; setBusy(false); }
  }
}
async function cancel() {
  revision++;
  rejectWorker?.(new DOMException('Cancelled', 'AbortError')); rejectWorker = null;
  worker?.terminate(); worker = null;
  if (jobId && !info?.localFile) await message('STEM_LOOP_CANCEL').catch(() => {});
  setBusy(false); status(text('cancelled'));
}
$('separate').onclick = separate; $('cancel').onclick = cancel;
$('toggle-game').onclick = () => {
  const panel = $('game-panel');
  const open = panel.hidden;
  if (open) {
    const frame = document.createElement('iframe');
    frame.title = text('gameTitle');
    frame.src = 'https://tbot.xyz/lumber/';
    frame.width = '300'; frame.height = '450';
    panel.replaceChildren(frame);
  } else {
    panel.replaceChildren();
  }
  panel.hidden = !open;
  $('toggle-game').setAttribute('aria-expanded', String(open));
  const gameLabel = document.createElement('span'); gameLabel.dataset.copy = open ? 'hideGame' : 'playGame'; gameLabel.textContent = text(gameLabel.dataset.copy);
  $('toggle-game').replaceChildren(icon(open ? 'close' : 'game'), gameLabel); $('toggle-game').title = gameLabel.textContent;
};
$('clear-cache').onclick = async () => {
  try { await caches.delete(MODEL.cache); status(text('cleared')); } catch (error) { console.error('[Stems cache]', error); status(text('cacheClearFailed'), true); }
};
function togglePlayback() { playlist.toggle(); }
$('play').onclick = togglePlayback;
$('play').setAttribute('aria-keyshortcuts', 'Space');
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof Element && (target.isContentEditable || target.closest('input, textarea, select, a, [role="textbox"]') ||
      (target.closest('button') && target.closest('button').id !== 'play'))) return;
  event.preventDefault();
  // Space twice rewinds to the loop start and plays.
  if (!event.repeat) playlist.space();
});
let animationFrame;
function animate() {
  updatePlayheads();
  animationFrame = requestAnimationFrame(animate);
}
animate();
window.addEventListener('pagehide', () => {
  playlist.dispose();
  equalizerUI.dispose(); recorderUI.dispose(); mixOutput.dispose();
  cancelAnimationFrame(animationFrame);
  for (const view of waveforms) view.dispose();
  for (const item of Object.values(moduleWindows)) item.dispose();
  instruments.dispose(); channelRack.dispose(); pianoRoll.dispose();
  worker?.terminate(); toneNode?.port.postMessage({ type: 'dispose' }); context?.close(); urls.forEach(url => URL.revokeObjectURL(url));
  if (jobId) chrome.runtime.sendMessage({ type: 'STEM_LOOP_CANCEL', jobId }).catch(() => {});
});
function renderInfo(value) {
  info = value;
  title = info.title; $('track').textContent = title;
  const metadata = [info.artist];
  if (info.localFile) metadata.push(info.localFile.name, `${info.localFile.channels} ch`);
  if (Number.isFinite(info.durationMs) && info.durationMs > 0) {
    const seconds = Math.round(info.durationMs / 1000);
    metadata.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  }
  // Only the title and cover are visible; details stay in the tooltip.
  const track = $('track');
  track.dataset.meta = metadata.filter(Boolean).join(' · ');
  $('artwork').hidden = true; $('artwork-fallback').hidden = false; $('artwork').removeAttribute('src');
  if (typeof info.artworkUrl === 'string' && /^https:\/\//i.test(info.artworkUrl)) {
    const artwork = $('artwork');
    artwork.onload = () => { artwork.hidden = false; $('artwork-fallback').hidden = true; };
    artwork.onerror = () => { artwork.hidden = true; $('artwork-fallback').hidden = false; };
    artwork.src = info.artworkUrl;
  }
  track.dataset.range = `A ${formatTwoDecimals.format(info.trimRange.startMs / 1000)} s → B ${formatTwoDecimals.format(info.trimRange.endMs / 1000)} s · ${formatTwoDecimals.format((info.trimRange.endMs - info.trimRange.startMs) / 1000)} s`;
  track.title = [title, track.dataset.meta, track.dataset.range].filter(Boolean).join('\n');
}
try {
  if (jobId) { renderInfo(await message('STEM_LOOP_INFO')); initialized = true; }
  setBusy(false); status(jobId ? text('ready') : localCopy[10]);
} catch (error) { console.error('[Stems initialization]', error); status(error.localized ? error.message : text('infoFailed'), true); }
finally { importReady = true; setBusy(false); }
