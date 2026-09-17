/**
 * КОНТРАКТЫ ПРОЕКТА. ЗАМОРОЖЕНО.
 *
 * Этот файл описывает границы между модулями. Менять его может только
 * технический руководитель. Исполнитель, которому не хватает поля или типа,
 * НЕ добавляет его сам — он останавливается и возвращает вопрос.
 *
 * Причина строгости: три исполнителя пишут параллельно и видят друг друга
 * только через эти определения. Одностороннее изменение контракта означает,
 * что два куска кода не сойдутся, и оплачивать их придётся дважды.
 *
 * Типы описаны через JSDoc, а не TypeScript, сознательно: прототип должен
 * запускаться в браузере без шага сборки.
 */

// ---------------------------------------------------------------------------
// 1. КОНТЕНТ (только чтение; готовится агентом C, потребляется A и B)
// ---------------------------------------------------------------------------

/**
 * Учебная единица — слово. Приходит из data/words.json, не изменяется в игре.
 * @typedef {Object} WordUnit
 * @property {string}   id                идентификатор, например "w1712..."
 * @property {string}   word              запись как есть: 彼, 今夜, ありがとう
 * @property {string}   reading            чтение каной: かれ
 * @property {string}   furigana           запись с фуриганой в формате Anki
 * @property {string}   meaning_ru         русское значение
 * @property {string}   meaning_en         английское значение (справочно)
 * @property {string}   sentence           пример на японском
 * @property {string}   sentence_furigana  пример с фуриганой
 * @property {string}   sentence_ru        перевод примера
 * @property {string}   pitch              разметка тонального ударения
 * @property {string}   notes_ru           примечания
 * @property {number|null} frequency       ранг частотности, меньше — чаще
 * @property {string[]} kanji              иероглифы, входящие в запись слова
 */

/**
 * Учебная единица — иероглиф. Приходит из data/kanji.json.
 *
 * ВНИМАНИЕ. Поле kyu — СТАРАЯ шкала японского экзамена (до 2010 года),
 * где 4 самый лёгкий уровень, а 1 самый трудный. Поле jlpt — уже пересчёт
 * в современную шкалу. Для кампании N4 нужны kyu 4 и 3, то есть
 * jlpt === "N5" || jlpt === "N4", всего 284 иероглифа.
 * Фильтр по kyu === "4" даст набор N5 и это будет замечено поздно.
 *
 * @typedef {Object} KanjiUnit
 * @property {string}   id
 * @property {string}   kanji             сам иероглиф
 * @property {string}   meaning_ru        русское значение; ПУСТО у большинства
 * @property {string}   meaning_en        английское значение
 * @property {string}   on                онъёми
 * @property {string}   kun               кунъёми
 * @property {string|null} kyu            старая шкала: "4".."1"
 * @property {string|null} jlpt           "N5" | "N4" | "N2" | "N1" | null
 * @property {number|null} stroke_count
 * @property {string}   radical
 * @property {string[]} similar_looking   визуально похожие иероглифы
 * @property {boolean}  has_stroke_svg    анимация черт; есть у меньшинства
 * @property {{word: string, meaning: string}[]} vocabulary
 */

/**
 * Связь «иероглиф -> идентификаторы слов, в которых он встречается».
 * Приходит из data/links.json.
 * @typedef {Record<string, string[]>} KanjiWordLinks
 */

// ---------------------------------------------------------------------------
// 2. ГРАНИ
// ---------------------------------------------------------------------------

/**
 * Грань — то, что именно спрашивается об учебной единице.
 *
 * Решение заказчика: сначала единица осваивается по основной грани, и только
 * потом вокруг неё нарастает остальное. Обратный перевод (русский -> японский)
 * в проект НЕ входит.
 *
 * MEANING — основная. Показано чтение каной, спрашивается русское значение.
 *           Открыта всегда.
 * WRITING — узнавание записи. Показано слово в записи с иероглифами,
 *           спрашивается, то же ли это слово / какой иероглиф в нём стоит.
 * USAGE   — употребление. Слово внутри примера-предложения.
 *
 * Грани WRITING и USAGE открываются, когда MEANING достигла порога
 * FACET_UNLOCK_THRESHOLD (см. balance.js). До этого они не спрашиваются.
 *
 * @readonly
 * @enum {string}
 */
