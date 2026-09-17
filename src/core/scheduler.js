/**
 * Формирование осады и потока новых единиц. Зона агента A.
 *
 * СТАТУС: рабочая разбивка на волны + заглушки прогноза.
 * Агент A дописывает TODO и покрывает тестами.
 *
 * @typedef {import("./types.js").UnitProgress} UnitProgress
 * @typedef {import("./types.js").WaveName} WaveName
 * @typedef {import("./types.js").LoadForecast} LoadForecast
 */

import { Balance } from "./balance.js";
import { Wave, Facet } from "./types.js";
import { isVeteran, applyAnswer, createProgress } from "./srs.js";

/**
 * Собирает состав осады на указанный день.
 *
 * Ключевое решение, не очевидное из замысла: первая волна берётся НЕ из
 * очереди повторений, а из резерва зрелых единиц, срок которых ещё не подошёл.
 *
 * Причина — в расчёте (docs/balance-report.md, находка 3). Честная очередь
 * SRS на 70-90 процентов состоит из трудного материала: единица с интервалом
 * в сто дней приходит раз в сто дней, а проблемная с интервалом в два —
 * каждые два. Лёгких в очереди почти нет именно потому, что они выучены.
 * Задуманный разгон в начале осады из неё не соберётся никогда.
 *
 * Цена решения: у подмешанных единиц слегка укоротится интервал, то есть
 * мы немного переучиваем уже известное. Резерв исчисляется сотнями, потеря
 * пренебрежимая.
 *
 * @param {Record<string, UnitProgress>} progress
 * @param {number} day
 * @returns {Record<WaveName, string[]>}
 */
export function buildSiege(progress, day) {
  /** @type {string[]} */ const officers = [];
  /** @type {string[]} */ const veterans = [];
  /** @type {UnitProgress[]} */ const reserve = [];

  for (const p of Object.values(progress)) {
    if (p.interval === 0) continue;               // ещё не выпущена из изучения
    const due = p.dueDay <= day;
    if (due) {
      if (isVeteran(p, day)) veterans.push(p.unitId);
      else officers.push(p.unitId);
    } else if (
      p.interval >= Balance.OFFICER_MAX_INTERVAL_DAYS + 7 &&
      !isVeteran(p, day)
    ) {
      reserve.push(p);                            // зрелая, вне срока, спокойная
    }
  }

  // из резерва берём самые зрелые: их интервал пострадает меньше всего
  reserve.sort((a, b) => b.interval - a.interval);
  const infantry = reserve.slice(0, Balance.INFANTRY_SIZE).map((p) => p.unitId);

  return {
    [Wave.INFANTRY]: infantry,
    [Wave.OFFICERS]: officers,
    [Wave.VETERANS]: veterans,
  };
}

/**
 * ГРАНИЦЫ ЗРЕЛОСТИ ДЛЯ ВЕРОЯТНОСТИ СРЫВА — ВРЕМЕННО ЗДЕСЬ, ЭТО ДЕФЕКТ.
 *
 * В balance.js заданы сами вероятности (FAIL_RATE_YOUNG / MIDDLE / MATURE),
 * но границы между ступенями — 7 и 21 день — существуют там только в тексте
 * комментариев, констант для них нет. Эти два числа прямо влияют на прогноз
 * нагрузки, то есть обязаны жить в balance.js вместе с остальным балансом.
 *
 * Менять balance.js исполнителю нельзя, поэтому границы объявлены одним местом
 * здесь и вынесены в отчёт вопросом: нужны FAIL_RATE_YOUNG_MAX_DAYS = 7
 * и FAIL_RATE_MIDDLE_MAX_DAYS = 21. Брать VETERAN_WINDOW_DAYS вместо второй
 * нельзя: там совпадает значение, но не смысл (дни с последнего срыва,
 * а не длина интервала), и связывать их означает ломать прогноз при первой же
 * правке признака ветерана.
 */
const YOUNG_MAX_DAYS = 7;
const MIDDLE_MAX_DAYS = 21;

/**
 * Вероятность «не вспомнил» — та же ступенчатая оценка, что в модели нагрузки
 * (tools/srs_load_sim.py). Советник обязан считать по ней, иначе он врёт.
 *
 * Надбавка за прошлые срывы ограничена сверху: без потолка единица, сорвавшаяся
 * десяток раз, получила бы вероятность срыва под единицу, и прогноз превратился
 * бы в бесконечный рост.
 *
 * @param {number} interval
 * @param {number} lapses
 * @returns {number}
 */
