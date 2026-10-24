/* Shared copy for the MAIN-world tools and the standalone stem workspace.
 * Source strings are keys; translate at render boundaries, never user content. */
(() => {
  'use strict';
  const locales = ['en', 'es', 'de', 'pt-BR', 'ru'];
  const rows = `
Typing keyboard to piano¦Teclado en modo piano¦Computertastatur als Klavier¦Teclado em modo piano¦Клавиатура как пианино
Record notes¦Grabar notas¦Noten aufnehmen¦Gravar notas¦Записать ноты
Stop recording¦Detener grabación¦Aufnahme stoppen¦Parar gravação¦Остановить запись
Recording mode¦Modo de grabación¦Aufnahmemodus¦Modo de gravação¦Режим записи
Loop overdub¦Grabar en loop¦Loop-Aufnahme¦Gravar em loop¦Запись в цикле
Extend recording¦Extender grabación¦Aufnahme verlängern¦Estender gravação¦Продлевать запись
Backing loop¦Acompañamiento¦Begleitung¦Acompanhamento¦Аккомпанемент
Trim pattern to notes¦Recortar patrón a las notas¦Pattern auf Noten kürzen¦Recortar padrão às notas¦Обрезать паттерн по нотам
Fill every $1 steps¦Llenar cada $1 pasos¦Alle $1 Schritte füllen¦Preencher a cada $1 passos¦Заполнить каждые $1 шагов
Recording limit reached: $1 notes or $2 bars.¦Límite de grabación: $1 notas o $2 compases.¦Aufnahmelimit: $1 Noten oder $2 Takte.¦Limite de gravação: $1 notas ou $2 compassos.¦Лимит записи: $1 нот или $2 тактов.
Piano keyboard: Z–M and Q–U play white notes; the rows above play sharps. Recording follows Snap.¦Teclado piano: Z–M y Q–U tocan las blancas; las filas superiores, los sostenidos. La grabación sigue Snap.¦Klaviatur: Z–M und Q–U spielen weiße Tasten, die Reihen darüber die schwarzen. Die Aufnahme folgt dem Raster.¦Teclado piano: Z–M e Q–U tocam as brancas; as filas acima, os sustenidos. A gravação segue Snap.¦Клавиатура: Z–M и Q–U — белые клавиши, ряды выше — диезы. Запись следует привязке.
All samples¦Todos los samples¦Alle Samples¦Todas as amostras¦Все сэмплы
Chops¦Chops¦Chops¦Chops¦Нарезка
Edit chops¦Editar chops¦Chops bearbeiten¦Editar chops¦Редактировать нарезку
Rack view¦Vista del Rack¦Rack-Ansicht¦Vista do Rack¦Вид стойки
Sample mode¦Modo del sample¦Sample-Modus¦Modo da amostra¦Режим сэмпла
Each row is a sample in this pattern. Choose One-shot for the full sound, or Chops to sequence its selected pad.¦Cada fila es un sample de este patrón. Elegí One-shot para el sonido completo, o Chops para secuenciar su pad seleccionado.¦Jede Zeile ist ein Sample dieses Patterns. One-shot spielt den ganzen Klang, Chops das gewählte Pad.¦Cada linha é uma amostra deste padrão. One-shot toca o som inteiro; Chops sequencia o pad selecionado.¦Каждая строка — сэмпл паттерна. One-shot играет весь звук, Chops — выбранный пэд.
Channel rack¦Channel Rack¦Channel Rack¦Channel Rack¦Channel Rack
Track options: $1 · or right-click the track¦Opciones de pista: $1 · o clic derecho en la pista¦Spuroptionen: $1 · oder Rechtsklick auf die Spur¦Opções da faixa: $1 · ou clique direito na faixa¦Параметры дорожки: $1 · или правый клик по дорожке
Hear only this track¦Escuchar solo esta pista¦Nur diese Spur hören¦Ouvir só esta faixa¦Слушать только эту дорожку
Playlist track¦Pista¦Spur¦Faixa¦Дорожка
Pattern length¦Largo del patrón¦Pattern-Länge¦Duração do padrão¦Длина паттерна
New pattern¦Nuevo patrón¦Neues Pattern¦Novo padrão¦Новый паттерн
Duplicate pattern¦Duplicar patrón¦Pattern duplizieren¦Duplicar padrão¦Дублировать паттерн
Delete pattern¦Eliminar patrón¦Pattern löschen¦Excluir padrão¦Удалить паттерн
Add to playlist¦Agregar a la playlist¦Zur Playlist hinzufügen¦Adicionar à playlist¦Добавить в плейлист
Playlist¦Playlist¦Playlist¦Playlist¦Плейлист
Auto-slice the visible audio into the eight pads¦Cortar automáticamente el audio visible en los ocho pads¦Sichtbares Audio automatisch auf die acht Pads schneiden¦Fatiar automaticamente o áudio visível nos oito pads¦Автоматически нарезать видимое аудио на восемь пэдов
Clear steps¦Borrar pasos¦Schritte löschen¦Limpar passos¦Очистить шаги
Clear all slices¦Borrar todos los cortes¦Alle Schnitte löschen¦Apagar todos os cortes¦Удалить все срезы
Restore cleared slices¦Restaurar los cortes borrados¦Gelöschte Schnitte wiederherstellen¦Restaurar os cortes apagados¦Вернуть удалённые срезы
Delete pattern: $1¦Eliminar patrón: $1¦Pattern löschen: $1¦Excluir padrão: $1¦Удалить паттерн: $1
No patterns yet¦Todavía no hay patrones¦Noch keine Patterns¦Ainda não há padrões¦Паттернов пока нет
Separate or import audio to start.¦Separá o importá audio para empezar.¦Trenne oder importiere Audio, um zu beginnen.¦Separe ou importe áudio para começar.¦Разделите или импортируйте аудио, чтобы начать.
Click to play · right-click to choose another sample¦Clic para escuchar · clic derecho para elegir otro sample¦Klicken zum Abspielen · Rechtsklick für ein anderes Sample¦Clique para ouvir · clique direito para escolher outra amostra¦Нажмите для прослушивания · правая кнопка — другой сэмпл
Pad $1: click or drag on the waveform to choose its sample. Esc cancels.¦Pad $1: hacé clic o arrastrá en la onda para elegir su sample. Esc cancela.¦Pad $1: Auf die Wellenform klicken oder ziehen, um das Sample zu wählen. Esc bricht ab.¦Pad $1: clique ou arraste na onda para escolher a amostra. Esc cancela.¦Пэд $1: нажмите или протяните по волне, чтобы выбрать сэмпл. Esc — отмена.
A S D F G H J K play the pads. Drag on the waveform to re-cut the selected pad; wheel zooms. Click a step to add a hit, drag it up or down for velocity.¦A S D F G H J K tocan los pads. Arrastrá en la onda para recortar de nuevo el pad elegido; la rueda hace zoom. Clic en un paso agrega un golpe; arrastralo arriba o abajo para la intensidad.¦A S D F G H J K spielen die Pads. Auf der Wellenform ziehen, um das gewählte Pad neu zu schneiden; Mausrad zoomt. Klick auf einen Schritt setzt einen Schlag, nach oben oder unten ziehen für die Anschlagstärke.¦A S D F G H J K tocam os pads. Arraste na onda para recortar o pad escolhido; a roda dá zoom. Clique num passo para adicionar um golpe; arraste para cima ou para baixo para a intensidade.¦A S D F G H J K играют пэды. Протяните по волне, чтобы заново нарезать выбранный пэд; колесо — масштаб. Нажмите на шаг, чтобы добавить удар; тяните вверх или вниз для силы.
Piano sample¦Sample del piano¦Piano-Sample¦Amostra do piano¦Сэмпл пианино
empty¦vacío¦leer¦vazio¦пусто
Pad $1 has no sample. Choose one in the channel rack, or pick another pad.¦El pad $1 no tiene sample. Elegí uno en el Channel Rack o usá otro pad.¦Pad $1 hat kein Sample. Wähle eines im Channel Rack oder nimm ein anderes Pad.¦O pad $1 não tem amostra. Escolha uma no Channel Rack ou use outro pad.¦У пэда $1 нет сэмпла. Выберите его в Channel Rack или используйте другой пэд.
Click to add a note with the length and velocity of the last note you clicked. Drag to move, drag the right edge to resize, Alt + drag up or down for velocity. Right-click deletes; Ctrl+D duplicates.¦Clic para agregar una nota con el largo y la intensidad de la última nota que tocaste. Arrastrá para mover, el borde derecho para alargar, Alt + arrastrar arriba o abajo para la intensidad. Clic derecho borra; Ctrl+D duplica.¦Klicken fügt eine Note mit Länge und Anschlagstärke der zuletzt angeklickten Note hinzu. Ziehen verschiebt, rechter Rand ändert die Länge, Alt + nach oben oder unten ziehen ändert die Anschlagstärke. Rechtsklick löscht; Strg+D dupliziert.¦Clique para adicionar uma nota com a duração e a intensidade da última nota clicada. Arraste para mover, a borda direita para alongar, Alt + arrastar para cima ou para baixo para a intensidade. Clique direito apaga; Ctrl+D duplica.¦Нажмите, чтобы добавить ноту с длиной и силой последней нажатой ноты. Тяните, чтобы двигать; правый край — длина; Alt + вверх или вниз — сила. Правая кнопка удаляет; Ctrl+D дублирует.
Add a sample to this track to use its editors.¦Agregá un sample a esta pista para usar sus editores.¦Füge dieser Spur ein Sample hinzu, um ihre Editoren zu verwenden.¦Adicione uma amostra a esta faixa para usar seus editores.¦Добавьте сэмпл на эту дорожку, чтобы использовать её редакторы.
Stem Extractor¦Separador de stems¦Stem-Extraktor¦Separador de stems¦Разделение на стемы
MINI DAW¦MINI DAW¦MINI DAW¦MINI DAW¦МИНИ-DAW
Tone & Velocity¦Tono y velocidad¦Tonhöhe & Tempo¦Tom e velocidade¦Тон и скорость
Keep Tone¦Mantener tono¦Tonhöhe halten¦Manter tom¦Сохранять тон
Keep tone¦Mantener tono¦Tonhöhe halten¦Manter tom¦Сохранять тон
Playback speed¦Velocidad de reproducción¦Wiedergabetempo¦Velocidade de reprodução¦Скорость воспроизведения
Playback speed multiplier¦Multiplicador de velocidad¦Tempofaktor¦Multiplicador de velocidade¦Множитель скорости
Reset speed and tone¦Restablecer velocidad y tono¦Tempo und Tonhöhe zurücksetzen¦Redefinir velocidade e tom¦Сбросить скорость и тон
EQ and recorder¦Ecualizador y grabadora¦Equalizer und Aufnahme¦Equalizador e gravador¦Эквалайзер и запись
Zoom in¦Acercar¦Vergrößern¦Ampliar¦Приблизить
Zoom out¦Alejar¦Verkleinern¦Reduzir¦Отдалить
Show all audio¦Ver todo el audio¦Gesamtes Audio anzeigen¦Mostrar todo o áudio¦Показать всё аудио
Wheel: zoom · Shift + wheel: pan¦Rueda: zoom · Shift + rueda: desplazar¦Mausrad: Zoom · Umschalt + Mausrad: verschieben¦Roda: zoom · Shift + roda: deslocar¦Колесо: масштаб · Shift + колесо: прокрутка
Enable $1¦Activar $1¦$1 aktivieren¦Ativar $1¦Включить $1
Enable/disable $1 · Right-click: hear only this track¦Activar/desactivar $1 · Clic derecho: escuchar solo esta pista¦$1 ein-/ausschalten · Rechtsklick: nur diese Spur hören¦Ativar/desativar $1 · Clique direito: ouvir só esta faixa¦Включить/выключить $1 · Правая кнопка: слушать только эту дорожку
Sampler¦Sampler¦Sampler¦Sampler¦Сэмплер
Piano roll¦Piano roll¦Piano-Roll¦Piano roll¦Пианоролл
Root note¦Nota raíz¦Grundton¦Nota base¦Основная нота
BPM¦BPM¦BPM¦BPM¦BPM
Snap notes¦Ajuste de notas¦Notenraster¦Grade de notas¦Привязка нот
Keyboard range¦Rango del teclado¦Tastaturbereich¦Extensão do teclado¦Диапазон клавиатуры
Loop sample during notes¦Repetir sample durante la nota¦Sample während der Note wiederholen¦Repetir amostra durante a nota¦Повторять сэмпл на протяжении ноты
Undo notes¦Deshacer notas¦Noten rückgängig¦Desfazer notas¦Отменить ноты
Redo notes¦Rehacer notas¦Noten wiederherstellen¦Refazer notas¦Повторить ноты
Clear piano notes¦Borrar notas del piano¦Piano-Noten löschen¦Limpar notas do piano¦Очистить ноты пианоролла
Piano notes¦Notas del piano¦Piano-Noten¦Notas do piano¦Ноты пианоролла
Preview note¦Escuchar nota¦Note vorhören¦Ouvir nota¦Прослушать ноту
Piano note limit reached (512).¦Se alcanzó el límite de 512 notas.¦Limit von 512 Noten erreicht.¦Limite de 512 notas atingido.¦Достигнут лимит в 512 нот.
Grid¦Grilla¦Raster¦Grade¦Сетка
Pattern¦Patrón¦Pattern¦Padrão¦Паттерн
Bars¦Compases¦Takte¦Compassos¦Такты
Bar $1¦Compás $1¦Takt $1¦Compasso $1¦Такт $1
Step $1¦Paso $1¦Schritt $1¦Passo $1¦Шаг $1
Pattern steps¦Pasos del patrón¦Pattern-Schritte¦Passos do padrão¦Шаги паттерна
Pad¦Pad¦Pad¦Pad¦Пэд
Assign a sample¦Asignar un sample¦Sample zuweisen¦Atribuir amostra¦Назначить сэмпл
Play pattern¦Reproducir patrón¦Pattern abspielen¦Reproduzir padrão¦Играть паттерн
Pause¦Pausar¦Pause¦Pausar¦Пауза
Edit sample¦Editar sample¦Sample bearbeiten¦Editar amostra¦Редактировать сэмпл
Sample start¦Inicio del sample¦Sample-Anfang¦Início da amostra¦Начало сэмпла
Sample end¦Fin del sample¦Sample-Ende¦Fim da amostra¦Конец сэмпла
Fade in¦Entrada suave¦Einblenden¦Entrada suave¦Нарастание
Fade out¦Salida suave¦Ausblenden¦Saída suave¦Затухание
A S D F G H J K to play. Edit sample to zoom; drag its edges and fades.¦A S D F G H J K para tocar. Editar sample para acercar; arrastrá sus bordes y fades.¦A S D F G H J K zum Spielen. Sample bearbeiten zum Zoomen; Ränder und Fades ziehen.¦A S D F G H J K para tocar. Editar amostra para ampliar; arraste as bordas e os fades.¦A S D F G H J K — играть. Редактировать сэмпл — увеличить; перетаскивайте края и точки затухания.
Drums¦Batería¦Schlagzeug¦Bateria¦Ударные
Unassigned¦Sin asignar¦Nicht zugewiesen¦Não atribuído¦Не назначено
Expand¦Expandir¦Aufklappen¦Expandir¦Развернуть
Collapse¦Contraer¦Zuklappen¦Recolher¦Свернуть
section¦sección¦Abschnitt¦seção¦раздел
Parametric EQ¦EQ paramétrico¦Parametrischer EQ¦EQ paramétrico¦Параметрический EQ
Bypass EQ¦Omitir EQ¦EQ umgehen¦Ignorar EQ¦Обойти EQ
Enable EQ¦Activar EQ¦EQ aktivieren¦Ativar EQ¦Включить EQ
Bypass EQ only¦Omitir solo el EQ¦Nur EQ umgehen¦Ignorar somente o EQ¦Обойти только EQ
Add EQ point¦Agregar punto de EQ¦EQ-Punkt hinzufügen¦Adicionar ponto de EQ¦Добавить точку EQ
Add a parametric EQ point¦Agregar un punto al EQ paramétrico¦Punkt zum parametrischen EQ hinzufügen¦Adicionar um ponto ao EQ paramétrico¦Добавить точку параметрического EQ
Enable hard clip¦Activar recorte duro¦Hartes Clipping aktivieren¦Ativar corte rígido¦Включить жёсткое ограничение
Disable hard clip¦Desactivar recorte duro¦Hartes Clipping deaktivieren¦Desativar corte rígido¦Выключить жёсткое ограничение
Enable hard clipping after EQ¦Activar recorte duro después del EQ¦Hartes Clipping nach EQ aktivieren¦Ativar corte rígido após o EQ¦Включить жёсткое ограничение после EQ
Disable hard clipping after EQ¦Desactivar recorte duro después del EQ¦Hartes Clipping nach EQ deaktivieren¦Desativar corte rígido após o EQ¦Выключить жёсткое ограничение после EQ
Reset EQ¦Restablecer EQ¦EQ zurücksetzen¦Redefinir EQ¦Сбросить EQ
Reset all EQ points and clipping¦Restablecer los puntos de EQ y el recorte¦Alle EQ-Punkte und Clipping zurücksetzen¦Redefinir os pontos de EQ e o corte¦Сбросить все точки EQ и ограничение
Equalizer response and live frequency spectrum. Double click near the left or right edge for a high-pass or low-pass cutoff. Drag to edit; scroll on a point to adjust Q; double click a point to delete it.¦Respuesta del ecualizador y espectro en vivo. Doble clic cerca del borde izquierdo o derecho para un filtro pasaaltos o pasabajos. Arrastrá para editar; usá la rueda sobre un punto para ajustar Q; doble clic para eliminarlo.¦Equalizer-Kurve und Live-Spektrum. Doppelklick am linken oder rechten Rand setzt einen Hoch- oder Tiefpass. Ziehen zum Bearbeiten; Mausrad über einem Punkt ändert Q; Doppelklick löscht ihn.¦Resposta do equalizador e espectro ao vivo. Clique duplo perto da borda esquerda ou direita cria um filtro passa-altas ou passa-baixas. Arraste para editar; use a roda sobre um ponto para ajustar Q; clique duplo para excluir.¦Кривая эквалайзера и спектр в реальном времени. Двойной щелчок у левого или правого края создаёт ФВЧ или ФНЧ. Перетаскивайте для изменения, колесом меняйте Q, двойным щелчком удаляйте точку.
Player Tools Pro is required to use EQ.¦Necesitás Player Tools Pro para usar el EQ.¦Für EQ ist Player Tools Pro erforderlich.¦É necessário Player Tools Pro para usar o EQ.¦Для использования EQ нужен Player Tools Pro.
Play a track to hear EQ and see its spectrum.¦Reproducí una pista para escuchar el EQ y ver su espectro.¦Spiele einen Titel ab, um den EQ zu hören und das Spektrum zu sehen.¦Reproduza uma faixa para ouvir o EQ e ver o espectro.¦Включите трек, чтобы услышать EQ и увидеть спектр.
Could not apply EQ.¦No se pudo aplicar el EQ.¦EQ konnte nicht angewendet werden.¦Não foi possível aplicar o EQ.¦Не удалось применить EQ.
All 8 points are in use. Move or delete a point.¦Los 8 puntos están en uso. Mové o eliminá uno.¦Alle 8 Punkte sind belegt. Verschiebe oder lösche einen Punkt.¦Os 8 pontos estão em uso. Mova ou exclua um ponto.¦Все 8 точек заняты. Переместите или удалите точку.
High-pass¦Pasaaltos¦Hochpass¦Passa-altas¦ФВЧ
Low-pass¦Pasabajos¦Tiefpass¦Passa-baixas¦ФНЧ
Bell¦Campana¦Glocke¦Sino¦Колокол
$1 · drag for frequency/gain · scroll for Q · double-click to remove¦$1 · arrastrá para frecuencia/ganancia · rueda para Q · doble clic para eliminar¦$1 · ziehen für Frequenz/Pegel · Mausrad für Q · Doppelklick zum Löschen¦$1 · arraste para frequência/ganho · roda para Q · clique duplo para excluir¦$1 · перетаскивание: частота/усиление · колесо: Q · двойной щелчок: удалить
$1 · drag for frequency/Q · scroll for Q · double-click to remove¦$1 · arrastrá para frecuencia/Q · rueda para Q · doble clic para eliminar¦$1 · ziehen für Frequenz/Q · Mausrad für Q · Doppelklick zum Löschen¦$1 · arraste para frequência/Q · roda para Q · clique duplo para excluir¦$1 · перетаскивание: частота/Q · колесо: Q · двойной щелчок: удалить
Record¦Grabadora¦Aufnahme¦Gravador¦Запись
Recording duration¦Duración de la grabación¦Aufnahmedauer¦Duração da gravação¦Длительность записи
Start recording¦Iniciar grabación¦Aufnahme starten¦Iniciar gravação¦Начать запись
Stop recording or playback; hold to clear¦Detener grabación o reproducción; mantené para borrar¦Aufnahme oder Wiedergabe stoppen; halten zum Löschen¦Parar gravação ou reprodução; segure para limpar¦Остановить запись или воспроизведение; удерживайте для удаления
Stop · Hold to clear¦Detener · Mantené para borrar¦Stopp · Halten zum Löschen¦Parar · Segure para limpar¦Стоп · Удерживайте для удаления
Play recorded sample¦Reproducir muestra grabada¦Aufgenommenes Sample abspielen¦Reproduzir amostra gravada¦Воспроизвести записанный сэмпл
Pause recorded sample¦Pausar muestra grabada¦Aufgenommenes Sample pausieren¦Pausar amostra gravada¦Приостановить сэмпл
Download WAV¦Descargar WAV¦WAV herunterladen¦Baixar WAV¦Скачать WAV
Recorded sample position¦Posición de la muestra grabada¦Position im aufgenommenen Sample¦Posição da amostra gravada¦Позиция в записанном сэмпле
Wheel to zoom at the cursor. Drag or Shift + wheel to scroll. Click to seek. Keyboard: + / - zoom, Shift + arrows scroll, 0 resets the view.¦Rueda para acercar al cursor. Arrastrá o Shift + rueda para desplazar. Clic para saltar. Teclado: + / - zoom, Shift + flechas para desplazar, 0 restablece la vista.¦Mausrad zum Zoomen am Zeiger. Ziehen oder Umschalt + Mausrad zum Scrollen. Klick zum Springen. Tastatur: + / - Zoom, Umschalt + Pfeile scrollen, 0 setzt die Ansicht zurück.¦Roda para ampliar no cursor. Arraste ou Shift + roda para deslocar. Clique para buscar. Teclado: + / - zoom, Shift + setas para deslocar, 0 redefine a visualização.¦Колесо — масштаб у курсора. Перетаскивание или Shift + колесо — прокрутка. Щелчок — переход. Клавиатура: + / - масштаб, Shift + стрелки прокрутка, 0 сброс вида.
Record your mix¦Grabá tu mezcla¦Nimm deinen Mix auf¦Grave sua mixagem¦Запишите свой микс
Track · pads · FX · EQ¦Pista · pads · FX · EQ¦Titel · Pads · FX · EQ¦Faixa · pads · FX · EQ¦Трек · пэды · FX · EQ
LIVE¦EN VIVO¦LIVE¦AO VIVO¦В ЭФИРЕ
Could not record audio.¦No se pudo grabar el audio.¦Audio konnte nicht aufgenommen werden.¦Não foi possível gravar o áudio.¦Не удалось записать аудио.
Start a new take (replaces this sample)¦Iniciar otra toma (reemplaza esta muestra)¦Neue Aufnahme starten (ersetzt dieses Sample)¦Iniciar nova tomada (substitui esta amostra)¦Начать новую запись (заменяет этот сэмпл)
Record the final mix¦Grabar la mezcla final¦Finalen Mix aufnehmen¦Gravar a mixagem final¦Записать итоговый микс
Recorder has been closed.¦La grabadora está cerrada.¦Die Aufnahme wurde geschlossen.¦O gravador foi fechado.¦Модуль записи закрыт.
Reload SoundCloud to enable Record.¦Recargá SoundCloud para activar la grabadora.¦Lade SoundCloud neu, um die Aufnahme zu aktivieren.¦Recarregue o SoundCloud para ativar o gravador.¦Перезагрузите SoundCloud, чтобы включить запись.
5-minute limit reached. Your sample is ready.¦Se alcanzó el límite de 5 minutos. Tu muestra está lista.¦Das Limit von 5 Minuten ist erreicht. Dein Sample ist fertig.¦Limite de 5 minutos atingido. Sua amostra está pronta.¦Достигнут лимит 5 минут. Ваш сэмпл готов.
$1-minute limit reached. Your sample is ready.¦Se alcanzó el límite de $1 minutos. Tu muestra está lista.¦Das Limit von $1 Minuten ist erreicht. Dein Sample ist fertig.¦Limite de $1 minutos atingido. Sua amostra está pronta.¦Достигнут лимит $1 мин. Ваш сэмпл готов.
Press play on the player to record.¦Dale play al reproductor para grabar.¦Starte den Player, um aufzunehmen.¦Dê play no player para gravar.¦Запустите плеер, чтобы записывать.
The player is already recording.¦El reproductor ya está grabando.¦Der Player nimmt bereits auf.¦O player já está gravando.¦Плеер уже записывает.
The player did not answer. Reload the track and try again.¦El reproductor no respondió. Volvé a cargar el track e intentá de nuevo.¦Der Player antwortet nicht. Lade den Track neu und versuche es erneut.¦O player não respondeu. Recarregue a faixa e tente novamente.¦Плеер не ответил. Перезагрузите трек и попробуйте снова.
Record what is playing · up to 2 min¦Grabá lo que suena · hasta 2 min¦Nimm auf, was läuft · bis zu 2 Min.¦Grave o que está tocando · até 2 min¦Запишите то, что играет · до 2 мин
Send to Stem Extractor¦Enviar al Stem Extractor¦An Stem Extractor senden¦Enviar ao Stem Extractor¦Отправить в Stem Extractor
Opening the Stem Extractor…¦Abriendo el Stem Extractor…¦Stem Extractor wird geöffnet…¦Abrindo o Stem Extractor…¦Открывается Stem Extractor…
Could not send the recording to the Stem Extractor.¦No se pudo enviar la grabación al Stem Extractor.¦Die Aufnahme konnte nicht an den Stem Extractor gesendet werden.¦Não foi possível enviar a gravação ao Stem Extractor.¦Не удалось отправить запись в Stem Extractor.
Likes Explorer recording¦Grabación del Likes Explorer¦Likes-Explorer-Aufnahme¦Gravação do Likes Explorer¦Запись из Likes Explorer
$1 (recording)¦$1 (grabación)¦$1 (Aufnahme)¦$1 (gravação)¦$1 (запись)
This player cannot be recorded.¦No se puede grabar este reproductor.¦Dieser Player kann nicht aufgenommen werden.¦Não é possível gravar este player.¦Этот плеер нельзя записать.
Stop recording before downloading.¦Detené la grabación antes de descargar.¦Stoppe die Aufnahme vor dem Download.¦Pare a gravação antes de baixar.¦Остановите запись перед скачиванием.
Track¦Pista¦Titel¦Faixa¦Трек
Back to track¦Volver a pista¦Zurück zum Titel¦Voltar à faixa¦Вернуться к треку
Loop Region¦Región de loop¦Loop-Bereich¦Região do loop¦Область лупа
Clear¦Borrar¦Löschen¦Limpar¦Очистить
Clear loop¦Borrar loop¦Loop löschen¦Limpar loop¦Очистить луп
Download loop¦Descargar loop¦Loop herunterladen¦Baixar loop¦Скачать луп
Loop start A¦Inicio del loop A¦Loop-Anfang A¦Início do loop A¦Начало лупа A
Loop end B¦Fin del loop B¦Loop-Ende B¦Fim do loop B¦Конец лупа B
Save loop to a pad¦Guardar loop en un pad¦Loop auf einem Pad speichern¦Salvar loop em um pad¦Сохранить луп на пэд
Play selected loop in piano mode¦Tocar el loop seleccionado en modo piano¦Ausgewählten Loop im Klaviermodus spielen¦Tocar o loop selecionado no modo piano¦Играть выбранный луп в режиме пианино
Cancel loop instrument preparation¦Cancelar preparación del instrumento¦Vorbereitung des Loop-Instruments abbrechen¦Cancelar preparação do instrumento¦Отменить подготовку инструмента
Disable piano mode¦Desactivar modo piano¦Klaviermodus deaktivieren¦Desativar modo piano¦Выключить режим пианино
Reset Player Tools¦Restablecer Player Tools¦Player Tools zurücksetzen¦Redefinir Player Tools¦Сбросить Player Tools
Playback speed and loop¦Velocidad de reproducción y loop¦Wiedergabetempo und Loop¦Velocidade de reprodução e loop¦Скорость воспроизведения и луп
Open the Looper guide¦Abrir la guía del looper¦Looper-Anleitung öffnen¦Abrir guia do looper¦Открыть руководство по луперу
Panel options¦Opciones del panel¦Paneloptionen¦Opções do painel¦Параметры панели
Download current playing¦Descargar la pista actual¦Aktuellen Titel herunterladen¦Baixar faixa atual¦Скачать текущий трек
Full-track downloads are not available in this version¦Las descargas de tracks completos no están disponibles en esta versión¦Downloads ganzer Titel sind in dieser Version nicht verfügbar¦Downloads de faixas completas não estão disponíveis nesta versão¦Скачивание полных треков недоступно в этой версии
Tooltips¦Ayudas¦Tooltips¦Dicas¦Подсказки
Toggle tooltips¦Activar/desactivar ayudas¦Tooltips ein-/ausschalten¦Ativar/desativar dicas¦Включить/выключить подсказки
Reset playback, Loop, FX and EQ. Samples are kept.¦Restablecer reproducción, loop, FX y EQ. Las muestras se conservan.¦Wiedergabe, Loop, FX und EQ zurücksetzen. Samples bleiben erhalten.¦Redefinir reprodução, loop, FX e EQ. As amostras são mantidas.¦Сбросить воспроизведение, луп, FX и EQ. Сэмплы сохраняются.
Keep panel open when clicking outside¦Mantener el panel abierto al hacer clic afuera¦Panel bei Klick außerhalb offen halten¦Manter painel aberto ao clicar fora¦Оставлять панель открытой при щелчке снаружи
Close panel when clicking outside¦Cerrar el panel al hacer clic afuera¦Panel bei Klick außerhalb schließen¦Fechar painel ao clicar fora¦Закрывать панель при щелчке снаружи
Close panel¦Cerrar panel¦Panel schließen¦Fechar painel¦Закрыть панель
Collapse all controls¦Contraer todos los controles¦Alle Regler zuklappen¦Recolher todos os controles¦Свернуть все элементы управления
Hide all controls¦Ocultar todos los controles¦Alle Regler ausblenden¦Ocultar todos os controles¦Скрыть все элементы управления
Show all controls in two columns¦Mostrar controles en dos columnas¦Alle Regler in zwei Spalten anzeigen¦Mostrar controles em duas colunas¦Показать элементы управления в двух столбцах
Show controls in one column¦Mostrar controles en una columna¦Regler in einer Spalte anzeigen¦Mostrar controles em uma coluna¦Показать элементы управления в одном столбце
press maximize button again to show controls¦Volvé a presionar maximizar para mostrar los controles¦Zum Anzeigen der Regler erneut auf Maximieren klicken¦Pressione maximizar novamente para mostrar os controles¦Нажмите развёртывание ещё раз, чтобы показать элементы управления
Quick playback speeds¦Velocidades rápidas¦Tempo-Schnellauswahl¦Velocidades rápidas¦Быстрый выбор скорости
Keep tone: change playback speed without changing the pitch.¦Mantener tono: cambiá la velocidad sin cambiar la altura tonal.¦Tonhöhe halten: Tempo ändern, ohne die Tonhöhe zu ändern.¦Manter tom: altere a velocidade sem mudar a altura tonal.¦Сохранять тон: менять скорость без изменения высоты звука.
Edit playback speed¦Editar velocidad¦Wiedergabetempo bearbeiten¦Editar velocidade¦Изменить скорость
Click to edit playback speed¦Clic para editar velocidad¦Klicken, um das Tempo zu bearbeiten¦Clique para editar velocidade¦Нажмите для изменения скорости
Bypass loop and playback effects¦Omitir loop y efectos de reproducción¦Loop und Wiedergabeeffekte umgehen¦Ignorar loop e efeitos de reprodução¦Обойти луп и эффекты воспроизведения
Bypass all Player Tools¦Omitir todos los Player Tools¦Alle Player Tools umgehen¦Ignorar todas as Player Tools¦Обойти все Player Tools
Bypass on — restore all Player Tools¦Bypass activo — restaurar todos los Player Tools¦Bypass aktiv — alle Player Tools wiederherstellen¦Bypass ativo — restaurar todas as Player Tools¦Обход включён — восстановить все Player Tools
Saved speed $1. Hold to replace¦Velocidad guardada $1. Mantené para reemplazar¦Gespeichertes Tempo $1. Halten zum Ersetzen¦Velocidade salva $1. Segure para substituir¦Сохранённая скорость $1. Удерживайте для замены
Hold to save the current speed¦Mantené para guardar la velocidad actual¦Halten, um das aktuelle Tempo zu speichern¦Segure para salvar a velocidade atual¦Удерживайте, чтобы сохранить текущую скорость
Playback speed $1¦Velocidad de reproducción $1¦Wiedergabetempo $1¦Velocidade de reprodução $1¦Скорость воспроизведения $1
FREE¦GRATIS¦GRATIS¦GRÁTIS¦БЕСПЛАТНО
Player Tools Pro active¦Player Tools Pro activo¦Player Tools Pro aktiv¦Player Tools Pro ativo¦Player Tools Pro активен
Player Tools Free plan¦Plan gratuito de Player Tools¦Kostenloser Player-Tools-Tarif¦Plano gratuito do Player Tools¦Бесплатный тариф Player Tools
Get Player Tools Pro¦Obtener Player Tools Pro¦Player Tools Pro holen¦Obter Player Tools Pro¦Получить Player Tools Pro
Player Tools Pro required¦Se requiere Player Tools Pro¦Player Tools Pro erforderlich¦Player Tools Pro necessário¦Требуется Player Tools Pro
Sample envelope¦Envolvente de la muestra¦Sample-Hüllkurve¦Envelope da amostra¦Огибающая сэмпла
ADSR envelope¦Envolvente ADSR¦ADSR-Hüllkurve¦Envelope ADSR¦Огибающая ADSR
ADSR: how the volume changes over time. The dashed line marks when you release the key.¦ADSR: cómo cambia el volumen en el tiempo. La línea punteada marca cuándo soltás la tecla.¦ADSR: Lautstärkeverlauf über die Zeit. Die gestrichelte Linie markiert das Loslassen der Taste.¦ADSR: como o volume muda ao longo do tempo. A linha pontilhada marca quando você solta a tecla.¦ADSR: изменение громкости со временем. Пунктир отмечает отпускание клавиши.
Attack¦Ataque¦Anstieg¦Ataque¦Атака
Decay¦Caída¦Abklingen¦Decaimento¦Спад
Sustain¦Sostenimiento¦Haltepegel¦Sustentação¦Удержание
Release¦Liberación¦Ausklingen¦Liberação¦Затухание
Time for the sound to reach full volume.¦Tiempo hasta alcanzar el volumen máximo.¦Zeit bis zur vollen Lautstärke.¦Tempo para atingir o volume máximo.¦Время до максимальной громкости.
Time for the sound to fall from full volume to the sustain level.¦Tiempo para bajar del volumen máximo al nivel de sostenimiento.¦Zeit vom Maximum bis zum Haltepegel.¦Tempo para cair do volume máximo ao nível de sustentação.¦Время спада от максимума до уровня удержания.
Volume held while the key is pressed.¦Volumen mientras mantenés la tecla presionada.¦Lautstärke bei gedrückter Taste.¦Volume enquanto a tecla está pressionada.¦Громкость при нажатой клавише.
Time for the sound to fade out after you release the key.¦Tiempo de desvanecimiento al soltar la tecla.¦Ausklingzeit nach dem Loslassen der Taste.¦Tempo para o som desaparecer após soltar a tecla.¦Время затухания после отпускания клавиши.
Cut itself¦Cortar sonido anterior¦Vorherigen Ton abschneiden¦Cortar som anterior¦Прерывать предыдущий звук
GAIN¦GANANCIA¦PEGEL¦GANHO¦УСИЛЕНИЕ
PITCH¦TONO¦TONHÖHE¦TOM¦ТОН
TIME¦TIEMPO¦ZEIT¦TEMPO¦ВРЕМЯ
Gain¦Ganancia¦Pegel¦Ganho¦Усиление
Pitch¦Tono¦Tonhöhe¦Tom¦Тон
Time¦Tiempo¦Zeit¦Tempo¦Время
Time (duration, keeps tone; next hit)¦Tiempo (duración, mantiene tono; próximo golpe)¦Zeit (Dauer, hält Tonhöhe; nächster Anschlag)¦Tempo (duração, mantém tom; próxima batida)¦Время (длительность, сохраняет тон; следующий удар)
Selected pad¦Pad seleccionado¦Ausgewähltes Pad¦Pad selecionado¦Выбранный пэд
Keyboard¦Teclado¦Tastatur¦Teclado¦Клавиатура
Double-click to reset¦Doble clic para restablecer¦Doppelklick zum Zurücksetzen¦Clique duplo para redefinir¦Двойной щелчок для сброса
Playback speed of the whole session (0.1×–3×). Unlike BPM, it changes how fast the audio plays. Double-click to reset to 1×.¦Velocidad de reproducción de toda la sesión (0.1×–3×). A diferencia del BPM, cambia qué tan rápido suena el audio. Doble clic para volver a 1×.¦Wiedergabetempo der ganzen Sitzung (0.1×–3×). Anders als BPM ändert es, wie schnell das Audio läuft. Doppelklick setzt auf 1× zurück.¦Velocidade de reprodução de toda a sessão (0.1×–3×). Diferente do BPM, muda a rapidez com que o áudio toca. Clique duplo para voltar a 1×.¦Скорость воспроизведения всей сессии (0.1×–3×). В отличие от BPM, меняет скорость звучания аудио. Двойной щелчок — сброс на 1×.
FX presets¦Presets de efectos¦Effekt-Presets¦Presets de efeitos¦Пресеты эффектов
Subtle¦Sutil¦Dezent¦Sutil¦Мягкий
Studio¦Estudio¦Studio¦Estúdio¦Студия
Wide¦Amplio¦Breit¦Amplo¦Широкий
Space¦Espacio¦Raum¦Espaço¦Пространство
Motion¦Movimiento¦Bewegung¦Movimento¦Движение
Color¦Color¦Klangfarbe¦Cor¦Окраска
Reverb¦Reverberación¦Hall¦Reverberação¦Реверберация
Echo¦Eco¦Echo¦Eco¦Эхо
Saturation¦Saturación¦Sättigung¦Saturação¦Насыщение
Reverb mix¦Mezcla de reverberación¦Hall-Mix¦Mix de reverberação¦Доля реверберации
Echo mix¦Mezcla de eco¦Echo-Mix¦Mix de eco¦Доля эха
Flanger mix¦Mezcla de flanger¦Flanger-Mix¦Mix de flanger¦Доля флэнжера
Phaser mix¦Mezcla de phaser¦Phaser-Mix¦Mix de phaser¦Доля фэйзера
Saturation mix¦Mezcla de saturación¦Sättigungs-Mix¦Mix de saturação¦Доля насыщения
Bitcrusher mix¦Mezcla de bitcrusher¦Bitcrusher-Mix¦Mix de bitcrusher¦Доля биткрашера
Reverb mix; 0% turns it off¦Mezcla de reverberación; 0% la desactiva¦Hall-Mix; 0 % schaltet ihn aus¦Mix de reverberação; 0% desativa¦Доля реверберации; 0% выключает
Echo mix; 0% turns it off¦Mezcla de eco; 0% lo desactiva¦Echo-Mix; 0 % schaltet es aus¦Mix de eco; 0% desativa¦Доля эха; 0% выключает
Room¦Sala¦Raum¦Sala¦Комната
Hall¦Salón¦Halle¦Salão¦Зал
Plate¦Placa¦Platte¦Placa¦Пластина
Size¦Tamaño¦Größe¦Tamanho¦Размер
Pre-delay¦Retardo previo¦Vorverzögerung¦Pré-atraso¦Предзадержка
Tone¦Tono¦Klang¦Tom¦Тембр
Feedback¦Realimentación¦Rückkopplung¦Realimentação¦Обратная связь
Rate¦Frecuencia¦Rate¦Taxa¦Частота
Depth¦Profundidad¦Tiefe¦Profundidade¦Глубина
Drive¦Intensidad¦Ansteuerung¦Intensidade¦Перегруз
Downsample¦Reducir muestreo¦Abtastrate senken¦Reduzir amostragem¦Снижение частоты
Hold to freeze echo¦Mantené para congelar el eco¦Halten, um Echo einzufrieren¦Segure para congelar o eco¦Удерживайте, чтобы заморозить эхо
Hold to Freeze¦Mantené para congelar¦Halten zum Einfrieren¦Segure para congelar¦Удерживайте для заморозки
Frozen — release¦Congelado — soltá¦Eingefroren — loslassen¦Congelado — solte¦Заморожено — отпустите
Drag to adjust · Hold for options¦Arrastrá para ajustar · Mantené para ver opciones¦Ziehen zum Anpassen · Halten für Optionen¦Arraste para ajustar · Segure para opções¦Перетаскивайте для настройки · Удерживайте для параметров
$1: drag vertically · Shift for fine adjustment¦$1: arrastrá verticalmente · Shift para ajuste fino¦$1: vertikal ziehen · Umschalt für Feineinstellung¦$1: arraste verticalmente · Shift para ajuste fino¦$1: тяните вертикально · Shift для точной настройки
 · Hold to open options (Enter / Space)¦ · Mantené para abrir opciones (Enter / Espacio)¦ · Halten für Optionen (Eingabe / Leertaste)¦ · Segure para abrir opções (Enter / Espaço)¦ · Удерживайте для параметров (Enter / Пробел)
Disable $1 ($2% wet)¦Desactivar $1 ($2% de efecto)¦$1 deaktivieren ($2% Effekt)¦Desativar $1 ($2% de efeito)¦Выключить $1 ($2% эффекта)
Enable $1 ($2% wet)¦Activar $1 ($2% de efecto)¦$1 aktivieren ($2% Effekt)¦Ativar $1 ($2% de efeito)¦Включить $1 ($2% эффекта)
Teleport to selected track¦Ir a la pista seleccionada¦Zum ausgewählten Titel springen¦Ir à faixa selecionada¦Перейти к выбранному треку
STEREO / 44.1 kHz¦ESTÉREO / 44,1 kHz¦STEREO / 44,1 kHz¦ESTÉREO / 44,1 kHz¦СТЕРЕО / 44,1 кГц
Could not load the sample waveform.¦No se pudo cargar la onda de la muestra.¦Sample-Wellenform konnte nicht geladen werden.¦Não foi possível carregar a onda da amostra.¦Не удалось загрузить волну сэмпла.
Could not restore saved samples.¦No se pudieron restaurar las muestras guardadas.¦Gespeicherte Samples konnten nicht wiederhergestellt werden.¦Não foi possível restaurar as amostras salvas.¦Не удалось восстановить сохранённые сэмплы.
Could not open this pad.¦No se pudo abrir este pad.¦Dieses Pad konnte nicht geöffnet werden.¦Não foi possível abrir este pad.¦Не удалось открыть этот пэд.
Could not save pad bounds.¦No se pudieron guardar los límites del pad.¦Pad-Grenzen konnten nicht gespeichert werden.¦Não foi possível salvar os limites do pad.¦Не удалось сохранить границы пэда.
Invalid instrument audio chunk.¦Fragmento de audio del instrumento no válido.¦Ungültiger Instrument-Audioabschnitt.¦Trecho de áudio do instrumento inválido.¦Неверный фрагмент аудио инструмента.
Incomplete instrument audio chunk.¦Fragmento de audio del instrumento incompleto.¦Unvollständiger Instrument-Audioabschnitt.¦Trecho de áudio do instrumento incompleto.¦Неполный фрагмент аудио инструмента.
The instrument audio transfer was incomplete.¦La transferencia del audio del instrumento quedó incompleta.¦Die Übertragung des Instrument-Audios war unvollständig.¦A transferência do áudio do instrumento ficou incompleta.¦Передача аудио инструмента не завершена.
Could not prepare this pad.¦No se pudo preparar este pad.¦Dieses Pad konnte nicht vorbereitet werden.¦Não foi possível preparar este pad.¦Не удалось подготовить этот пэд.
The pad request timed out.¦La solicitud del pad tardó demasiado.¦Zeitüberschreitung bei der Pad-Anfrage.¦A solicitação do pad demorou demais.¦Истекло время запроса пэда.
Instrument preparation cancelled.¦Preparación del instrumento cancelada.¦Instrument-Vorbereitung abgebrochen.¦Preparação do instrumento cancelada.¦Подготовка инструмента отменена.
Could not restore saved samples. Reopen Sampler to retry.¦No se pudieron restaurar las muestras. Volvé a abrir el sampler para reintentar.¦Samples konnten nicht wiederhergestellt werden. Öffne den Sampler erneut.¦Não foi possível restaurar as amostras. Reabra o sampler para tentar novamente.¦Не удалось восстановить сэмплы. Откройте сэмплер снова.
Preparing loop instrument…¦Preparando instrumento del loop…¦Loop-Instrument wird vorbereitet…¦Preparando instrumento do loop…¦Подготовка инструмента из лупа…
The track duration is not available yet.¦La duración de la pista todavía no está disponible.¦Die Titeldauer ist noch nicht verfügbar.¦A duração da faixa ainda não está disponível.¦Длительность трека пока недоступна.
The prepared instrument audio is unavailable.¦El audio preparado del instrumento no está disponible.¦Das vorbereitete Instrument-Audio ist nicht verfügbar.¦O áudio preparado do instrumento não está disponível.¦Подготовленное аудио инструмента недоступно.
This track is too large to keep in sampler memory at this speed.¦La pista es demasiado grande para la memoria del sampler a esta velocidad.¦Dieser Titel ist bei diesem Tempo zu groß für den Sampler-Speicher.¦A faixa é grande demais para a memória do sampler nesta velocidade.¦При этой скорости трек не помещается в память сэмплера.
This track is too large to keep in sampler memory.¦La pista es demasiado grande para la memoria del sampler.¦Dieser Titel ist zu groß für den Sampler-Speicher.¦A faixa é grande demais para a memória do sampler.¦Трек не помещается в память сэмплера.
Could not prepare this loop instrument.¦No se pudo preparar el instrumento del loop.¦Loop-Instrument konnte nicht vorbereitet werden.¦Não foi possível preparar o instrumento do loop.¦Не удалось подготовить инструмент из лупа.
Could not play the loop instrument.¦No se pudo tocar el instrumento del loop.¦Loop-Instrument konnte nicht gespielt werden.¦Não foi possível tocar o instrumento do loop.¦Не удалось сыграть на инструменте из лупа.
Hold this pad to load a sample, or assign a loop to it.¦Mantené este pad para cargar una muestra o asignale un loop.¦Halte dieses Pad, um ein Sample zu laden, oder weise ihm einen Loop zu.¦Segure este pad para carregar uma amostra ou atribua um loop.¦Удерживайте пэд для загрузки сэмпла или назначьте ему луп.
The drum samples are not ready yet.¦Las muestras de batería todavía no están listas.¦Die Schlagzeug-Samples sind noch nicht bereit.¦As amostras de bateria ainda não estão prontas.¦Сэмплы ударных ещё не готовы.
The saved sample is unavailable.¦La muestra guardada no está disponible.¦Das gespeicherte Sample ist nicht verfügbar.¦A amostra salva não está disponível.¦Сохранённый сэмпл недоступен.
Preparing sample time…¦Preparando duración de la muestra…¦Sample-Dauer wird vorbereitet…¦Preparando duração da amostra…¦Подготовка длительности сэмпла…
Could not play this sample.¦No se pudo reproducir esta muestra.¦Dieses Sample konnte nicht abgespielt werden.¦Não foi possível reproduzir esta amostra.¦Не удалось воспроизвести сэмпл.
Choose an audio file for this pad.¦Elegí un archivo de audio para este pad.¦Wähle eine Audiodatei für dieses Pad.¦Escolha um arquivo de áudio para este pad.¦Выберите аудиофайл для этого пэда.
This sample is too large for a pad.¦La muestra es demasiado grande para un pad.¦Dieses Sample ist zu groß für ein Pad.¦A amostra é grande demais para um pad.¦Сэмпл слишком большой для пэда.
Samples must be 30 seconds or shorter and fit the pad memory limit.¦Las muestras deben durar hasta 30 segundos y caber en la memoria del pad.¦Samples dürfen höchstens 30 Sekunden lang sein und müssen in den Pad-Speicher passen.¦As amostras devem ter até 30 segundos e caber na memória do pad.¦Сэмплы должны длиться до 30 секунд и помещаться в память пэда.
Could not read that audio sample.¦No se pudo leer esa muestra de audio.¦Dieses Audio-Sample konnte nicht gelesen werden.¦Não foi possível ler essa amostra de áudio.¦Не удалось прочитать аудиосэмпл.
Default sample restored.¦Muestra predeterminada restaurada.¦Standard-Sample wiederhergestellt.¦Amostra padrão restaurada.¦Стандартный сэмпл восстановлен.
Could not remove the saved sample.¦No se pudo eliminar la muestra guardada.¦Gespeichertes Sample konnte nicht entfernt werden.¦Não foi possível remover a amostra salva.¦Не удалось удалить сохранённый сэмпл.
Your 7-day Player Tools trial has ended. Player Tools Pro is required to keep using this feature.¦Terminó tu prueba de 7 días. Necesitás Player Tools Pro para seguir usando esta función.¦Deine 7-tägige Testphase ist abgelaufen. Für diese Funktion ist Player Tools Pro erforderlich.¦Seu teste de 7 dias terminou. É necessário Player Tools Pro para continuar usando esta função.¦Ваш пробный период 7 дней завершён. Для этой функции нужен Player Tools Pro.
Player Tools Pro is required to keep using this feature.¦Necesitás Player Tools Pro para seguir usando esta función.¦Für diese Funktion ist Player Tools Pro erforderlich.¦É necessário Player Tools Pro para continuar usando esta função.¦Для дальнейшего использования функции нужен Player Tools Pro.
The track changed. Please set the loop again.¦Cambió la pista. Volvé a definir el loop.¦Der Titel hat gewechselt. Lege den Loop erneut fest.¦A faixa mudou. Defina o loop novamente.¦Трек изменился. Задайте луп снова.
Player Tools access could not be confirmed. Please retry.¦No se pudo confirmar el acceso a Player Tools. Reintentá.¦Zugriff auf Player Tools konnte nicht bestätigt werden. Versuche es erneut.¦Não foi possível confirmar o acesso ao Player Tools. Tente novamente.¦Не удалось подтвердить доступ к Player Tools. Повторите попытку.
Could not change playback speed. Reload SoundCloud and retry.¦No se pudo cambiar la velocidad. Recargá SoundCloud y reintentá.¦Tempo konnte nicht geändert werden. Lade SoundCloud neu und versuche es erneut.¦Não foi possível alterar a velocidade. Recarregue o SoundCloud e tente novamente.¦Не удалось изменить скорость. Перезагрузите SoundCloud и повторите попытку.
Play a track to activate FX.¦Reproducí una pista para activar los efectos.¦Spiele einen Titel ab, um FX zu aktivieren.¦Reproduza uma faixa para ativar os efeitos.¦Включите трек для активации эффектов.
Could not pause playback for Echo Freeze.¦No se pudo pausar la reproducción para congelar el eco.¦Wiedergabe konnte für Echo Freeze nicht pausiert werden.¦Não foi possível pausar para congelar o eco.¦Не удалось приостановить воспроизведение для заморозки эха.
Echo Freeze ended, but playback could not resume. Press play to continue.¦Terminó la congelación del eco, pero no se pudo reanudar. Presioná reproducir.¦Echo Freeze beendet, aber Wiedergabe konnte nicht fortgesetzt werden. Drücke Play.¦O congelamento do eco terminou, mas não foi possível retomar. Pressione reproduzir.¦Заморозка эха завершена, но воспроизведение не возобновилось. Нажмите воспроизведение.
Could not save this playback setting.¦No se pudo guardar este ajuste de reproducción.¦Wiedergabeeinstellung konnte nicht gespeichert werden.¦Não foi possível salvar este ajuste de reprodução.¦Не удалось сохранить настройку воспроизведения.
Loop is waiting for the current track metadata.¦El loop espera los datos de la pista actual.¦Der Loop wartet auf die Metadaten des aktuellen Titels.¦O loop aguarda os dados da faixa atual.¦Луп ожидает данные текущего трека.
Could not update the loop. Please retry.¦No se pudo actualizar el loop. Reintentá.¦Loop konnte nicht aktualisiert werden. Versuche es erneut.¦Não foi possível atualizar o loop. Tente novamente.¦Не удалось обновить луп. Повторите попытку.
Analyzing audio frequencies...¦Analizando frecuencias del audio…¦Audiofrequenzen werden analysiert…¦Analisando frequências do áudio…¦Анализ частот аудио…
Red: bass | Green: mids | Blue: treble¦Rojo: graves | Verde: medios | Azul: agudos¦Rot: Bässe | Grün: Mitten | Blau: Höhen¦Vermelho: graves | Verde: médios | Azul: agudos¦Красный: низкие | Зелёный: средние | Синий: высокие
Amplitude waveform | Frequency analysis unavailable¦Onda de amplitud | Análisis de frecuencias no disponible¦Amplituden-Wellenform | Frequenzanalyse nicht verfügbar¦Onda de amplitude | Análise de frequências indisponível¦Амплитудная волна | Анализ частот недоступен
No instrument sample selected.¦No hay una muestra de instrumento seleccionada.¦Kein Instrument-Sample ausgewählt.¦Nenhuma amostra de instrumento selecionada.¦Сэмпл инструмента не выбран.
Instrument samples must be smaller than 32 MB.¦Las muestras de instrumento deben pesar menos de 32 MB.¦Instrument-Samples müssen kleiner als 32 MB sein.¦As amostras de instrumento devem ter menos de 32 MB.¦Сэмплы инструмента должны быть меньше 32 МБ.
Piano · 1 sample¦Piano · 1 muestra¦Klavier · 1 Sample¦Piano · 1 amostra¦Пианино · 1 сэмпл
Piano¦Piano¦Klavier¦Piano¦Пианино
8 pads¦8 pads¦8 Pads¦8 pads¦8 пэдов
Pad samples can be up to 30 seconds long. Shorten the loop or increase its speed.¦Las muestras de pad pueden durar hasta 30 segundos. Acortá el loop o aumentá su velocidad.¦Pad-Samples dürfen bis zu 30 Sekunden lang sein. Kürze den Loop oder erhöhe das Tempo.¦As amostras de pad podem durar até 30 segundos. Encurte o loop ou aumente a velocidade.¦Сэмплы пэда могут длиться до 30 секунд. Сократите луп или увеличьте скорость.
Could not save this loop to a pad.¦No se pudo guardar este loop en un pad.¦Loop konnte nicht auf einem Pad gespeichert werden.¦Não foi possível salvar este loop em um pad.¦Не удалось сохранить луп на пэд.
Download request timed out.¦La solicitud de descarga tardó demasiado.¦Zeitüberschreitung bei der Download-Anfrage.¦A solicitação de download demorou demais.¦Истекло время запроса скачивания.
Could not start download request.¦No se pudo iniciar la solicitud de descarga.¦Download-Anfrage konnte nicht gestartet werden.¦Não foi possível iniciar a solicitação de download.¦Не удалось начать запрос скачивания.
Stem separation supports loops up to 2 minutes. Shorten the selected loop first.¦La separación admite loops de hasta 2 minutos. Acortá el loop seleccionado.¦Stem-Trennung unterstützt Loops bis 2 Minuten. Kürze zuerst den ausgewählten Loop.¦A separação aceita loops de até 2 minutos. Encurte o loop selecionado.¦Разделение поддерживает лупы до 2 минут. Сначала сократите выбранный луп.
Loop opened in Stems. Separation uses the original speed without effects.¦Loop abierto en Stems. La separación usa la velocidad original sin efectos.¦Loop in Stems geöffnet. Die Trennung verwendet das Originaltempo ohne Effekte.¦Loop aberto em Stems. A separação usa a velocidade original sem efeitos.¦Луп открыт в Stems. Разделение использует исходную скорость без эффектов.
Could not open stem separation.¦No se pudo abrir la separación de stems.¦Stem-Trennung konnte nicht geöffnet werden.¦Não foi possível abrir a separação de stems.¦Не удалось открыть разделение на стемы.
Set both loop markers before downloading.¦Definí ambos marcadores del loop antes de descargar.¦Setze vor dem Download beide Loop-Marker.¦Defina os dois marcadores do loop antes de baixar.¦Задайте оба маркера лупа перед скачиванием.
Preparing loop download…¦Preparando descarga del loop…¦Loop-Download wird vorbereitet…¦Preparando download do loop…¦Подготовка скачивания лупа…
Loop download started.¦Descarga del loop iniciada.¦Loop-Download gestartet.¦Download do loop iniciado.¦Скачивание лупа началось.
Could not start loop download.¦No se pudo iniciar la descarga del loop.¦Loop-Download konnte nicht gestartet werden.¦Não foi possível iniciar o download do loop.¦Не удалось начать скачивание лупа.
Preparing track download…¦Preparando descarga de la pista…¦Titel-Download wird vorbereitet…¦Preparando download da faixa…¦Подготовка скачивания трека…
Track download started.¦Descarga de la pista iniciada.¦Titel-Download gestartet.¦Download da faixa iniciado.¦Скачивание трека началось.
Could not start track download.¦No se pudo iniciar la descarga de la pista.¦Titel-Download konnte nicht gestartet werden.¦Não foi possível iniciar o download da faixa.¦Не удалось начать скачивание трека.
Separate the selected loop into vocals, drums, bass and other (up to 2 minutes)¦Separar el loop en voz, batería, bajo y otros (hasta 2 minutos)¦Loop in Gesang, Schlagzeug, Bass und andere trennen (bis 2 Minuten)¦Separar o loop em vocais, bateria, baixo e outros (até 2 minutos)¦Разделить луп на вокал, ударные, бас и другое (до 2 минут)
Saved sampler states¦Estados guardados del sampler¦Gespeicherte Sampler-Zustände¦Estados salvos do sampler¦Сохранённые состояния семплера
Save state¦Guardar estado¦Zustand speichern¦Salvar estado¦Сохранить состояние
State name¦Nombre del estado¦Name des Zustands¦Nome do estado¦Название состояния
No saved states yet¦Todavía no hay estados guardados¦Noch keine Zustände gespeichert¦Nenhum estado salvo ainda¦Пока нет сохранённых состояний
Delete state¦Eliminar estado¦Zustand löschen¦Excluir estado¦Удалить состояние
Sampler state saved.¦Estado del sampler guardado.¦Sampler-Zustand gespeichert.¦Estado do sampler salvo.¦Состояние семплера сохранено.
Sampler state restored.¦Estado del sampler restaurado.¦Sampler-Zustand wiederhergestellt.¦Estado do sampler restaurado.¦Состояние семплера восстановлено.
Could not update sampler states. Please try again.¦No se pudieron actualizar los estados. Volvé a intentarlo.¦Zustände konnten nicht aktualisiert werden. Bitte erneut versuchen.¦Não foi possível atualizar os estados. Tente novamente.¦Не удалось обновить состояния. Попробуйте ещё раз.
Loading states…¦Cargando estados…¦Zustände werden geladen…¦Carregando estados…¦Загрузка состояний…
Wait for the samples to finish saving.¦Esperá a que los samples terminen de guardarse.¦Bitte warten, bis die Samples gespeichert sind.¦Aguarde os samples terminarem de salvar.¦Дождитесь завершения сохранения семплов.
Piano mode on · ← → octave ({octave})¦Modo piano activado · ← → octava ({octave})¦Pianomodus aktiv · ← → Oktave ({octave})¦Modo piano ativado · ← → oitava ({octave})¦Режим пианино включён · ← → октава ({octave})
Play the selected loop with your keyboard, using physical QWERTY key positions. At octave 0, Q and comma play C5 (the original sample); Z plays C4. The Z and Q rows play white notes; the A and number rows add sharps. Every mapped key sounds: the gaps repeat nearby notes. Semicolon, quote, brackets, comma, period, slash, minus and equals are included. ← lowers one octave; → raises one (range −4 to +3). The number in the message shows the octave shift. Higher notes play faster and shorter; lower notes play slower and longer. Cut itself stops earlier notes; turn it off to layer notes. With ADSR on, releasing a key starts the release. With ADSR off, samples keep playing after keyup until they end or Cut itself stops them. After preparation, move the loop boundaries to edit the sample live. Escape exits; entering again resets the octave. The track stays paused. Typing in text fields and Ctrl/Cmd/Alt shortcuts remain available.¦Tocá el loop seleccionado con el teclado, según la posición física de las teclas QWERTY. En octava 0, Q y coma tocan C5 (el sample original); Z toca C4. Las filas Z y Q tocan notas blancas; las filas A y números agregan sostenidos. Todas las teclas del mapa suenan: los huecos repiten notas cercanas. Se incluyen punto y coma, comilla, corchetes, coma, punto, barra, menos e igual. ← baja una octava; → sube una (rango −4 a +3). El número del mensaje indica el cambio de octava. Las notas agudas suenan más rápidas y cortas; las graves, más lentas y largas. Cut itself corta las notas anteriores; desactivalo para superponerlas. Con ADSR encendido, soltar una tecla inicia el release. Con ADSR apagado, el sample sigue sonando hasta terminar o hasta que Cut itself lo corte. Después de preparar el audio, mové los límites del loop para editar el sample en vivo. Escape sale; al entrar de nuevo se reinicia la octava. El track queda pausado. Podés seguir escribiendo en campos de texto y usando atajos con Ctrl/Cmd/Alt.¦Spiele den ausgewählten Loop über die physischen QWERTY-Tastenpositionen. Bei Oktave 0 spielen Q und Komma C5 (das Originalsample), Z spielt C4. Die Reihen Z und Q spielen weiße Tasten; die Reihen A und Zahlen ergänzen die erhöhten Töne. Alle belegten Tasten klingen: Lücken wiederholen benachbarte Noten. Semikolon, Anführungszeichen, eckige Klammern, Komma, Punkt, Schrägstrich, Minus und Gleichheitszeichen sind enthalten. ← senkt um eine Oktave, → erhöht um eine (Bereich −4 bis +3). Die Zahl zeigt die Oktavverschiebung. Hohe Noten spielen schneller und kürzer, tiefe langsamer und länger. Cut itself stoppt vorherige Noten; ausgeschaltet können sie sich überlagern. Bei aktivem ADSR beginnt beim Loslassen die Release-Phase. Ohne ADSR spielt das Sample nach dem Loslassen weiter, bis es endet oder Cut itself es stoppt. Nach der Vorbereitung kannst du die Loop-Grenzen verschieben und das Sample live bearbeiten. Escape beendet den Modus; beim erneuten Aktivieren wird die Oktave zurückgesetzt. Der Track bleibt pausiert. Textfelder und Tastenkürzel mit Strg/Cmd/Alt bleiben verfügbar.¦Toque o loop selecionado usando as posições físicas das teclas QWERTY. Na oitava 0, Q e vírgula tocam C5 (o sample original); Z toca C4. As fileiras Z e Q tocam notas brancas; as fileiras A e números acrescentam sustenidos. Todas as teclas mapeadas soam: os espaços repetem notas próximas. Inclui ponto e vírgula, aspas, colchetes, vírgula, ponto, barra, menos e igual. ← desce uma oitava; → sobe uma (intervalo de −4 a +3). O número na mensagem indica a mudança de oitava. Notas agudas tocam mais rápido e duram menos; graves tocam mais devagar e duram mais. Cut itself corta as notas anteriores; desative para sobrepor notas. Com ADSR ligado, soltar uma tecla inicia o release. Com ADSR desligado, o sample continua tocando até terminar ou até Cut itself cortá-lo. Depois de preparar o áudio, mova os limites do loop para editar o sample em tempo real. Escape sai; ao entrar novamente, a oitava é redefinida. A faixa permanece pausada. Campos de texto e atalhos com Ctrl/Cmd/Alt continuam disponíveis.¦Играйте выбранный луп с клавиатуры по физическим позициям клавиш QWERTY. При сдвиге 0 клавиши Q и запятая играют C5 (исходный сэмпл), Z — C4. Ряды Z и Q играют белые клавиши, ряды A и цифр добавляют диезы. Все назначенные клавиши звучат: пробелы в схеме повторяют соседние ноты. Включены точка с запятой, кавычка, квадратные скобки, запятая, точка, косая черта, минус и равно. ← понижает на октаву, → повышает (диапазон от −4 до +3). Число в сообщении показывает сдвиг октавы. Высокие ноты звучат быстрее и короче, низкие — медленнее и дольше. Cut itself обрывает предыдущие ноты; выключите его для многоголосия. При включённом ADSR отпускание клавиши запускает фазу Release. Без ADSR сэмпл продолжает звучать до конца или пока Cut itself не остановит его. После подготовки аудио границы лупа можно менять, редактируя сэмпл в реальном времени. Escape выключает режим; при повторном включении октава сбрасывается. Трек остаётся на паузе. Поля ввода и сочетания Ctrl/Cmd/Alt работают как обычно.
Slice selected loop into 8 pads¦Dividir el loop seleccionado en 8 pads¦Ausgewählten Loop auf 8 Pads aufteilen¦Dividir o loop selecionado em 8 pads¦Разделить выбранный луп на 8 пэдов
Replace all eight pads?¦¿Reemplazar los ocho pads?¦Alle acht Pads ersetzen?¦Substituir os oito pads?¦Заменить все восемь пэдов?
The selected A–B loop will be split into eight equal slices. This replaces all eight sounds, including custom samples. Your assigned keys will stay the same.¦El loop seleccionado entre A y B se dividirá en ocho partes iguales. Se reemplazarán los ocho sonidos, incluidos los samples personalizados. Se conservarán tus teclas asignadas.¦Der ausgewählte Loop zwischen A und B wird in acht gleich lange Abschnitte geteilt. Alle acht Sounds werden ersetzt, auch eigene Samples. Deine Tastenbelegung bleibt erhalten.¦O loop selecionado entre A e B será dividido em oito partes iguais. Os oito sons serão substituídos, incluindo samples personalizados. Suas teclas atribuídas serão mantidas.¦Выбранный луп между A и B будет разделён на восемь равных частей. Все восемь звуков будут заменены, включая пользовательские сэмплы. Назначенные клавиши сохранятся.
Replace with 8 slices¦Reemplazar con 8 cortes¦Durch 8 Slices ersetzen¦Substituir por 8 fatias¦Заменить на 8 слайсов
Cancel¦Cancelar¦Abbrechen¦Cancelar¦Отмена
Preparing 8 slices… Press Escape to cancel.¦Preparando 8 cortes… Escape para cancelar.¦8 Slices werden vorbereitet… Escape zum Abbrechen.¦Preparando 8 fatias… Escape para cancelar.¦Подготовка 8 слайсов… Escape для отмены.
Cancel slice preparation¦Cancelar la preparación de cortes¦Slice-Vorbereitung abbrechen¦Cancelar a preparação das fatias¦Отменить подготовку слайсов
8 slices saved. Play them with your pad keys.¦8 cortes guardados. Tocalos con las teclas de tus pads.¦8 Slices gespeichert. Spiele sie mit deinen Pad-Tasten.¦8 fatias salvas. Toque com as teclas dos seus pads.¦8 слайсов сохранены. Играйте назначенными клавишами пэдов.
Slice preparation cancelled. Pads were not changed.¦Preparación cancelada. Los pads no cambiaron.¦Vorbereitung abgebrochen. Die Pads wurden nicht geändert.¦Preparação cancelada. Os pads não foram alterados.¦Подготовка отменена. Пэды не изменены.
The loop or its settings changed. Slice preparation cancelled.¦Cambió el loop o su configuración. Preparación cancelada.¦Der Loop oder seine Einstellungen wurden geändert. Vorbereitung abgebrochen.¦O loop ou suas configurações mudaram. Preparação cancelada.¦Луп или его настройки изменились. Подготовка отменена.
Could not save the eight slices. Please try again.¦No se pudieron guardar los ocho cortes. Volvé a intentarlo.¦Die acht Slices konnten nicht gespeichert werden. Bitte erneut versuchen.¦Não foi possível salvar as oito fatias. Tente novamente.¦Не удалось сохранить восемь слайсов. Попробуйте ещё раз.
Select a loop of up to 30 seconds at the current speed.¦Seleccioná un loop de hasta 30 segundos a la velocidad actual.¦Wähle einen Loop mit höchstens 30 Sekunden bei der aktuellen Geschwindigkeit.¦Selecione um loop de até 30 segundos na velocidade atual.¦Выберите луп длительностью до 30 секунд при текущей скорости.
Choose one of the eight pads. Press Escape to cancel.¦Elegí uno de los ocho pads. Escape para cancelar.¦Wähle eines der acht Pads. Escape zum Abbrechen.¦Escolha um dos oito pads. Escape para cancelar.¦Выберите один из восьми пэдов. Escape для отмены.
`.trim().split('\n').map(row => row.split('¦'));
  rows.push(...`
Rec¦Grabar¦Aufn.¦Gravar¦Зап.
Invalid parametric EQ settings.¦Ajustes de EQ paramétrico no válidos.¦Ungültige Einstellungen des parametrischen EQ.¦Ajustes de EQ paramétrico inválidos.¦Неверные настройки параметрического EQ.
Invalid rendered loop audio.¦Audio del loop procesado no válido.¦Ungültiges gerendertes Loop-Audio.¦Áudio do loop processado inválido.¦Неверное аудио обработанного лупа.
The rendered loop is incomplete.¦El loop procesado está incompleto.¦Der gerenderte Loop ist unvollständig.¦O loop processado está incompleto.¦Обработанный луп неполный.
Reload SoundCloud to enable the equalizer.¦Recargá SoundCloud para activar el ecualizador.¦Lade SoundCloud neu, um den Equalizer zu aktivieren.¦Recarregue o SoundCloud para ativar o equalizador.¦Перезагрузите SoundCloud для включения эквалайзера.
This loop is too large to save as a pad sample.¦El loop es demasiado grande para guardarlo en un pad.¦Dieser Loop ist zu groß für ein Pad-Sample.¦O loop é grande demais para salvar em um pad.¦Луп слишком большой для сохранения на пэд.
Flanger¦Flanger¦Flanger¦Flanger¦Флэнжер
Phaser¦Phaser¦Phaser¦Phaser¦Фэйзер
Bitcrusher¦Bitcrusher¦Bitcrusher¦Bitcrusher¦Биткрашер
Dub¦Dub¦Dub¦Dub¦Даб
Bits¦Bits¦Bits¦Bits¦Биты
Kick¦Bombo¦Kick¦Bumbo¦Бочка
Kick 2¦Bombo 2¦Kick 2¦Bumbo 2¦Бочка 2
Clap¦Palma¦Klatschen¦Palma¦Хлопок
Clap 2¦Palma 2¦Klatschen 2¦Palma 2¦Хлопок 2
Hat¦Hi-hat¦Hi-Hat¦Chimbal¦Хай-хэт
Hat 2¦Hi-hat 2¦Hi-Hat 2¦Chimbal 2¦Хай-хэт 2
Snare¦Caja¦Snare¦Caixa¦Малый барабан
Tom¦Tom¦Tom¦Tom¦Том
$1 drum pad. Key $2. Right click to edit sample bounds. Hold left click to remove the saved sample and restore the default. Shift + Enter or Shift + Space to load an audio sample.¦Pad $1. Tecla $2. Clic derecho para editar los límites. Mantené el clic izquierdo para restaurar la muestra predeterminada. Shift + Enter o Shift + Espacio para cargar audio.¦Pad $1. Taste $2. Rechtsklick zum Bearbeiten der Grenzen. Linksklick halten, um das Standard-Sample wiederherzustellen. Umschalt + Eingabe oder Leertaste zum Laden.¦Pad $1. Tecla $2. Clique direito para editar limites. Segure o clique esquerdo para restaurar a amostra padrão. Shift + Enter ou Shift + Espaço para carregar áudio.¦Пэд $1. Клавиша $2. Правая кнопка — границы сэмпла. Удерживайте левую кнопку для восстановления стандартного сэмпла. Shift + Enter или Shift + Пробел — загрузка аудио.
$1 · Right-click to open this sample in the looper and edit its start/end · hold left click to restore default · Shift + Enter / Space to load¦$1 · Clic derecho para editar inicio/fin en el looper · mantené el clic izquierdo para restaurar · Shift + Enter / Espacio para cargar¦$1 · Rechtsklick zum Bearbeiten von Start/Ende im Looper · Linksklick halten zum Zurücksetzen · Umschalt + Eingabe / Leertaste zum Laden¦$1 · Clique direito para editar início/fim no looper · segure o clique esquerdo para restaurar · Shift + Enter / Espaço para carregar¦$1 · Правая кнопка: начало/конец в лупере · удержание левой: сброс · Shift + Enter / Пробел: загрузка
Load sample for $1¦Cargar muestra para $1¦Sample für $1 laden¦Carregar amostra para $1¦Загрузить сэмпл для $1
ADSR: attack $1 ms, decay $2 ms, sustain $3%, release $4 ms. Dashed line: key release.¦ADSR: ataque $1 ms, caída $2 ms, sostenimiento $3%, liberación $4 ms. Línea punteada: soltar tecla.¦ADSR: Anstieg $1 ms, Abklingen $2 ms, Haltepegel $3%, Ausklingen $4 ms. Gestrichelte Linie: Taste loslassen.¦ADSR: ataque $1 ms, decaimento $2 ms, sustentação $3%, liberação $4 ms. Linha pontilhada: soltar tecla.¦ADSR: атака $1 мс, спад $2 мс, удержание $3%, затухание $4 мс. Пунктир: отпускание клавиши.
Could not load $1.¦No se pudo cargar $1.¦$1 konnte nicht geladen werden.¦Não foi possível carregar $1.¦Не удалось загрузить $1.
Could not fully reset Player Tools. $1¦No se pudo restablecer todo Player Tools. $1¦Player Tools konnte nicht vollständig zurückgesetzt werden. $1¦Não foi possível redefinir totalmente o Player Tools. $1¦Не удалось полностью сбросить Player Tools. $1
Preparing loop for pad $1…¦Preparando loop para el pad $1…¦Loop für Pad $1 wird vorbereitet…¦Preparando loop para o pad $1…¦Подготовка лупа для пэда $1…
Loop saved to pad $1.¦Loop guardado en el pad $1.¦Loop auf Pad $1 gespeichert.¦Loop salvo no pad $1.¦Луп сохранён на пэд $1.
Could not connect this audio player.¦No se pudo conectar este reproductor.¦Audioplayer konnte nicht verbunden werden.¦Não foi possível conectar este player.¦Не удалось подключить аудиоплеер.
Web Audio is unavailable in this browser.¦Web Audio no está disponible en este navegador.¦Web Audio ist in diesem Browser nicht verfügbar.¦Web Audio não está disponível neste navegador.¦Web Audio недоступен в этом браузере.
The SoundCloud stream does not allow live audio effects.¦Este stream de SoundCloud no admite efectos en vivo.¦Dieser SoundCloud-Stream erlaubt keine Live-Effekte.¦Este stream do SoundCloud não permite efeitos ao vivo.¦Этот поток SoundCloud не поддерживает эффекты в реальном времени.
Could not initialize live audio effects.¦No se pudieron iniciar los efectos en vivo.¦Live-Effekte konnten nicht initialisiert werden.¦Não foi possível iniciar os efeitos ao vivo.¦Не удалось запустить эффекты в реальном времени.
Could not change playback speed. Reload YouTube and retry.¦No se pudo cambiar la velocidad. Recargá YouTube y volvé a intentarlo.¦Die Geschwindigkeit konnte nicht geändert werden. Lade YouTube neu und versuche es erneut.¦Não foi possível mudar a velocidade. Recarregue o YouTube e tente de novo.¦Не удалось изменить скорость. Перезагрузите YouTube и повторите.
The waveform fills in as the video plays. Red: bass | Green: mids | Blue: treble¦La forma de onda se completa mientras suena el video. Rojo: graves | Verde: medios | Azul: agudos¦Die Wellenform füllt sich, während das Video läuft. Rot: Bässe | Grün: Mitten | Blau: Höhen¦A forma de onda se completa enquanto o vídeo toca. Vermelho: graves | Verde: médios | Azul: agudos¦Волна заполняется во время воспроизведения. Красный: низы | Зелёный: середина | Синий: верха
Unmute the video to record the loop.¦Activá el sonido del video para grabar el loop.¦Schalte den Ton des Videos ein, um den Loop aufzunehmen.¦Ative o som do vídeo para gravar o loop.¦Включите звук видео, чтобы записать луп.
Loop recording cancelled.¦Grabación del loop cancelada.¦Loop-Aufnahme abgebrochen.¦Gravação do loop cancelada.¦Запись лупа отменена.
The video changed. Loop recording cancelled.¦Cambió el video. Grabación del loop cancelada.¦Das Video hat gewechselt. Loop-Aufnahme abgebrochen.¦O vídeo mudou. Gravação do loop cancelada.¦Видео сменилось. Запись лупа отменена.
An ad interrupted the recording. Try again after the ad.¦Un anuncio interrumpió la grabación. Volvé a intentarlo después del anuncio.¦Eine Werbung hat die Aufnahme unterbrochen. Versuche es nach der Werbung erneut.¦Um anúncio interrompeu a gravação. Tente de novo depois do anúncio.¦Реклама прервала запись. Повторите после рекламы.
Playback paused. Loop recording cancelled.¦Se pausó la reproducción. Grabación del loop cancelada.¦Wiedergabe pausiert. Loop-Aufnahme abgebrochen.¦Reprodução pausada. Gravação do loop cancelada.¦Воспроизведение приостановлено. Запись лупа отменена.
Recording the loop for Stems: $1 / $2. Click Stems again to cancel.¦Grabando el loop para Stems: $1 / $2. Hacé clic en Stems otra vez para cancelar.¦Loop wird für Stems aufgenommen: $1 / $2. Klicke erneut auf Stems zum Abbrechen.¦Gravando o loop para Stems: $1 / $2. Clique em Stems de novo para cancelar.¦Запись лупа для Stems: $1 / $2. Нажмите Stems ещё раз для отмены.
Record the selected loop in real time and separate it into vocals, drums, bass and other (up to 2 minutes)¦Grabar el loop seleccionado en tiempo real y separarlo en voz, batería, bajo y otros (hasta 2 minutos)¦Den gewählten Loop in Echtzeit aufnehmen und in Gesang, Drums, Bass und Sonstiges trennen (bis 2 Minuten)¦Gravar o loop selecionado em tempo real e separá-lo em voz, bateria, baixo e outros (até 2 minutos)¦Записать выбранный луп в реальном времени и разделить на вокал, ударные, бас и прочее (до 2 минут)
`.trim().split('\n').map(row => row.split('¦')));
  const messages = Object.fromEntries(rows.map(([source, ...translations]) => [source, [source, ...translations]]));
  function locale() {
    const language = (globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.document?.documentElement?.getAttribute('data-scdl-ui-language') || globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'en').replace('_', '-').toLowerCase();
    return language.startsWith('pt') ? 'pt-BR' : locales.find(value => language === value || language.startsWith(value + '-')) || 'en';
  }
  function t(source, ...values) {
    const translated = messages[source]?.[locales.indexOf(locale())] || source;
    return translated.replace(/\$(\d+)/g, (match, index) => values[Number(index) - 1] ?? match);
  }
  const bindings = new WeakMap();
  function localize(root) {
    const records = [];
    const index = locales.indexOf(locale());
    const translatedSources = new Map(Object.entries(messages).map(([source, translations]) => [translations[index], source]));
    const sourceFor = value => messages[value] ? value : translatedSources.get(value);
    const attributes = ['title', 'aria-label', 'placeholder', 'data-scdl-tooltip', 'alt'];
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!node.getAttribute || node.matches?.('style,script')) continue;
      for (const attribute of attributes) {
        const value = node.getAttribute(attribute);
        const source = value && sourceFor(value);
        if (source) {
          const rendered = t(source);
          node.setAttribute(attribute, rendered);
          records.push({ node, attribute, source, rendered });
        }
      }
      for (const child of node.childNodes) {
        if (child.nodeType !== 3) continue;
        const value = child.textContent.trim();
        const source = sourceFor(value);
        if (source) {
          const prefix = child.textContent.slice(0, child.textContent.indexOf(value));
          const suffix = child.textContent.slice(prefix.length + value.length);
          child.textContent = prefix + t(source) + suffix;
          records.push({ node: child, source, prefix, suffix, rendered: child.textContent });
        }
      }
    }
    bindings.set(root, records);
  }
  // MAIN-world tools can mount before the extension supplies its UI locale.
  // Refresh only known template copy that has not since become dynamic/user text.
  function refresh(root) {
    for (const record of bindings.get(root) || []) {
      const { node, attribute, source, prefix = '', suffix = '' } = record;
      if ((attribute ? node.getAttribute(attribute) : node.textContent) !== record.rendered) continue;
      record.rendered = prefix + t(source) + suffix;
      if (attribute) node.setAttribute(attribute, record.rendered);
      else node.textContent = record.rendered;
    }
  }
  globalThis.SCPlayerToolsText = Object.freeze({ t, locale, localize, refresh, messages, locales });
})();