export const Facet = Object.freeze({
  MEANING: "meaning",
  WRITING: "writing",
  USAGE: "usage",
});

/** @typedef {"meaning"|"writing"|"usage"} FacetName */

// ---------------------------------------------------------------------------
// 3. ПРОГРЕСС (владелец — агент A; UI только читает)
// ---------------------------------------------------------------------------

/**
 * Состояние одной учебной единицы в системе повторений.
 *
 * Интервал ОДИН на единицу, общий для всех граней — это решение заказчика,
 * принятое ради того, чтобы дневная нагрузка не умножалась на число граней.
 * Счётчики по граням нужны только чтобы выбрать, что спросить сейчас,
 * и чтобы понять, открылись ли остальные грани.
 *
 * @typedef {Object} UnitProgress
 * @property {string}  unitId
 * @property {"word"|"kanji"} kind
 * @property {number}  interval        текущий интервал в днях; 0 — новая
 * @property {number}  ease            коэффициент лёгкости, старт 2.5
 * @property {number}  dueDay          номер игрового дня, когда спрашивать
 * @property {number}  lapses          сколько раз срывалась за всю историю
 * @property {number}  lastLapseDay    игровой день последнего срыва; -1 если не было
 * @property {number}  reps            сколько раз показывалась
 * @property {Record<FacetName, FacetStat>} facets
 */

/**
 * @typedef {Object} FacetStat
 * @property {number} correct    подряд правильных
 * @property {number} total      всего показов
 * @property {boolean} unlocked  открыта ли грань
 */

/**
 * Результат одного ответа игрока. UI отдаёт это ядру.
 * @typedef {Object} AnswerResult
 * @property {string}    unitId
 * @property {FacetName} facet
 * @property {boolean}   correct
 * @property {number}    elapsedMs   сколько думал; нужно для будущей настройки
 */

// ---------------------------------------------------------------------------
// 4. ОСАДА И БОЙ
// ---------------------------------------------------------------------------

/**
 * Волна осады.
 *
 * INFANTRY формируется НЕ из очереди повторений, а из резерва зрелых единиц,
 * срок которых ещё не подошёл. Причина в расчёте (docs/balance-report.md):
 * честная очередь на 70-90% состоит из трудного материала, лёгких единиц
 * в ней почти нет, и задуманный разгон в начале осады сам не соберётся.
 *
 * @readonly
 * @enum {string}
 */
export const Wave = Object.freeze({
  INFANTRY: "infantry",   // разгон: зрелое, вне срока, из резерва
  OFFICERS: "officers",   // очередь на сегодня, интервал меньше 14 дней
  VETERANS: "veterans",   // срывалось за последние 3 недели либо низкий ease
});

/** @typedef {"infantry"|"officers"|"veterans"} WaveName */

/**
 * Вопрос, который ядро отдаёт интерфейсу. Интерфейс НЕ лезет в данные сам
 * и НЕ решает, что спросить: он рисует то, что пришло, и возвращает AnswerResult.
 *
 * @typedef {Object} Question
 * @property {string}    unitId
 * @property {FacetName} facet
 * @property {WaveName|null} wave      null, если вопрос из боя кампании
 * @property {string}    prompt         что показать игроку
 * @property {string}    expected       эталонный ответ
 * @property {string[]}  accepted       все допустимые варианты ответа
 * @property {string[]}  distractors    неверные варианты для выбора из плиток
 * @property {"choice"|"typing"|"kana"} inputKind
 */

