/**
 * Индекс контента. Зона агента C.
 *
 * Отдаёт остальным модулям данные ТОЛЬКО через ContentIndex из types.js.
 * Ни ядро, ни интерфейс не читают JSON напрямую — иначе при смене формата
 * данных придётся править три модуля вместо одного.
 *
 * @typedef {import("../core/types.js").ContentIndex} ContentIndex
 */

/** @type {{words: any[], kanji: any[], links: Record<string,string[]>}} */
const store = { words: [], kanji: [], links: {} };

const byWordId = new Map();
const byKanjiChar = new Map();

/**
 * Загружает данные. Вызывается один раз при старте.
 * @param {string} base путь к каталогу data
 * @returns {Promise<void>}
 */
export async function loadContent(base = "./data") {
  const [words, kanji, links] = await Promise.all([
    fetch(`${base}/words.json`).then((r) => r.json()),
    fetch(`${base}/kanji.json`).then((r) => r.json()),
    fetch(`${base}/links.json`).then((r) => r.json()),
  ]);
  store.words = words;
  store.kanji = kanji;
  store.links = links;
  byWordId.clear();
  byKanjiChar.clear();
  for (const w of words) byWordId.set(w.id, w);
  for (const k of kanji) byKanjiChar.set(k.kanji, k);
}

/** @returns {ContentIndex} */
export function contentIndex() {
  return {
    word: (id) => byWordId.get(id),
    kanji: (ch) => byKanjiChar.get(ch),
    wordsWithKanji: (ch) => store.links[ch] ?? [],
    level: (_levelId) => undefined, // TODO(агент C): уровни кампании, этап 3
  };
}

/**
 * Слова, отсортированные по частотности (меньше ранг — чаще слово).
 * Нужно для сборки уровней и для потока новых единиц.
 * @param {number} [limit]
 * @returns {any[]}
 */
export function wordsByFrequency(limit) {
  const sorted = [...store.words].sort(
    (a, b) => (a.frequency ?? Infinity) - (b.frequency ?? Infinity),
  );
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * Иероглифы нужного уровня.
 *
 * ВНИМАНИЕ: фильтровать по полю jlpt, а НЕ по kyu. Поле kyu — старая шкала
 * до реформы 2010 года, где 4 самый лёгкий. Для N4 нужны оба уровня:
 * kanjiByJlpt("N5") и kanjiByJlpt("N4"), вместе 284 иероглифа.
 *
 * @param {"N5"|"N4"|"N2"|"N1"} level
 * @returns {any[]}
 */
export function kanjiByJlpt(level) {
  return store.kanji.filter((k) => k.jlpt === level);
}

/** Сводка о загруженном контенте — для стартового экрана и проверок. */
export function contentStats() {
  const n5 = kanjiByJlpt("N5");
  const n4 = kanjiByJlpt("N4");
  const withRu = (arr) => arr.filter((k) => k.meaning_ru).length;
  return {
    words: store.words.length,
    kanji: store.kanji.length,
    kanjiN5: n5.length,
    kanjiN4: n4.length,
    kanjiN5WithRussian: withRu(n5),
    kanjiN4WithRussian: withRu(n4),
    linkedKanji: Object.keys(store.links).length,
  };
}
