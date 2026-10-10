import { mountDrumSampler } from './stem-sampler.mjs';
import { mountDrumSequencer } from './stem-sequencer.mjs';
import { createEqualizedOutput } from './local-audio-output.mjs';
import { createStemLoop } from './stem-loop.mjs';
import { SAMPLE_RATE, MAX_SECONDS, STEMS, encodeWav } from './stem-audio.mjs';
import { MODEL } from './stem-model.mjs';
import { mountStemLibrary } from './stem-library-ui.mjs';

const translations = {
  en: {
    pageTitle: 'Stem Extractor · Player Tools', workspace: 'Separate. Mix. Make it yours.', experimental: 'Experimental', selected: 'SELECTED LOOP',
    separationLabel: 'Separation', extract: 'Unpack your sound.', local: 'On-device',
    intro: 'Separate vocals, drums, bass and other instruments locally. Your audio stays in Chrome.',
    details: 'First use downloads a 166 MB model. Processing can take a few minutes and uses substantial memory. Up to 2 minutes, at original speed without effects.',
    separate: 'Separate loop', cancel: 'Cancel', clearCache: 'Remove model', playGame: 'Play Lumberjack game', hideGame: 'Close Lumberjack game', gameTitle: 'Lumberjack game',
    listenCompareLabel: 'Listen and compare', listen: 'Find your mix.', play: 'Play', stop: 'Pause', comparisonLabel: 'Compare', original: 'Original', mix: 'Stem mix',
    lows: 'Lows', mids: 'Mids', highs: 'Highs', position: 'Position',
    quality: 'Some bleed and artifacts are normal. Compare with the original. Stems: stereo 44.1 kHz float WAV. Recorder: stereo 48 kHz PCM16 WAV.',
    footer: 'Audio stays on this device. Keep this tab open to retain your results.',
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
    listenCompareLabel: 'Escuchar y comparar', listen: 'Encontrá tu mezcla.', play: 'Reproducir', stop: 'Pausar', comparisonLabel: 'Comparar', original: 'Original', mix: 'Mezcla de stems',
    lows: 'Graves', mids: 'Medios', highs: 'Agudos', position: 'Posición',
    quality: 'Puede haber filtraciones y artefactos. Compará con el original. Stems: WAV estéreo de 44,1 kHz en coma flotante. Recorder: WAV estéreo de 48 kHz PCM16.',
    footer: 'El audio permanece en este equipo. Mantené esta pestaña abierta para conservar los resultados.',
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
    listenCompareLabel: 'Anhören und vergleichen', listen: 'Finde deinen Mix.', play: 'Abspielen', stop: 'Pausieren', comparisonLabel: 'Vergleichen', original: 'Original', mix: 'Stem-Mix',
    lows: 'Bässe', mids: 'Mitten', highs: 'Höhen', position: 'Position',
    quality: 'Übersprechen und Artefakte sind normal. Vergleiche das Ergebnis mit dem Original. Stems: Stereo-WAV mit 44,1 kHz und Fließkommawerten. Recorder: Stereo-WAV mit 48 kHz PCM16.',
    footer: 'Das Audio bleibt auf diesem Gerät. Lass diesen Tab geöffnet, um deine Ergebnisse zu behalten.',
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
    listenCompareLabel: 'Ouvir e comparar', listen: 'Encontre sua mixagem.', play: 'Reproduzir', stop: 'Pausar', comparisonLabel: 'Comparar', original: 'Original', mix: 'Mixagem de stems',
    lows: 'Graves', mids: 'Médios', highs: 'Agudos', position: 'Posição',
    quality: 'Algum vazamento e alguns artefatos são normais. Compare com o original. Stems: WAV estéreo de 44,1 kHz em ponto flutuante. Recorder: WAV estéreo de 48 kHz PCM16.',
    footer: 'O áudio permanece neste dispositivo. Mantenha esta aba aberta para preservar os resultados.',
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
    listenCompareLabel: 'Прослушать и сравнить', listen: 'Создайте свой микс.', play: 'Воспроизвести', stop: 'Пауза', comparisonLabel: 'Сравнить', original: 'Оригинал', mix: 'Микс стемов',
    lows: 'Низкие', mids: 'Средние', highs: 'Высокие', position: 'Позиция',
    quality: 'Небольшое проникновение звука и артефакты — это нормально. Сравните с оригиналом. Стемы: стерео WAV 44,1 кГц с плавающей точкой. Recorder: стерео WAV 48 кГц PCM16.',
    footer: 'Аудио остается на этом устройстве. Не закрывайте вкладку, чтобы сохранить результаты.',
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
$('toggle-game').title = text('playGame');
document.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon)));
function playLabel(active) {
  const label = text(active ? 'stop' : 'play');
  $('play').replaceChildren(icon(active ? 'pause' : 'play'));
  $('play').title = label; $('play').setAttribute('aria-label', label);
}
const padStyle = document.createElement('style');
padStyle.textContent = globalThis.SCSamplerCore.PAD_STYLES;
document.head.append(padStyle);
const waveforms = new Set();
let drumSampler = null, drumSequencer = null, sequenceRevision = 0;
const retiringNodes = new Set();
const stemLoop = createStemLoop({ viewportChanged() {
  for (const view of waveforms) view.draw();
  updatePlayheads(); drumSampler?.render(); drumSequencer?.renderMarker();
}, duration: () => original?.duration || 0, changed(previous) {
  const current = offset(previous);
  const { startMs, endMs } = stemLoop.range();
  for (const { source, pattern } of nodes) if (!pattern) { source.loopStart = startMs / 1000; source.loopEnd = endMs / 1000; }
  position = current;
  if (playing) startedAt = Math.max(startedAt, context.currentTime);
  if ((current < startMs / 1000 || current >= endMs / 1000)) seekTo(startMs / 1000);
  if (drumSequencer?.enabled() && !drumSequencer.matchesRange(stemLoop.range())) drumSequencer.deactivate();
} });
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
function seekTo(value) {
  const resume = playing; pause(); position = Math.max(0, Math.min(original.duration, value));
  updatePlayheads();
  if (resume) play().catch(playbackError);
}
function updatePlayheads() {
  if (!original) return;
  drumSequencer?.updateTransport(offset(), playing, rate);
  const percent = stemLoop.percent(Math.max(0, offset()) * 1000);
  for (const view of waveforms) {
    view.playhead.style.left = `${percent}%`;
    view.playhead.hidden = percent < 0 || percent > 100;
    view.element.setAttribute('aria-valuenow', offset().toFixed(1));
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
  const disposeLoop = stemLoop.mount(element, seekTo, seconds => parent.dataset.stem === 'drums' &&
    (drumSequencer?.place(seconds) || drumSampler?.place(seconds)));
  const controller = new AbortController();
  const view = { element, playhead, draw: () => drawWaveform(), dispose() { disposeLoop(); controller.abort(); observer.disconnect(); waveforms.delete(view); element.remove(); } };
  waveforms.add(view);
  const ui = { waveformCanvas: canvas, panel: $('audition') };
  const waveformCollapsed = false, waveformSamples = [], waveformDrawPreview = null;
  let waveformSpectrum, waveformStaticKey = '', waveformRevision = 0;
  const loopState = { durationMs: buffer.duration * 1000 };
  const visibleWaveformWindow = () => stemLoop.viewport();
  const loopPercentInWindow = (time, range) => (time - range.startMs) / (range.endMs - range.startMs) * 100;
  // Copied from tempo-control-main.js: same physical-pixel peak aggregation,
  // RGB energy mapping as the Player Tools looper. Use a fixed amplitude
  // scale so quiet separation residuals stay quiet-looking across stems.
  function drawWaveform() {
    if (!ui?.waveformCanvas || waveformCollapsed || ui.panel.hidden || document.hidden) return;
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
  globalThis.SCSpectralWaveform.analyze(buffer, controller.signal).then(spectrum => {
    if (controller.signal.aborted) return;
    waveformSpectrum = spectrum; waveformRevision++; drawWaveform(); updatePlayheads();
  }).catch(error => { if (error.name !== 'AbortError') console.error('[Stems waveform]', error); });
  return view;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) for (const view of waveforms) view.draw();
});
const jobId = new URL(location.href).searchParams.get('job');
let original, buffers = [], context, nodes = [], outputs = [], urls = [];
let mode = 'original', playing = false, position = 0, startedAt = 0;
let busy = false, revision = 0, worker, rejectWorker, title = text('loop'), initialized = false;
let states = STEMS.map(() => ({ muted: false, solo: false, gain: 1 }));
let info = null, wavs = [], rate = 1, keepTone = false, toneNode, toneReady, playbackRevision = 0, toneLatency = 0, libraryOperating = false;
let libraryUI, importReady = false;
const mixOutput = createEqualizedOutput({ audioContext: () => context ||= new AudioContext({ sampleRate: SAMPLE_RATE }) });
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
function revealAudition() {
  $('audition').hidden = false; $('listen-controls').hidden = false;
  // With results, the source row also holds the transport: keep it to one line.
  document.querySelector('.prepare').classList.add('has-results');
  equalizerUI.setVisible(true);
  recorderUI.setVisible(true);
}
const localCopy = ({
  es: ['Cargar audio del equipo', 'Elegí un archivo y un fragmento de hasta 2 minutos.', 'Cargar fragmento', 'Nombre', 'Inicio (s)', 'Fin (s)', 'Cancelar', 'Leyendo audio…', 'No se pudo leer el audio. Probá otro archivo o un formato compatible con Chrome.', 'Elegí un rango válido de hasta 2 minutos dentro del archivo.', 'Elegí un audio del equipo o una separación guardada.'],
  en: ['Load audio from computer', 'Choose a file and a segment up to 2 minutes.', 'Load segment', 'Name', 'Start (s)', 'End (s)', 'Cancel', 'Reading audio…', 'Could not read audio. Try another file or a format supported by Chrome.', 'Choose a valid range up to 2 minutes within the file.', 'Choose local audio or a saved separation.'],
  de: ['Audio vom Computer laden', 'Datei und einen Ausschnitt von bis zu 2 Minuten auswählen.', 'Ausschnitt laden', 'Name', 'Start (s)', 'Ende (s)', 'Abbrechen', 'Audio wird gelesen…', 'Audio konnte nicht gelesen werden. Versuche eine andere Datei oder ein von Chrome unterstütztes Format.', 'Wähle einen gültigen Bereich von bis zu 2 Minuten innerhalb der Datei.', 'Wähle lokales Audio oder eine gespeicherte Trennung.'],
  'pt-BR': ['Carregar áudio do computador', 'Escolha um arquivo e um trecho de até 2 minutos.', 'Carregar trecho', 'Nome', 'Início (s)', 'Fim (s)', 'Cancelar', 'Lendo áudio…', 'Não foi possível ler o áudio. Tente outro arquivo ou formato compatível com o Chrome.', 'Escolha um intervalo válido de até 2 minutos dentro do arquivo.', 'Escolha um áudio local ou uma separação salva.'],
  ru: ['Загрузить аудио с компьютера', 'Выберите файл и фрагмент до 2 минут.', 'Загрузить фрагмент', 'Название', 'Начало (с)', 'Конец (с)', 'Отмена', 'Чтение аудио…', 'Не удалось прочитать аудио. Попробуйте другой файл или формат, поддерживаемый Chrome.', 'Выберите допустимый фрагмент до 2 минут в пределах файла.', 'Выберите локальное аудио или сохранённое разделение.'],
})[locale] || [];
for (const [id, index] of Object.entries({ 'import-audio-label': 0, 'import-hint': 1, 'import-title': 2, 'import-confirm': 2,
  'import-name-label': 3, 'import-start-label': 4, 'import-end-label': 5, 'import-cancel': 6, 'import-range-hint': 1 })) $(id).textContent = localCopy[index];