/**
 * Состояние игрового дня. Переживает перезагрузку страницы:
 * заказчик требует «продолжить» и «сдаться».
 *
 * @typedef {Object} DaySession
 * @property {number}  day                номер игрового дня
 * @property {WaveName} currentWave
 * @property {string[]} remaining          идентификаторы единиц в текущей волне
 * @property {number}  stamina             оставшаяся выносливость героя
 * @property {number}  answered            сколько ответов дано сегодня
 * @property {number}  correct             из них верных; нужно счётчику на экране
 * @property {boolean} surrendered         игрок нажал «сдаться»
 */

// ---------------------------------------------------------------------------
// 5. СОХРАНЕНИЕ
// ---------------------------------------------------------------------------

/**
 * Полное сохранение. Хранится в IndexedDB, экспортируется файлом.
 *
 * Прогресс лежит ОТДЕЛЬНО от контента и связывается по unitId. Это нужно,
 * чтобы обновление базы слов не стирало достижения игрока.
 *
 * @typedef {Object} SaveFile
 * @property {1}       version
 * @property {number}  createdAt          отметка времени создания
 * @property {number}  currentDay         номер игрового дня
 * @property {number}  dayRollsOverAtHour  час смены суток; по решению заказчика 4
 * @property {Settings} settings
 * @property {Record<string, UnitProgress>} progress
 * @property {DaySession|null} session
 * @property {CampaignState} campaign
 */

/**
 * Настройки игрока. Оба ползунка ограничивают ВХОД, а не выход.
 * Ползунка «размер осады» нет сознательно: ограничение очереди повторений
 * не уменьшает работу, а превращает её в невидимый долг (см. отчёт по балансу).
 *
 * @typedef {Object} Settings
 * @property {number} newPerDay      новых единиц в день, 3..20, по умолчанию 8
 * @property {number} battleLength   сколько ответов за один заход, по умолчанию 30
 */

/**
 * @typedef {Object} CampaignState
 * @property {string}   currentLevelId
 * @property {string[]} completedLevels
 */

// ---------------------------------------------------------------------------
// 6. ИНТЕРФЕЙСЫ МОДУЛЕЙ
// ---------------------------------------------------------------------------

/**
 * Ядро обучения. Реализует агент A. Не знает про DOM вообще.
 *
 * @typedef {Object} LearningCore
 * @property {(save: SaveFile, content: ContentIndex) => void} init
 * @property {(day: number) => Record<WaveName, string[]>} buildSiege
 *           состав осады на день, разбитый по волнам
 * @property {(unitId: string) => FacetName} pickFacet
 *           какую грань спрашивать сейчас
 * @property {(result: AnswerResult, day: number) => UnitProgress} applyAnswer
 *           записать ответ; вызывается на КАЖДЫЙ ответ, независимо от
 *           того, доиграл ли игрок бой до конца
 * @property {(day: number, horizonDays: number) => LoadForecast} forecast
 *           прогноз нагрузки для советника
 */

/**
 * Прогноз, который советник показывает игроку. Не совет, а числа:
 * игрок не способен сам увидеть рост, он отложен на недели.
 *
 * @typedef {Object} LoadForecast
 * @property {number} inDays
 * @property {number} expectedUnits
 * @property {number} expectedMinutes
 */

/**
 * Индекс контента. Готовит агент C, отдаёт остальным только через этот вид.
 *
 * @typedef {Object} ContentIndex
 * @property {(id: string) => WordUnit|undefined} word
 * @property {(ch: string) => KanjiUnit|undefined} kanji
 * @property {(ch: string) => string[]} wordsWithKanji
 * @property {(levelId: string) => Level|undefined} level
 */

/**
 * Уровень кампании. Собирается заранее в файл, а не на лету:
 * так его можно поправить руками, не трогая код.
 *
 * @typedef {Object} Level
 * @property {string}   id
 * @property {string}   title
 * @property {string}   theme
 * @property {"main"|"prep"|"boss"} kind
 * @property {string[]} unitIds
 * @property {string[]} prepLevelIds   ответвления подготовки
 */

export const CONTRACT_VERSION = 1;
