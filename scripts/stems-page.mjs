import { createInstruments } from './stem-instruments.mjs';
import { mountChannelRack, PLUGIN_ICONS } from './stem-channel-rack.mjs';
import { mountPianoRoll } from './stem-piano.mjs';
import { createEqualizedOutput } from './local-audio-output.mjs';
import { createStemLoop } from './stem-loop.mjs';
import { SAMPLE_RATE, MAX_SECONDS, STEMS, encodeWav } from './stem-audio.mjs';
import { MODEL } from './stem-model.mjs';
import { mountStemLibrary } from './stem-library-ui.mjs';
import { CHANNEL_COLORS, contextMenu, mountPlaylist } from './stem-playlist.mjs';
import { createKnob } from './ui-knob.mjs';
import { createButton, setButtonContent } from './ui-button.mjs';
import { mountExtractDialog } from './stem-extract-dialog.mjs';
import { toast, dismissToast, configureToasts } from './ui-toast.mjs';
import { mountModuleWindow } from './stem-module-window.mjs';
import { mountEffects } from './stem-effects.mjs';
import { createChannelFx, normalizeTrackFx } from './stem-channel-fx.mjs';
import { spectrumOf } from './stem-spectrum.mjs';
import { mountOutputMonitor } from './stem-output-monitor.mjs';

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
    tooLong: 'The rendered loop exceeds 2 minutes.', clipTooLong: 'Trim the clip to 2 minutes or less to separate it.', cacheClearFailed: 'The cached model could not be removed.', playbackFailed: 'Audio playback could not start.', loop: 'Loop',
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
    tooLong: 'El loop procesado supera los 2 minutos.', clipTooLong: 'Recortá el clip a 2 minutos o menos para separarlo.', cacheClearFailed: 'No se pudo eliminar el modelo de la caché.', playbackFailed: 'No se pudo iniciar la reproducción.', loop: 'Loop',
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
document.querySelectorAll('[data-copy-title]').forEach(node => { node.dataset.scdlTooltip = text(node.dataset.copyTitle); node.setAttribute('aria-label', node.dataset.scdlTooltip); });
document.querySelectorAll('[data-copy-aria-label]').forEach(node => { node.setAttribute('aria-label', text(node.dataset.copyAriaLabel)); });
const icon = name => globalThis.SCIcons.create(name, "icon");
$('toggle-game').dataset.scdlTooltip = text('gameTip'); $('toggle-game').setAttribute('aria-label', text('playGame'));
$('transport').setAttribute('aria-label', text('transport'));
// Inside the shared buttons the icon takes the button's own size.
document.querySelectorAll('[data-icon]').forEach(node => {
  if (node.closest('.ui-btn')) node.replaceWith(globalThis.SCIcons.create(node.dataset.icon, 'ui-btn-icon'));
  else node.replaceChildren(icon(node.dataset.icon));
});
function playLabel(active) {
  const label = text(active ? 'stop' : 'play');
  setButtonContent($('play'), { icon: active ? 'pause' : 'play' });
  $('play').dataset.scdlTooltip = text(active ? 'pauseTip' : 'playTip'); $('play').setAttribute('aria-label', label);
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
  ['zoom-out', pt('Zoom out'), () => stemLoop.zoomAt(offset() * 1000, 1)],
  ['zoom-in', pt('Zoom in'), () => stemLoop.zoomAt(offset() * 1000, -1)],
  ['fit', pt('Show all audio'), () => stemLoop.resetZoom()],
]) {
  const button = document.createElement('button'); button.type = 'button'; button.append(icon(label));
  button.dataset.scdlTooltip = title; button.setAttribute('aria-label', title); button.onclick = action; zoomTools.append(button);
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
let busy = false, separating = false, revision = 0, worker, rejectWorker, title = text('loop'), initialized = false;
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
// Tool windows: orange buttons together in the transport bar.
const say = (en, es) => locale === 'es' ? es : en;
let moduleWindows = {}, eqTargetSelect = null, fxTargetSelect = null;
const WINDOWS = [
  { id: 'rack', icon: PLUGIN_ICONS.rack, name: say('Channel rack', 'Channel rack'), key: 'F6', keys: ['f6'], color: '#7bd88f',
    detail: say('the focused track cut into eight pads and its step patterns', 'la pista enfocada cortada en ocho pads y sus patrones de pasos') },
  { id: 'piano', icon: PLUGIN_ICONS.piano, name: say('Piano roll', 'Piano roll'), key: 'F7', keys: ['f7'], color: '#c792ea',
    detail: say('notes of the focused pattern', 'las notas del patrón enfocado') },
  { id: 'fx', icon: 'plugin', name: 'FXs', key: 'F4', keys: ['f4'], color: '#ff9955',
    detail: say('all six effects on each channel and the master', 'los seis efectos en cada canal y en el master') },
  { id: 'eq', icon: 'eq-window', name: say('Parametric EQ', 'EQ paramétrico'), key: 'F9', keys: ['f9'], color: '#4fc3f7',
    detail: say('equalizer of the selected channel, or of the master', 'ecualizador del canal seleccionado o del master') },
  { id: 'recorder', icon: 'recorder', name: say('Recorder', 'Grabadora'), key: 'F10', keys: ['f10'], color: '#ff4d6d',
    detail: say('records the final mix to a WAV', 'graba la mezcla final en un WAV') },
].map(item => ({ ...item, toggle: () => moduleWindows[item.id]?.toggle() }));
// "Extract stems" window: opened from a clip's right-click menu, and on arrival of a loop,
// a recording or an imported file.
const extractDialog = mountExtractDialog({ t: say, stemName: stem => text(stem),
  onExtract: options => separate(options), onCancel: () => cancel(), onClearModel: () => clearModel() });
setButtonContent($('clear-cache'), { icon: 'trash', label: text('clearCache') });
$('clear-cache').dataset.scdlTooltip = text('clearCacheTip'); $('clear-cache').setAttribute('aria-label', text('clearCache'));
$('separate').dataset.scdlTooltip = text('details');
// Tooltips on/off for the extension's pages (fast-tooltips.js); Player Tools has its own
// switch on SoundCloud. Ghost, beside the playlist help and the header pin.
const tooltipsToggle = createButton({ icon: 'info', title: pt('Toggle tooltips'), variant: 'ghost', className: 'tooltips-toggle', pressed: globalThis.SCTooltips?.isEnabled() ?? true,
  onClick: () => globalThis.SCTooltips?.setEnabled(!globalThis.SCTooltips.isEnabled()) });
const renderTooltipsToggle = () => tooltipsToggle.setAttribute('aria-pressed', String(globalThis.SCTooltips?.isEnabled() ?? true));
document.addEventListener('scdl:tooltips-changed', renderTooltipsToggle);
window.addEventListener('storage', renderTooltipsToggle);
const playlist = mountPlaylist({ container: $('playlist'), toolbarHost: $('transport'), playButton: false, windows: WINDOWS, windowHome: $('mix-tools'),
  inspectorHost: document.querySelector('.workspace-header'),
  // One line: play, tempo and speed, then the game, the windows and the export.
  toolbarStart: [$('play')], tempoControls: [document.querySelector('.stem-tempo')], toolbarEnd: [tooltipsToggle, $('header-pin'), $('toggle-game')],
  // Right-click > Extract stems… on any audio clip opens the extraction window.
  onSeparate: target => openExtract(target),
  onPatternAction(action, id) {
    if (action === 'fx') { selectFxChannel(id); moduleWindows.fx?.reveal(); return; }
    const pattern = id.slice('pattern:'.length); if (action === 'duplicate') instruments?.duplicatePattern(pattern); else instruments?.deletePattern(pattern);
  },
  audio: playlistAudio, channel: channelForTrack,
  // The master EQ is the last insert of the WAV export too.
  masterEq: () => mixOutput.snapshot().eq,
  masterFx: () => mixOutput.effectsSettings(),
  masterEffects: () => mixOutput.effects,
  onLoopChange(range) { stemLoop.setRange(range ? { startMs: range.start * 1000, endMs: range.end * 1000, durationMs: original?.duration * 1000 || range.end * 1000 } : null); },
  onChange() { reconcileChannels(); renderChannels(); instruments?.sync(); syncChannelEq(); syncChannelFx(); libraryUI?.changed(); },
  // Selecting a pattern clip opens that pattern, as double-clicking one does in FL Studio.
  onSelect(asset) { if (asset?.pattern) instruments?.focusPattern(asset.id.slice('pattern:'.length)); },
  onRackSample(key) { instruments.focus(key); channelRack.showChannels(); moduleWindows.rack?.reveal(); },
  onTransport(active) {
    if (active) instruments?.stop();
    toneNode?.port.postMessage({ rate, keepTone, reset: true }); playLabel(active); updatePlayheads();
    outputMonitor.setActive(active);
  } });
// Pin: the header stays at the top while scrolling, or scrolls away with the page.
const header = document.querySelector('.workspace-header'), pin = $('header-pin');
document.querySelector('.workspace-header .brand').dataset.scdlTooltip = text('workspace');
function setPinned(pinned) {
  header.dataset.pinned = String(pinned);
  pin.setAttribute('aria-pressed', String(pinned));
  setButtonContent(pin, { icon: pinned ? 'detach' : 'pin' });
  pin.dataset.scdlTooltip = pinned ? say('Header pinned to the top · click to let it scroll', 'Header fijo arriba · clic para que se desplace') : say('Pin the header to the top', 'Fijar el header arriba');
  pin.setAttribute('aria-label', say('Pin header', 'Fijar header'));
  try { localStorage.setItem('stems.headerPinned', pinned ? '1' : '0'); } catch {}
}
let storedPin = null;
try { storedPin = localStorage.getItem('stems.headerPinned'); } catch {}
setPinned(storedPin !== '0');
pin.onclick = () => setPinned(header.dataset.pinned !== 'true');
// Toasts drop in under the header while it is on screen.
configureToasts({ top: () => Math.max(0, header.getBoundingClientRect().bottom - 7), closeLabel: say('Close', 'Cerrar') });
const mixOutput =createEqualizedOutput({ audioContext: () => context ||= new AudioContext({ sampleRate: SAMPLE_RATE }) });
const outputMonitor = mountOutputMonitor({ element: $('output-monitor'), output: mixOutput, locale });
// Tracks are instruments: their own audio is what the channel rack cuts into pads.
const instrumentTracks = () => playlist.instrumentSources().map(track => ({ ...track,
  name: STEMS.includes(track.key) || track.key === 'original' ? text(track.key) : track.name }));
const instruments = createInstruments({ playlist, tracks: instrumentTracks, rate: () => rate, report: playbackError,
  changed: ({ auto = false } = {}) => { if (!auto) libraryUI?.changed(); },
  // A pattern preview plays through its track's insert, then Keep Tone and the master.
  async audio(key) { const io = key ? await playlist.trackAudio(key) : await playlistAudio(); outputMonitor.wake(); toneNode?.port.postMessage({ rate, keepTone, reset: true }); return io; } });
instruments.on(kind => { if (kind === 'transport') outputMonitor.setActive(playlist.playing() || instruments.playing()); });
// Pads and piano notes are auditions: they skip the playlist fader and Keep Tone, but go
// through their track's FX and EQ and then the master, like an FL Studio mixer insert.
const auditionBuses = new Map();
function auditionInput(key) {
  const context = mixOutput.getPlaybackContext();
  outputMonitor.wake();
  if (!key) return mixOutput.input();
  let bus = auditionBuses.get(key);
  if (!bus || bus.context !== context) {
    bus?.fx.dispose(); bus?.graph.dispose();
    const graph = globalThis.SCParametricEQ.createGraph(context, { analyse: true });
    graph.output.connect(mixOutput.input());
    const fx = createChannelFx({ context, output: graph.input, settings: playlist.trackFx(key) });
    bus = { context, graph, fx, settings: '' }; auditionBuses.set(key, bus);
  }
  applyAuditionEq(key, bus);
  bus.fx.apply(playlist.trackFx(key));
  return bus.fx.input;
}
function applyAuditionEq(key, bus = auditionBuses.get(key)) {
  if (!bus) return;
  const eq = playlist.trackEq(key), settings = JSON.stringify(eq);
  if (settings !== bus.settings) { bus.graph.apply(eq, false, !bus.settings); bus.settings = settings; }
}
const pluginAudio = { audioContext: () => mixOutput.getPlaybackContext(), output: auditionInput };
// The EQ window edits the master or one channel; one editor follows the selected target.
let eqTarget = 'master';
const eqChannel = () => eqTarget !== 'master' && playlist.track(eqTarget) ? eqTarget : null;
const eqEffects = {
  snapshot() {
    const key = eqChannel();
    return key ? { eq: globalThis.SCParametricEQ.normalize(playlist.trackEq(key)), initialized: true, available: true, bypassed: false } : mixOutput.snapshot();
  },
  setEqualizer(value) {
    const key = eqChannel();
    if (!key) { mixOutput.setEqualizer(value); return; }
    playlist.setTrackEq(key, globalThis.SCParametricEQ.validate(value)); applyAuditionEq(key);
  },
  // The spectrum of what is sounding: the song insert while playing, else the auditions.
  analyseEqualizer() {
    const key = eqChannel();
    if (!key) return mixOutput.analyseEqualizer();
    const song = playlist.trackGraph(key), audition = auditionBuses.get(key)?.graph || null;
    return playlist.playing() ? song || audition : audition || song;
  },
};
const channelRack = mountChannelRack({ container: $('mix-tools'), instruments, ...pluginAudio, locale, report: playbackError,
  importSamples: dataTransfer => playlist.importRackDrop(dataTransfer) });
const pianoRoll = mountPianoRoll({ container: $('mix-tools'), instruments, ...pluginAudio, report: playbackError });
let fxTarget = 'master';
const fxChannel = () => fxTarget !== 'master' && playlist.track(fxTarget) ? fxTarget : null;
const channelFxState = () => normalizeTrackFx(playlist.trackFx(fxChannel()));
function editChannelFx(change) {
  const value = channelFxState(); change(value); playlist.setTrackFx(fxChannel(), normalizeTrackFx(value));
}
const fxEffects = {
  snapshot: () => fxChannel() ? { ...channelFxState(), available: true, initialized: true } : mixOutput.effects.snapshot(),
  set(name, value) { if (!fxChannel()) return mixOutput.effects.set(name, value); editChannelFx(state => { state[name] = value; state.preset = 'custom'; }); },
  setCharacter(name, value) { if (!fxChannel()) return mixOutput.effects.setCharacter(name, value); editChannelFx(state => { state[name] = value; state.preset = 'custom'; }); },
  setBypassed(value) { if (!fxChannel()) return mixOutput.effects.setBypassed(value); editChannelFx(state => { state.bypassed = value; }); },
  applyPreset(name) { if (!fxChannel()) return mixOutput.effects.applyPreset(name); editChannelFx(state => Object.assign(state, globalThis.SCTempoEffects.PRESETS[name], { preset: name })); },
  reset() { if (!fxChannel()) return mixOutput.effects.reset(); playlist.setTrackFx(fxChannel(), normalizeTrackFx(null)); },
  isDelayFrozen() { const key = fxChannel(); return key ? !!(playlist.trackEffects(key)?.isDelayFrozen() || auditionBuses.get(key)?.fx.isDelayFrozen()) : mixOutput.effects.isDelayFrozen(); },
  setDelayFreeze(value) {
    const key = fxChannel(); if (!key) return mixOutput.effects.setDelayFreeze(value);
    const song = playlist.trackEffects(key)?.setDelayFreeze(value), audition = auditionBuses.get(key)?.fx.setDelayFreeze(value);
    return !!(song || audition);
  },
};
const effectsUI = mountEffects({ container: $('mix-tools'), effects: fxEffects, t: say,
  changed: () => libraryUI?.changed(), report: playbackError,
  onAutomationRequest(event, param, value) {
    const track = fxChannel() ? playlist.track(fxTarget).id : 'master';
    contextMenu(event, [{ label: say('Create automation clip', 'Crear clip de automatización'), icon: 'waveform',
      action: () => playlist.createAutomation({ track, param: `fx.${param}` }, { value, name: `${fxTargetSelect.selectedOptions[0].textContent} · ${param}` }) }]);
  },
  pauseForFreeze() {
    const song = playlist.playing(), pattern = instruments.playing();
    if (song) playlist.pause();
    if (pattern) instruments.stop();
    return () => { if (song && !playlist.playing()) playlist.toggle(); else if (pattern && !instruments.playing()) instruments.play().catch(playbackError); };
  },
});
const equalizerUI = globalThis.SCParametricEQUI.mount({
  container: $('mix-tools'), effects: eqEffects, isAllowed: () => true, authorize: async () => true,
  onChange: () => libraryUI?.changed(), pro: false,
});
const recorderUI = globalThis.SCRecordUI.mount({
  container: $('mix-tools'), effects: mixOutput,
  moduleUrl: new URL('./record-processor.js', import.meta.url).href,
});

fxTargetSelect = document.createElement('select');
{
  const row = document.createElement('label'); row.className = 'peq-target fx-target';
  const caption = document.createElement('span'); caption.textContent = say('Channel', 'Canal');
  fxTargetSelect.setAttribute('aria-label', say('FX channel', 'Canal de FX'));
  fxTargetSelect.onchange = () => selectFxChannel(fxTargetSelect.value);
  row.append(caption, fxTargetSelect); effectsUI.section.querySelector('.stem-plugin-body').prepend(row);
}
function renderFxTargets() {
  const options = [['master', 'Master'], ...playlist.tracks().filter(track => track.kind !== 'automation').map(track => [track.stem || track.id, channelName(track)])];
  const key = JSON.stringify(options);
  if (fxTargetSelect.dataset.key !== key) { fxTargetSelect.dataset.key = key; fxTargetSelect.replaceChildren(...options.map(([value, label]) => new Option(label, value))); }
  if (!fxChannel()) fxTarget = 'master';
  fxTargetSelect.value = fxTarget;
  effectsUI.section.querySelector('.tool-section-title').textContent = `FXs · ${fxTargetSelect.selectedOptions[0].textContent}`;
}
function selectFxChannel(key) {
  effectsUI.cancelFreeze(); fxTarget = key || 'master'; renderFxTargets(); effectsUI.reset();
}
function syncChannelFx() {
  if (!fxTargetSelect) return;
  renderFxTargets(); effectsUI.sync();
  for (const [key, bus] of auditionBuses) if (playlist.track(key)) bus.fx.apply(playlist.trackFx(key));
}
renderFxTargets();
equalizerUI.setCollapsed(false);
recorderUI.setCollapsed(false);
// Channel selector of the EQ window: Master, then every playlist channel.
eqTargetSelect = document.createElement('select');
{
  const row = document.createElement('label'); row.className = 'peq-target';
  const caption = document.createElement('span'); caption.textContent = say('Channel', 'Canal');
  eqTargetSelect.setAttribute('aria-label', say('EQ channel', 'Canal del EQ'));
  eqTargetSelect.dataset.scdlTooltip = say('Which channel this EQ edits: the master, or one track (its clips, patterns, pads and notes)', 'Qué canal edita este EQ: el master o una pista (sus clips, patrones, pads y notas)');
  eqTargetSelect.onchange = () => selectEqChannel(eqTargetSelect.value);
  row.append(caption, eqTargetSelect);
  $('scdl-parametric-eq').querySelector('.peq-body').prepend(row);
}
function channelName(track) { return track.stem ? text(track.stem) : track.name; }
function renderEqTargets() {
  const options = [['master', 'Master'], ...playlist.tracks().filter(track => track.kind !== 'automation').map(track => [track.stem || track.id, channelName(track)])];
  const key = options.map(option => option.join(':')).join('|');
  if (eqTargetSelect.dataset.key !== key) { eqTargetSelect.dataset.key = key; eqTargetSelect.replaceChildren(...options.map(([value, label]) => new Option(label, value))); }
  if (!eqChannel()) eqTarget = 'master';
  eqTargetSelect.value = eqTarget;
  const track = eqChannel() && playlist.track(eqTarget);
  $('scdl-parametric-eq').querySelector('.tool-section-title').textContent = track ? `${pt('Parametric EQ')} · ${channelName(track)}` : `${pt('Parametric EQ')} · Master`;
}
function selectEqChannel(key) { eqTarget = key || 'master'; renderEqTargets(); equalizerUI.reset(); }
// Track changes (undo, presets, new tracks) reach the selector, the editor and the auditions.
function syncChannelEq() {
  if (!eqTargetSelect) return;
  const before = eqTarget; renderEqTargets();
  if (before !== eqTarget) equalizerUI.reset(); else equalizerUI.sync();
  for (const [key, bus] of auditionBuses) {
    if (playlist.track(key)) applyAuditionEq(key, bus);
    else { bus.fx.dispose(); bus.graph.dispose(); auditionBuses.delete(key); }
  }
}
renderEqTargets();
channelRack.setCollapsed(false); pianoRoll.setCollapsed(false);
// Modules stay expanded, opened from their buttons or keys.
{
  const sections = { rack: $('stem-rack'), piano: $('stem-piano-roll'), fx: effectsUI.section, eq: $('scdl-parametric-eq'), recorder: $('scdl-record') };
  const sizes = { rack: { width: 940, height: 470, offset: 0 }, piano: { width: 940, height: 470, offset: 28 }, fx: { width: 880, height: 550, offset: 42 }, eq: { width: 680, height: 380, offset: 56 }, recorder: { width: 600, height: 300, offset: 84 } };
  const visibility = { fx: value => effectsUI.setVisible(value), eq: value => equalizerUI.setVisible(value), recorder: value => recorderUI.setVisible(value) };
  const shown = { rack: () => channelRack.open(), piano: () => pianoRoll.open() };
  for (const item of WINDOWS) {
    const section = sections[item.id];
    section.querySelector('.tool-section-icon')?.setAttribute('name', item.icon);
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
  es: ['Cargar audio del equipo', 'Elegí un archivo y un fragmento de hasta 2 minutos.', 'Cargar fragmento', 'Nombre', 'Inicio (s)', 'Fin (s)', 'Cancelar', 'Leyendo audio…', 'No se pudo leer el audio. Probá otro archivo o un formato compatible con Chrome.', 'Elegí un rango válido de hasta 2 minutos dentro del archivo.', 'Elegí un audio del equipo o un proyecto guardado.'],
  en: ['Load audio from computer', 'Choose a file and a segment up to 2 minutes.', 'Load segment', 'Name', 'Start (s)', 'End (s)', 'Cancel', 'Reading audio…', 'Could not read audio. Try another file or a format supported by Chrome.', 'Choose a valid range up to 2 minutes within the file.', 'Choose local audio or a saved project.'],
  de: ['Audio vom Computer laden', 'Datei und einen Ausschnitt von bis zu 2 Minuten auswählen.', 'Ausschnitt laden', 'Name', 'Start (s)', 'Ende (s)', 'Abbrechen', 'Audio wird gelesen…', 'Audio konnte nicht gelesen werden. Versuche eine andere Datei oder ein von Chrome unterstütztes Format.', 'Wähle einen gültigen Bereich von bis zu 2 Minuten innerhalb der Datei.', 'Wähle lokales Audio oder ein gespeichertes Projekt.'],
  'pt-BR': ['Carregar áudio do computador', 'Escolha um arquivo e um trecho de até 2 minutos.', 'Carregar trecho', 'Nome', 'Início (s)', 'Fim (s)', 'Cancelar', 'Lendo áudio…', 'Não foi possível ler o áudio. Tente outro arquivo ou formato compatível com o Chrome.', 'Escolha um intervalo válido de até 2 minutos dentro do arquivo.', 'Escolha um áudio local ou um projeto salvo.'],
  ru: ['Загрузить аудио с компьютера', 'Выберите файл и фрагмент до 2 минут.', 'Загрузить фрагмент', 'Название', 'Начало (с)', 'Конец (с)', 'Отмена', 'Чтение аудио…', 'Не удалось прочитать аудио. Попробуйте другой файл или формат, поддерживаемый Chrome.', 'Выберите допустимый фрагмент до 2 минут в пределах файла.', 'Выберите локальное аудио или сохранённый проект.'],
})[locale] || [];
for (const [id, index] of Object.entries({ 'import-title': 2, 'import-confirm': 2,
  'import-name-label': 3, 'import-start-label': 4, 'import-end-label': 5, 'import-cancel': 6, 'import-range-hint': 1 })) $(id).textContent = localCopy[index];
let importDraft = null;
$('import-audio').dataset.scdlTooltip = localCopy[0]; $('import-audio').setAttribute('aria-label', localCopy[0]);
$('import-audio').onclick = () => $('audio-file').click();
$('audio-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || busy || libraryOperating) return;
  setBusy(true); status(localCopy[7], 'loading');
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
    dismissToast('task');
  } catch (error) { console.error('[Stems import]', error); importDraft = null; setBusy(false); status(localCopy[8], 'error'); }
};
$('import-cancel').onclick = () => $('import-dialog').close();
$('import-dialog').addEventListener('close', () => { importDraft = null; setBusy(false); });
$('import-form').onsubmit = async event => {
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
  const value = { title: $('import-name').value.trim() || file.name, artist: '', artworkUrl: '', durationMs: decoded.duration * 1000,
    trimRange: { startMs: first / SAMPLE_RATE * 1000, endMs: last / SAMPLE_RATE * 1000 },
    localFile: { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, channels: decoded.numberOfChannels } };
  $('import-dialog').close();
  // New audio replaces the open project: unsaved changes are saved or discarded first.
  if (await libraryUI.confirmDiscard()) loadLocalAudio(audioBuffer(channels), value);
};
// Imported files and Likes Explorer recordings become the Original, ready to separate.
function loadLocalAudio(next, value) {
  disposeResults();
  for (const view of waveforms) view.dispose();
  original = next; wavs = []; rate = 1; keepTone = false; renderTempo(); playlist.setRate(rate);
  renderInfo(value);
  initialized = true; libraryUI.newExtraction();
  revealAudition();
  mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
  showOriginal(); libraryUI.markClean();
  openExtract(originalTarget());
}
const recordingId = jobId ? null : new URL(location.href).searchParams.get('recording');
// Loads the take without separating it; the user starts Separate.
async function loadRecording() {
  const result = await chrome.runtime.sendMessage({ type: 'STEM_RECORDING_INFO', recordingId });
  if (!result?.success) {
    const error = localizedError('infoFailed');
    if (typeof result?.error === 'string') error.message += ` ${result.error.slice(0, 300)}`;
    throw error;
  }
  status(text('preparing'), 'loading');
  const response = await (await caches.open('scdl-recording-jobs')).match(result.audioUrl);
  if (!response) throw localizedError('infoFailed');
  const decoded = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(await response.arrayBuffer());
  if (!decoded.length || decoded.duration > MAX_SECONDS + 1 / SAMPLE_RATE) throw localizedError('tooLong');
  const channels = [0, Math.min(1, decoded.numberOfChannels - 1)].map(channel => decoded.getChannelData(channel).slice());
  loadLocalAudio(audioBuffer(channels), { title: result.title || 'SoundCloud recording', artist: result.artist || '',
    artworkUrl: result.artworkUrl || '', durationMs: decoded.duration * 1000,
    trimRange: { startMs: 0, endMs: decoded.duration * 1000 }, recording: { trackUrl: result.trackUrl || '' } });
}
const settings = () => ({ ...instruments.snapshot(),
  states: STEMS.map(stem => { const track = playlist.track(stem); return { muted: !!track?.mute, solo: false, gain: track?.gain ?? 1 }; }),
  original: { muted: !!playlist.track('original')?.mute, gain: playlist.track('original')?.gain ?? 1, removed: removeOriginal },
  rate, keepTone, stems: [...stemChoice], eq: mixOutput.snapshot().eq, fx: mixOutput.effectsSettings(), playlist: playlist.snapshot() });