export function failRate(interval, lapses) {
  const base =
    interval < YOUNG_MAX_DAYS
      ? Balance.FAIL_RATE_YOUNG
      : interval < MIDDLE_MAX_DAYS
        ? Balance.FAIL_RATE_MIDDLE
        : Balance.FAIL_RATE_MATURE;
  return base + Balance.FAIL_RATE_LAPSE_STEP * Math.min(lapses, Balance.FAIL_RATE_LAPSE_CAP);
}

/**
 * Прогноз нагрузки для советника.
 *
 * Показывать игроку нужно не совет, а числа: рост очереди отложен на недели,
 * и увидеть его самостоятельно человек не может — в этом вся ловушка ползунка.
 * Поэтому считается честный прогон модели вперёд, а не оценка по формуле:
 * оценка «одна новая единица = один показ» занижает нагрузку в разы, потому
 * что не видит повторных приходов одной и той же единицы за горизонт.
 *
 * Возвращается нагрузка ОДНОГО дня — последнего дня горизонта, а не сумма
 * за горизонт: советник отвечает на вопрос «сколько будет каждое утро через
 * две недели».
 *
 * @param {Record<string, UnitProgress>} progress
 * @param {number} day
 * @param {number} newPerDay
 * @param {number} [horizon]
 * @param {() => number} [rnd] источник случайности; в тестах подменяется
 * @returns {LoadForecast}
 */
export function forecast(
  progress,
  day,
  newPerDay,
  horizon = Balance.FORECAST_HORIZON_DAYS,
  rnd = Math.random,
) {
  // Прогон идёт по копии: советник обязан быть безобидным для настоящего
  // прогресса, иначе взгляд на прогноз сдвинет игроку сроки повторений.
  const sim = structuredClone(progress);
  let introduced = 0;
  let shows = 0;

  for (let d = day + 1; d <= day + horizon; d += 1) {
    // Тот же отбор, что в buildSiege: interval === 0 — единица ещё не выпущена
    // из изучения и в осаду не идёт.
    const due = Object.values(sim).filter((p) => p.interval > 0 && p.dueDay <= d);
    shows = due.length;

    for (const p of due) {
      const recalled = rnd() >= failRate(p.interval, p.lapses);
      // Исход проводится тем же кодом, что и живой ответ игрока. Дублировать
      // здесь арифметику интервалов нельзя: при первой же правке srs.js
      // прогноз разошёлся бы с игрой молча.
      sim[p.unitId] = applyAnswer(
        p,
        { unitId: p.unitId, facet: Facet.MEANING, correct: recalled, elapsedMs: 0 },
        d,
      );
    }

    for (let i = 0; i < newPerDay; i += 1) {
      const id = `~forecast${introduced}`;
      introduced += 1;
      // kind на нагрузку не влияет: интервал у единицы один на все грани
      const fresh = createProgress(id, "word", d);
      fresh.interval = 1;       // шаги изучения пройдены в день ввода
      fresh.dueDay = d + 1;     // и спросится она завтра
      sim[id] = fresh;
    }
  }

  return {
    inDays: horizon,
    expectedUnits: shows,
    expectedMinutes: Math.round((shows * Balance.SECONDS_PER_ANSWER) / 60),
  };
}

/**
 * Сколько новых единиц выдать сегодня.
 *
 * Долг режет приток нового, потому что наказание за пропуск уже встроено в SRS:
 * три пропущенных дня увеличивают осаду в 2,3-3,5 раза (docs/balance-report.md,
 * находка 4). Высыпать поверх такого завала ещё и новые слова — та самая точка,
 * где бросают Anki и бросят эту игру.
 *
 * Режется именно вход: потолок на очередь повторений не убирает работу,
 * а превращает её в невидимый долг — за год до двух с половиной тысяч
 * карточек (находка 2).
 *
 * @param {Record<string, UnitProgress>} progress
 * @param {number} day текущий игровой день
 * @param {number} newPerDay
 * @returns {number}
 */
export function newQuota(progress, day, newPerDay) {
  let overdue = 0;
  for (const p of Object.values(progress)) {
    // dueDay === day — это сегодняшняя осада, она ещё не долг;
    // interval === 0 — единица не выпущена из изучения, просрочить её нельзя.
    if (p.interval > 0 && p.dueDay < day) overdue += 1;
  }

  if (overdue >= Balance.BACKLOG_PAUSE_THRESHOLD) return 0;
  if (overdue < Balance.BACKLOG_SOFT_THRESHOLD) return newPerDay;

  // Мягкая зона: от полного притока на нижнем пороге до нуля на верхнем.
  // Обрыв разом читался бы игроком как поломка, убывание — как последствие.
  const band = Balance.BACKLOG_PAUSE_THRESHOLD - Balance.BACKLOG_SOFT_THRESHOLD;
  const left = (Balance.BACKLOG_PAUSE_THRESHOLD - overdue) / band;
  return Math.max(0, Math.floor(newPerDay * left));
}