let importDraft = null;
$('import-hint').textContent += ' · ≤256 MiB';
$('import-audio').onclick = () => $('audio-file').click();
$('audio-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || busy || libraryOperating) return;
  setBusy(true, false); $('cancel').hidden = true; status(localCopy[7]);
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
  original = next; wavs = []; position = 0; rate = 1; keepTone = false; renderTempo();
  renderInfo({ title: $('import-name').value.trim() || file.name, artist: '', artworkUrl: '', durationMs: decoded.duration * 1000,
    trimRange: { startMs: first / SAMPLE_RATE * 1000, endMs: last / SAMPLE_RATE * 1000 },
    localFile: { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, channels: decoded.numberOfChannels } });
  initialized = true; libraryUI.newExtraction();
  revealAudition();
  mountWaveform($('original-waveform'), original, `${text('original')} · ${text('position')}`);
  $('import-dialog').close(); status(text('ready'));
};
const settings = () => ({ drumSlices: drumSampler?.snapshot(), drumSequence: drumSequencer?.snapshot(), states: structuredClone(states), rate, keepTone, mode, eq: mixOutput.snapshot().eq });
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
  const current = offset();
  rate = Math.round(Math.max(.1, Math.min(3, next)) * 10000) / 10000;
  keepTone = preserve;
  if (playing) {
    position = current; startedAt = context.currentTime;
    nodes.forEach(({ source }) => source.playbackRate.setValueAtTime(rate, context.currentTime));
  }
  toneNode?.port.postMessage({ rate, keepTone });
  renderTempo(); libraryUI.changed();
}
$('stem-rate').oninput = event => changeTempo(event.target.value);
$('stem-rate').ondblclick = () => changeTempo(1);
$('stem-keep-tone').onchange = event => changeTempo(rate, event.target.checked);
$('stem-rate').title = pt('Double-click to reset');
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
      pause(); node.disconnect(); toneNode = null; toneReady = null;
      playbackError(new Error('Tone processor failed'));
    };
    toneNode.connect(mixOutput.input());
  })().catch(error => { toneReady = null; throw error; });
  await toneReady;
}

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
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
function setBusy(value, revealGame = true) {
  busy = value;
  $('separate').disabled = value || libraryOperating || !initialized;
  $('cancel').hidden = !value;
  $('clear-cache').disabled = value;
  $('progress').hidden = !value;
  $('status').classList.toggle('is-loading', value);
  libraryUI?.setBusy(value);
  if (value && revealGame) $('toggle-game').hidden = false;
}
function audioBuffer(channels) {
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: channels[0].length, sampleRate: SAMPLE_RATE });
  channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
  return buffer;
}
function offset(loopRange = stemLoop.range(), at = context?.currentTime || 0) {
  if (!playing) return position;
  const value = Math.max(0, position + Math.max(0, at - startedAt) * rate);
  const { startMs, endMs } = loopRange;
  const start = startMs / 1000, end = endMs / 1000;
  return value >= end ? start + (value - end) % (end - start) : Math.min(value, original.duration);
}
function pause() {
  playbackRevision++;
  position = offset(); playing = false;
  for (const node of [...nodes, ...retiringNodes]) { node.source.stop(); node.cleanup(); }
  nodes = [];
  toneNode?.port.postMessage({ rate, keepTone, reset: true });
  playLabel(false); updatePlayheads();
}
function applyMix() {
  drumSampler?.updateGain();
  const solo = states.some(state => state.solo);
  nodes.forEach(({ gain }, index) => {
    const state = states[index - 1];
    const value = index === 0 ? Number(mode === 'original') :
      mode === 'mix' && !state.muted && (!solo || state.solo) ? state.gain : 0;
    gain.gain.setTargetAtTime(value, context.currentTime, 0.008);
  });
  document.querySelectorAll('.stem').forEach((row, index) => {
    const state = states[index];
    row.querySelector('.stem-enable').setAttribute('aria-checked', String(!state.muted));
    row.classList.toggle('is-silent', mode === 'original' || state.muted || (solo && !state.solo) || state.gain === 0);
  });
  $('original').setAttribute('aria-pressed', String(mode === 'original'));
  $('mix').setAttribute('aria-pressed', String(mode === 'mix'));
}
function createPlaybackNode(buffer, when, at, pattern = false) {
  const source = context.createBufferSource(), gain = context.createGain();
  const { startMs, endMs } = stemLoop.range();
  source.buffer = buffer; source.loop = true; source.playbackRate.value = rate;
  source.loopStart = pattern ? 0 : startMs / 1000; source.loopEnd = pattern ? buffer.duration : endMs / 1000;
  gain.gain.value = 0; source.connect(gain).connect(toneNode);
  const node = { source, gain, pattern, cleanup() { source.disconnect(); gain.disconnect(); retiringNodes.delete(node); } };
  source.onended = node.cleanup;
  const seek = pattern ? ((at - startMs / 1000) % buffer.duration + buffer.duration) % buffer.duration : at;
  source.start(when, seek);
  return node;
}
async function syncSequence({ loop = false } = {}) {
  const version = ++sequenceRevision, owner = drumSequencer;
  if (!owner) return;
  libraryUI.changed();
  if (loop && owner.range()) stemLoop.setRange(owner.range());
  if (!playing) return;
  const transportVersion = playbackRevision;
  const pattern = owner.enabled() ? await owner.prepare() : null;
  if (!playing || version !== sequenceRevision || transportVersion !== playbackRevision || owner !== drumSequencer) return;
  const when = context.currentTime + .015, old = nodes[1];
  const next = createPlaybackNode(pattern || buffers[0], when, offset(undefined, when), !!pattern);
  nodes[1] = next;
  const audible = mode === 'mix' && !states[0].muted && (!states.some(state => state.solo) || states[0].solo);
  next.gain.gain.setValueAtTime(0, when);
  next.gain.gain.linearRampToValueAtTime(audible ? states[0].gain : 0, when + .008);
  old.gain.gain.cancelAndHoldAtTime(when);
  old.gain.gain.linearRampToValueAtTime(0, when + .008); retiringNodes.add(old); old.source.stop(when + .008);
}
async function play() {
  if (!original || playing) return;
  const version = ++playbackRevision;
  context ||= new AudioContext({ sampleRate: SAMPLE_RATE });
  await context.resume();
  await prepareTone();
  const pattern = drumSequencer?.enabled() ? await drumSequencer.prepare() : null;
  if (playing || version !== playbackRevision) return;
  const { startMs, endMs } = stemLoop.range();
  if ((position < startMs / 1000 || position >= endMs / 1000)) position = startMs / 1000;
  else if (position >= original.duration) position = 0;
  startedAt = context.currentTime + 0.03;
  nodes = [original, ...buffers].map((buffer, index) =>
    createPlaybackNode(index === 1 && pattern ? pattern : buffer, startedAt, position, index === 1 && !!pattern));
  toneNode.port.postMessage({ rate, keepTone, reset: true });
  playing = true; applyMix(); playLabel(true);
}
function disposeResults() {
  mixOutput.setEqualizer(null); equalizerUI.reset();
  pause(); drumSequencer?.dispose(); drumSequencer = null; sequenceRevision++;
  drumSampler?.dispose(); drumSampler = null; stemLoop.reset(); buffers = []; outputs = [];
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
  for (const view of waveforms) if ($('stems').contains(view.element)) view.dispose();
  $('stems').replaceChildren(); $('mix').disabled = true; $('quality-note').hidden = true;
  mode = 'original'; applyMix();
}
function showResults(result, saved = null) {
  disposeResults(); position = 0;
  mixOutput.setEqualizer(globalThis.SCParametricEQ.normalize(saved?.eq)); equalizerUI.reset();
  outputs = result.outputs;
  buffers = outputs.map(audioBuffer);
  states = STEMS.map((_, index) => ({ muted: !!saved?.states?.[index]?.muted, solo: false,
    gain: Number.isFinite(saved?.states?.[index]?.gain) ? Math.max(0, Math.min(1, saved.states[index].gain)) : 1,
    collapsed: saved?.states?.[index]?.collapsed === true }));
  rate = Number.isFinite(saved?.rate) ? Math.max(.1, Math.min(3, saved.rate)) : 1;
  keepTone = !!saved?.keepTone;
  renderTempo();
  wavs = [new Blob([encodeWav([original.getChannelData(0), original.getChannelData(1)])], { type: 'audio/wav' })];
  STEMS.forEach((stem, index) => {
    const row = document.createElement('div'); row.className = 'stem'; row.dataset.stem = stem;
    // Same disclosure as the Player Tools sections: the header stays, the waveform and tools fold away.
    const name = document.createElement('h2'), collapse = document.createElement('button');
    collapse.type = 'button'; collapse.className = 'stem-collapse';
    collapse.innerHTML = '<svg class="stem-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
    collapse.prepend(icon(stem), document.createTextNode(text(stem))); name.append(collapse);
    const renderCollapsed = () => {
      row.classList.toggle('is-collapsed', states[index].collapsed);
      collapse.setAttribute('aria-expanded', String(!states[index].collapsed));
      collapse.title = `${pt(states[index].collapsed ? 'Expand' : 'Collapse')} ${text(stem)}`;
      collapse.setAttribute('aria-label', collapse.title);
    };
    collapse.onclick = () => {
      states[index].collapsed = !states[index].collapsed; renderCollapsed(); libraryUI.changed();
      if (!states[index].collapsed) requestAnimationFrame(() => { for (const view of waveforms) if (row.contains(view.element)) view.draw(); });
    };
    renderCollapsed();
    const enabled = document.createElement('button'); enabled.type = 'button'; enabled.className = 'stem-enable stem-solo';
    enabled.setAttribute('role', 'switch');
    enabled.setAttribute('aria-label', pt('Enable $1', text(stem)));
    enabled.title = pt('Enable/disable $1 · Right-click: hear only this track', text(stem));
    enabled.setAttribute('aria-checked', String(!states[index].muted));
    enabled.onclick = () => {
      states[index].muted = !states[index].muted; states.forEach(state => { state.solo = false; });
      mode = 'mix'; applyMix(); libraryUI.changed();
    };
    enabled.oncontextmenu = event => {
      event.preventDefault();
      states.forEach((state, other) => { state.muted = other !== index; state.solo = false; });
      mode = 'mix'; applyMix(); libraryUI.changed();
    };
    const controls = [enabled];
    const volume = document.createElement('div'); volume.className = 'stem-volume';
    const caption = document.createElement('span'); caption.textContent = text('volume');
    const knob = document.createElement('button'); knob.type = 'button'; knob.className = 'pad-knob';
    knob.setAttribute('role', 'slider'); knob.setAttribute('aria-label', `${text('volume')} ${text(stem)}`);
    knob.setAttribute('aria-valuemin', '0'); knob.setAttribute('aria-valuemax', '100'); knob.setAttribute('aria-orientation', 'vertical');
    const level = document.createElement('output');
    const renderVolume = () => {
      const value = Math.round(states[index].gain * 100);
      knob.style.setProperty('--knob-angle', `${-135 + value * 2.7}deg`);
      knob.setAttribute('aria-valuenow', String(value)); knob.setAttribute('aria-valuetext', `${value}%`);
      knob.title = `${text('volume')}: ${value}% · ${text('resetVolume')}`;
      level.textContent = `${value}%`;
    };
    const updateVolume = value => { states[index].gain = Math.round(Math.max(0, Math.min(100, value))) / 100; renderVolume(); mode = 'mix'; applyMix(); libraryUI.changed(); };
    let drag;
    knob.onpointerdown = event => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, y: event.clientY, value: states[index].gain * 100 };
      knob.setPointerCapture(event.pointerId); knob.focus(); event.preventDefault();
    };
    knob.onpointermove = event => { if (drag?.id === event.pointerId) updateVolume(drag.value + (drag.y - event.clientY) * 100 / 140); };
    for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) knob.addEventListener(kind, () => { drag = null; });
    knob.ondblclick = () => updateVolume(100);
    knob.onkeydown = event => {
      if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      updateVolume(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : states[index].gain * 100 +
        (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 10 : 1));
    };
    renderVolume(); volume.append(caption, knob, level);
    const link = document.createElement('a'); link.className = 'download';
    const wav = new Blob([encodeWav(outputs[index])], { type: 'audio/wav' }); wavs.push(wav);
    const url = URL.createObjectURL(wav); urls.push(url);
    link.href = url; link.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80)}_${stem}.wav`;
    link.append(icon('download')); link.title = text('download') + ' WAV - ' + text(stem); link.setAttribute('aria-label', `${text('download')} ${text(stem)}`);
    const actions = document.createElement('div'); actions.className = 'stem-actions'; actions.append(...controls, link, volume);
    row.append(name, actions); $('stems').append(row);
    mountWaveform(row, buffers[index], `${text(stem)} · ${text('position')}`);
    if (stem === 'drums') {
      drumSampler = mountDrumSampler({ row, actions, waveform: row.querySelector('.waveform'),
      buffer: buffers[index], timeline: stemLoop, audioContext: () => mixOutput.getPlaybackContext(), output: () => mixOutput.input(),
      level: () => states[index].muted ? 0 : states[index].gain, changed: () => { libraryUI.changed(); drumSequencer?.samplesChanged(); },
      saved: saved?.drumSlices ?? saved?.drumStarts, locale, report: playbackError });
      drumSequencer = mountDrumSequencer({ row, actions, waveform: row.querySelector('.waveform'), timeline: stemLoop,
        buffer: buffers[index], sampler: drumSampler, saved: saved?.drumSequence, changed: syncSequence,
        togglePlayback, rate: () => rate, setRate: value => changeTempo(value), report: playbackError });
    }
  });
  outputs = [];
  $('mix').disabled = false; $('quality-note').hidden = false; mode = saved?.mode === 'original' ? 'original' : 'mix'; applyMix();
  if (drumSequencer?.enabled() && drumSequencer.range()) stemLoop.setRange(drumSequencer.range());
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
function togglePlayback() { if (playing) pause(); else play().catch(playbackError); }
$('play').onclick = togglePlayback;
$('play').setAttribute('aria-keyshortcuts', 'Space');
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof Element && (target.isContentEditable || target.closest('input, textarea, select, a, [role="textbox"]') ||
      (target.closest('button') && target.closest('button').id !== 'play'))) return;
  event.preventDefault();
  if (!event.repeat && !$('play').disabled) togglePlayback();
});
$('original').onclick = () => { mode = 'original'; applyMix(); libraryUI.changed(); };
$('mix').onclick = () => { mode = 'mix'; applyMix(); libraryUI.changed(); };
let animationFrame;
function animate() {
  updatePlayheads();
  animationFrame = requestAnimationFrame(animate);
}
animate();
window.addEventListener('pagehide', () => {
  equalizerUI.dispose(); recorderUI.dispose(); mixOutput.dispose();
  cancelAnimationFrame(animationFrame);
  for (const view of waveforms) view.dispose();
  drumSequencer?.dispose(); drumSampler?.dispose(); worker?.terminate(); pause(); toneNode?.port.postMessage({ type: 'dispose' }); context?.close(); urls.forEach(url => URL.revokeObjectURL(url));
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
document.querySelector('footer [data-copy="footer"]').textContent = ({
  es: 'El audio permanece en tu equipo. Activá Guardar localmente para conservar la separación.',
  de: 'Audio bleibt auf deinem Gerät. Aktiviere „Lokal speichern“, um die Trennung zu behalten.',
  'pt-BR': 'O áudio fica no seu dispositivo. Ative Salvar localmente para manter a separação.',
  ru: 'Аудио остаётся на этом устройстве. Включите «Сохранить локально», чтобы сохранить разделение.',
})[locale] || 'Audio stays on your device. Enable Save locally to keep this separation.';
try {
  if (jobId) { renderInfo(await message('STEM_LOOP_INFO')); initialized = true; }
  setBusy(false); status(jobId ? text('ready') : localCopy[10]);
} catch (error) { console.error('[Stems initialization]', error); status(error.localized ? error.message : text('infoFailed'), true); }
finally { importReady = true; setBusy(false); }