libraryUI = mountStemLibrary({ locale, report: status, canSave: () => !!info && !!original,
  onOperation(value) { libraryOperating = value; extractDialog.setReady(!value && !busy && canSeparate()); $('import-audio').disabled = value || busy || !importReady; },
  // Imported samples go with the separation; their WAV is encoded only when stored.
  // Before separation a project holds the original alone.
  snapshot: () => {
    const saved = settings(), deleted = new Set(saved.playlist.deletedSources || []);
    const blobs = wavs.length === 5 ? wavs : original ? [deleted.has('audio-original') ? null : sampleWav(original)] : null;
    return { info, settings: saved, blobs: blobs?.map((blob, index) => deleted.has(`audio-${index ? STEMS[index - 1] : 'original'}`) ? null : blob),
      samples: playlist.samples().map(sample => ({ id: sample.id, name: sample.name, blob: () => sampleWav(sample.buffer) })) };
  },
  restore: async ({ record, blobs, samples = {} }) => {
    // Decode/validate before replacing the current session. Missing/corrupt files
    // leave the current separation intact.
    const decoder = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const decoded = [];
    let frameCount = 0;
    for (const blob of blobs) {
      if (!blob) { decoded.push(null); continue; }
      const buffer = await decoder.decodeAudioData(await blob.arrayBuffer());
      if (buffer.numberOfChannels !== 2 || !buffer.length || buffer.duration > MAX_SECONDS + 1 / SAMPLE_RATE ||
          (frameCount && buffer.length !== frameCount)) throw new Error('Invalid preset WAV');
      for (let channel = 0; channel < 2; channel++) if (!buffer.getChannelData(channel).every(Number.isFinite)) throw new Error('Invalid PCM');
      decoded.push(buffer); frameCount = buffer.length;
    }
    // Deleted slots keep only a silent timing placeholder. Their tombstones prevent
    // a track, sample or download from being recreated, and no PCM is persisted.
    const seconds = Math.max(.01, Math.min(MAX_SECONDS, ((record.info?.trimRange?.endMs || 0) - (record.info?.trimRange?.startMs || 0)) / 1000));
    for (let i = 0; i < decoded.length; i++) if (!decoded[i]) decoded[i] = decoder.createBuffer(2, frameCount || Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    // Imported samples: one that cannot be decoded is skipped, with its clips.
    const names = new Map((record.settings?.playlist?.samples || []).map(item => [item?.id, item]));
    const restoredSamples = [];
    for (const [id, blob] of Object.entries(samples)) {
      try {
        const buffer = await decoder.decodeAudioData(await blob.arrayBuffer());
        if (buffer.duration <= MAX_SAMPLE_SECONDS && buffer.numberOfChannels <= 2) restoredSamples.push({ id, name: names.get(id)?.name || 'Sample', group: names.get(id)?.group, buffer });
      } catch (cause) { console.warn('[Stem presets] Skipped sample', id, cause); }
    }
    disposeResults();
    for (const view of waveforms) view.dispose();
    original = decoded[0];
    renderInfo(record.info);
    revealAudition();
    mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
    if (decoded.length > 1) {
      showResults({ outputs: decoded.slice(1).map(buffer => [buffer.getChannelData(0), buffer.getChannelData(1)]), seconds: 0 }, record.settings, restoredSamples);
      wavs = blobs;
    } else {
      // Saved before separation: the original and its settings; Extract stems still works.
      if (blobs[0]) sampleWavs.set(original, blobs[0]); wavs = [];
      applySettings(record.settings);
      instruments.restore(record.settings); startSession(record.settings, restoredSamples); instruments.focus('original'); syncLoop();
    }
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
$('stem-rate').dataset.scdlTooltip = $('stem-rate-value').dataset.scdlTooltip = pt('Playback speed of the whole session (0.1×–3×). Unlike BPM, it changes how fast the audio plays. Double-click to reset to 1×.');
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
// The playlist plays into the shared context: Keep Tone, FXs, EQ and recorder.
async function playlistAudio() {
  const playback = mixOutput.getPlaybackContext();
  await playback.resume();
  try { await prepareTone(); return { context: playback, output: toneNode }; }
  catch (error) { console.error('[Stems tone]', error); return { context: playback, output: mixOutput.input() }; }
}

// Messages are toasts (ui-toast.mjs). A running task (reading, preparing, separating, saving)
// has one loading toast that updates in place; its result replaces it. `variant` is
// 'success', 'error', 'warning', 'info' or 'loading'.
function status(message, variant = 'info') {
  if (variant === 'loading') { toast({ id: 'task', variant, title: message }); return; }
  dismissToast('task');
  if (message) toast({ title: message, variant });
}
function localizedError(key) { const error = new Error(text(key)); error.localized = true; return error; }
function playbackError(error) { console.error('[Stems playback]', error); status(text('playbackFailed'), 'error'); }
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
  extractDialog.setReady(!value && !libraryOperating && canSeparate());
  extractDialog.setRunning(value && separating);
  // The library row's spinner says work is running; its title names the step.
  playlist.setTask(value ? say('Working…', 'Trabajando…') : '');
  libraryUI?.setBusy(value);
  // A task that ends without a result message also ends its loading toast.
  if (!value) dismissToast('task');
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
  enable.dataset.scdlTooltip = pt('Enable/disable $1 · Right-click: hear only this track', name);
  enable.onclick = () => editChannel(stem, track => { track.mute = !track.mute; });
  const hearOnly = () => playlist.edit(state => { for (const track of state.tracks) { track.mute = (track.stem || track.id) !== stem; track.solo = false; } });
  enable.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); hearOnly(); };
  const volume = createKnob({ label: `${text('volume')} ${name}`, min: 0, max: 200, step: 1, coarse: 10, value: 100, reset: 100,
    size: 'sm', inline: true, hint: text('resetVolume'), format: value => `${value}%`,
    onInput: value => editChannel(stem, track => { track.gain = value / 100; }, { live: true }),
    onCommit: value => editChannel(stem, track => { track.gain = value / 100; }) });
  volume.wrap.classList.add('stem-volume');
  volume.dial.addEventListener('contextmenu', event => {
    event.preventDefault(); event.stopPropagation();
    contextMenu(event, [{ label: say('Create automation clip', 'Crear clip de automatización'), icon: 'waveform',
      action: () => playlist.createAutomation({ track: playlist.track(stem).id, param: 'gain' }, { value: playlist.track(stem).gain, name: `${name} · ${text('volume')}` }) }]);
  });
  const link = document.createElement('a'); link.className = 'download';
  const url = wav ? URL.createObjectURL(wav) : ''; if (url) urls.push(url);
  link.href = url; link.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)}_${stem}.wav`;
  // FL's channel options: focus this track in the channel rack or the piano roll, or save its WAV.
  const editorHint = wav ? '' : pt('Add a sample to this track to use its editors.');
  const menu = event => contextMenu(event, [
    { label: pt('Channel rack'), icon: PLUGIN_ICONS.rack, disabled: !wav, title: editorHint, action: () => { instruments.focus(stem); moduleWindows.rack.reveal(); channelRack.open(); } },
    { label: pt('Piano roll'), icon: PLUGIN_ICONS.piano, disabled: !wav, title: editorHint, action: () => { instruments.focus(stem); moduleWindows.piano.reveal(); pianoRoll.open(); } },
    { label: say('Channel EQ', 'EQ del canal'), icon: 'eq-window', action: () => { selectEqChannel(stem); moduleWindows.eq.reveal(); } },
    { label: say('Channel FX', 'FX del canal'), icon: 'plugin', action: () => { selectFxChannel(stem); moduleWindows.fx.reveal(); } },
    { label: pt('Download WAV'), icon: 'download', disabled: !wav, action: () => link.click() },
    '-',
    { label: pt('Hear only this track'), icon: 'music', action: hearOnly },
    { label: say('Consolidate channel…', 'Consolidar canal…'), icon: 'export', action: () => playlist.consolidateTrack(stem) },
    { label: say('Delete channel…', 'Eliminar canal…'), icon: 'trash', danger: true, action: () => playlist.deleteTrack(stem) },
  ]);
  const more = document.createElement('button'); more.type = 'button'; more.className = 'stem-more';
  more.innerHTML = '<sc-icon name="more" class="icon" aria-hidden="true"></sc-icon>';
  more.dataset.scdlTooltip = pt('Track options: $1 · or right-click the track', name); more.setAttribute('aria-label', more.dataset.scdlTooltip); more.setAttribute('aria-haspopup', 'menu');
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
// Stems chosen in the extraction window. The separation keeps all four WAVs; the others
// just get no track. `muteOriginal` is the window's "when done" choice.
let stemChoice = [...STEMS], muteOriginal = true, removeOriginal = false;
function startSession(saved = null, samples = []) {
  if (saved) removeOriginal = saved.original?.removed === true;
  if (saved) stemChoice = Array.isArray(saved.stems) && saved.stems.some(stem => STEMS.includes(stem)) ? STEMS.filter(stem => saved.stems.includes(stem)) : [...STEMS];
  const sources = [original, ...buffers].map((buffer, index) => {
    const stem = index ? STEMS[index - 1] : 'original';
    // With stems, the original starts muted so the mix is not doubled.
    const mute = index ? false : saved?.original ? saved.original.muted === true : buffers.length > 0 && muteOriginal;
    return { id: `audio-${stem}`, stem, name: index ? text(stem) : text('original'), buffer, mute };
  }).filter(source => !saved?.playlist?.deletedSources?.includes(source.id) && (source.stem === 'original' ? !removeOriginal : stemChoice.includes(source.stem)));
  // The stem mix lives in `states` (as before the playlist); the arrangement adds clips.
  const tracks = saved?.states && [...STEMS.map((stem, i) => ({ stem, gain: saved.states[i]?.gain, mute: saved.states[i]?.muted === true })),
    ...(saved.original ? [{ stem: 'original', gain: saved.original.gain, mute: saved.original.muted === true }] : [])];
  playlist.setSession({ sources, saved: saved && { ...saved.playlist, tracks }, samples });
  $('original-waveform').hidden = true; zoomTools.hidden = true;
  renderChannels();
}
// Imported samples are stored once per buffer; the playlist limits them to five minutes.
const MAX_SAMPLE_SECONDS = 5 * 60 + .01, sampleWavs = new WeakMap();
const sampleWav = buffer => { if (!sampleWavs.has(buffer)) sampleWavs.set(buffer, wavOf(buffer)); return sampleWavs.get(buffer); };
const wavOf = buffer => new Blob([encodeWav([buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))], buffer.sampleRate)], { type: 'audio/wav' });
// Before separation the playlist holds the source audio alone.
function showOriginal() {
  wavs = []; removeOriginal = false;
  startSession(); syncLoop();
}
function disposeResults() {
  effectsUI.cancelFreeze(); mixOutput.restoreEffects(null); effectsUI.reset();
  mixOutput.setEqualizer(null); equalizerUI.reset();
  playlist.pause(); instruments.restore({ instruments: {}, patterns: [] });
  for (const item of channels.values()) item.head.remove();
  channels.clear();
  stemLoop.reset(); buffers = []; outputs = [];
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
  for (const view of waveforms) if (!$('original-waveform').contains(view.element)) view.dispose();
}
// Master FXs, EQ, speed and Keep Tone of a saved project (defaults without one).
function applySettings(saved) {
  mixOutput.restoreEffects(saved?.fx); effectsUI.reset();
  mixOutput.setEqualizer(globalThis.SCParametricEQ.normalize(saved?.eq)); equalizerUI.reset();
  rate = Number.isFinite(saved?.rate) ? Math.max(.1, Math.min(3, saved.rate)) : 1;
  keepTone = !!saved?.keepTone;
  renderTempo(); playlist.setRate(rate);
}
function showResults(result, saved = null, samples = []) {
  disposeResults();
  applySettings(saved);
  outputs = result.outputs;
  buffers = outputs.map(audioBuffer);
  wavs = [wavOf(original)];
  for (const output of outputs) wavs.push(new Blob([encodeWav(output)], { type: 'audio/wav' }));
  outputs = [];
  // Patterns first: the saved playlist holds their clips.
  instruments.restore(saved);
  startSession(saved, samples); instruments.focus(stemChoice[0]);
  syncLoop();
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
        progress(data.received / data.total, `${text(data.phase === 'download' ? 'downloading' : 'cache')}: ${(data.received / 1e6).toFixed(0)} / 166 MB`);
      } else if (data.phase === 'run') {
        progress(data.completed / data.total, `${text('running')} ${Math.min(data.completed + 1, data.total)} / ${data.total}…`);
      } else if (data.phase === 'load' || data.phase === 'verify') {
        progress(null, text(data.phase));
      }
    };
    worker.postMessage({ type: 'separate', channels }, channels.map(channel => channel.buffer));
  });
}
// Separation progress shows in a loading toast, the library spinner's title and the
// extraction window's status line.
function progress(value, message) {
  if (busy) playlist.setTask(message);
  toast({ id: 'task', variant: 'loading', title: message, progress: value }); extractDialog.setProgress(value, message);
}
// What the extraction window separates: the session's original (its stems get the four
// stem tracks) or any other audio clip (its stems become new tracks next to it).
let extractTarget = null;
function originalTarget() { return { original: true, name: title }; }
function openExtract(target) {
  if (!target) return;
  if (separating || libraryOperating) {
    if (separating) extractDialog.open({ name: extractTarget.name, isOriginal: !!extractTarget.original });
    return;
  }
  const isOriginal = !!target.original || (target.session && target.stem === 'original');
  extractTarget = isOriginal ? originalTarget() : target;
  extractDialog.open({ name: extractTarget.name, isOriginal });
  extractDialog.setReady(!busy && !libraryOperating && canSeparate());
}
// The audio a clip plays (source seconds `from`–`to`) as two channels at the model's rate.
async function clipChannels(target) {
  const seconds = target.to - target.from, buffer = target.buffer;
  if (!(seconds > 0) || seconds > MAX_SECONDS + 1e-3) throw localizedError('clipTooLong');
  const frames = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  if (buffer.sampleRate === SAMPLE_RATE) {
    const first = Math.round(target.from * SAMPLE_RATE);
    return [0, 1].map(channel => buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)).slice(first, first + frames));
  }
  const offline = new OfflineAudioContext(2, frames, SAMPLE_RATE), node = offline.createBufferSource();
  node.buffer = buffer; node.connect(offline.destination); node.start(0, target.from, seconds);
  const rendered = await offline.startRendering();
  return [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
}
// `options` come from the window: { stems, when: 'mute' | 'delete' | 'none', group }.
async function separate(options) {
  const target = extractTarget;
  if (busy || libraryOperating || !target || !canSeparate() || !options.stems.length) return;
  const version = ++revision;
  separating = true; setBusy(true); progress(null, text('load'));
  try {
    await navigator.locks.request('scdl-stem-inference', { ifAvailable: true }, async lock => {
      if (!lock) throw localizedError('another');
      if (target.original && !original) { progress(null, text('preparing')); await renderJobLoop(); }
      if (version !== revision) return;
      const result = await runWorker(target.original ? [original.getChannelData(0).slice(), original.getChannelData(1).slice()] : await clipChannels(target));
      if (version !== revision) return;
      if (target.original) {
        stemChoice = STEMS.filter(stem => options.stems.includes(stem)); muteOriginal = options.when === 'mute';
        removeOriginal = options.when === 'delete';
        showResults(result); extractDialog.close();
        status(`${text('complete')} ${formatOneDecimal.format(result.seconds)} s.`, 'success');
        return;
      }
      const stems = STEMS.map((stem, index) => ({ stem, output: result.outputs[index] })).filter(item => options.stems.includes(item.stem))
        .map(({ stem, output }) => {
          const name = `${text(stem)} · ${target.name}`;
          return { name, track: name, color: CHANNEL_COLORS[stem], buffer: audioBuffer(output) };
        });
      try { if (!playlist.addStemTracks({ clip: target.id, sample: target.library ? target.asset : null, track: target.track, at: target.at,
        stems, group: options.group, muteSource: options.when === 'mute', removeSource: options.when === 'delete' })) throw new Error(say('The stems could not fit in the playlist.', 'Los stems no entran en la playlist.')); }
      catch (error) { error.localized = true; throw error; }
      extractDialog.close();
      status(`${text('complete')} ${formatOneDecimal.format(result.seconds)} s.`, 'success');
    });
  } catch (error) {
    if (version === revision) {
      console.error('[Stems]', error);
      const message = error.localized ? error.message : text('failed');
      status(message, 'error'); extractDialog.setMessage(message);
    }
  } finally {
    if (version === revision) { worker?.terminate(); worker = null; rejectWorker = null; separating = false; setBusy(false); }
  }
}
async function cancel() {
  revision++;
  rejectWorker?.(new DOMException('Cancelled', 'AbortError')); rejectWorker = null;
  worker?.terminate(); worker = null;
  separating = false; setBusy(false); status(text('cancelled'), 'info'); extractDialog.setMessage(text('cancelled'));
}
// A loop sent from Player Tools: its audio is rendered on arrival and placed as the
// Original, then the extraction window opens. If that fails, the window still opens with
// the reason, and Separate retries the render first.
async function loadJobLoop() {
  setBusy(true); progress(null, text('preparing'));
  let reason = '';
  try { await renderJobLoop(); libraryUI.markClean(); }
  catch (error) {
    console.error('[Stems loop]', error);
    reason = error.localized ? error.message : text('prepareFailed');
    setBusy(false); status(reason, 'error');
  } finally { setBusy(false); }
  openExtract(originalTarget());
  if (reason) extractDialog.setMessage(reason);
}
async function renderJobLoop() {
  {
    const result = await message('STEM_LOOP_RENDER');
    if (!/^data:audio\/[^;,]+;base64,/.test(result.instrument?.dataUrl || '')) throw localizedError('invalidAudio');
    const bytes = await (await fetch(result.instrument.dataUrl)).arrayBuffer();
    const decoded = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes);
    if (!decoded.length || decoded.duration > MAX_SECONDS + 1 / SAMPLE_RATE) throw localizedError('tooLong');
    original = audioBuffer([decoded.getChannelData(0), decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1))]);
    revealAudition();
    mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
    showOriginal();
  }
}
// There is something to separate: audio in the session, or a loop still to render.
const canSeparate = () => !!extractTarget?.buffer || !!original || (!!jobId && !info?.localFile);
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
  setButtonContent($('toggle-game'), { icon: open ? 'close' : 'game' });
  $('toggle-game').dataset.scdlTooltip = open ? text('hideGame') : text('gameTip');
  $('toggle-game').setAttribute('aria-label', text(open ? 'hideGame' : 'playGame'));
};
async function clearModel() {
  try { await caches.delete(MODEL.cache); status(text('cleared'), 'success'); extractDialog.setMessage(text('cleared')); }
  catch (error) { console.error('[Stems cache]', error); status(text('cacheClearFailed'), 'error'); extractDialog.setMessage(text('cacheClearFailed')); }
}
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
  outputMonitor.dispose();
  playlist.dispose();
  effectsUI.dispose(); equalizerUI.dispose(); recorderUI.dispose(); mixOutput.dispose();
  for (const bus of auditionBuses.values()) { bus.fx.dispose(); bus.graph.dispose(); }
  auditionBuses.clear();
  cancelAnimationFrame(animationFrame);
  for (const view of waveforms) view.dispose();
  for (const item of Object.values(moduleWindows)) item.dispose();
  instruments.dispose(); channelRack.dispose(); pianoRoll.dispose();
  worker?.terminate(); toneNode?.port.postMessage({ type: 'dispose' }); context?.close(); urls.forEach(url => URL.revokeObjectURL(url));
  if (jobId) chrome.runtime.sendMessage({ type: 'STEM_LOOP_CANCEL', jobId }).catch(() => {});
});
function renderInfo(value) {
  info = value;
  title = info.title; libraryUI?.setProjectName(title);
  const metadata = [info.artist];
  if (info.localFile) metadata.push(info.localFile.name, `${info.localFile.channels} ch`);
  if (info.recording) metadata.push(pt('Likes Explorer recording'));
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
  track.dataset.scdlTooltip = [title, track.dataset.meta, track.dataset.range].filter(Boolean).join('\n');
}
try {
  if (jobId) { renderInfo(await message('STEM_LOOP_INFO')); initialized = true; await loadJobLoop(); }
  else if (recordingId) await loadRecording();
  setBusy(false);
  // An empty page says where audio comes from; a loop or recording opens the extraction window.
  if (!jobId && !recordingId) status(localCopy[10], 'info');
} catch (error) { console.error('[Stems initialization]', error); status(error.localized ? error.message : text('infoFailed'), 'error'); }
finally { importReady = true; setBusy(false); }
