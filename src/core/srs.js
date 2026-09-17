/**
 * Система интервальных повторений. Зона агента A.
 *
 * СТАТУС: заглушка с рабочей арифметикой интервалов и полными сигнатурами.
 * Агент A дописывает помеченное TODO и покрывает всё тестами.
 * Менять types.js и balance.js ему нельзя.
 *
 * @typedef {import("./types.js").UnitProgress} UnitProgress
 * @typedef {import("./types.js").AnswerResult} AnswerResult
 * @typedef {import("./types.js").FacetName} FacetName
 */

import { Balance } from "./balance.js";
import { Facet } from "./types.js";

/**
 * Создаёт запись прогресса для новой единицы.
 * @param {string} unitId
 * @param {"word"|"kanji"} kind
 * @param {number} day текущий игровой день
 * @returns {UnitProgress}
 */
export function createProgress(unitId, kind, day) {
  const facet = () => ({ correct: 0, total: 0, unlocked: false });
  return {
    unitId,
    kind,
    interval: 0,
    learningStep: 0,
    ease: Balance.START_EASE,
    dueDay: day,
    lapses: 0,
    lastLapseDay: -1,
    reps: 0,
    facets: {
      [Facet.MEANING]: { correct: 0, total: 0, unlocked: true },
      [Facet.WRITING]: facet(),
      [Facet.USAGE]: facet(),
    },
  };
}

/**
 * Применяет один ответ к прогрессу единицы.
 *
 * Вызывается на КАЖДЫЙ ответ игрока, независимо от того, доиграл ли он бой.
 * Это требование заказчика: незавершённый бой не должен терять результат.
 *
 * @param {UnitProgress} p
 * @param {AnswerResult} result
 * @param {number} day
 * @returns {UnitProgress} новая запись, исходная не изменяется
 */
export function applyAnswer(p, result, day) {
  const next = structuredClone(p);
  const stat = next.facets[result.facet];
  stat.total += 1;

  if (next.interval === 0) {
    if (result.correct) {
      stat.correct += 1;
      next.learningStep += 1;
      if (next.learningStep >= Balance.LEARNING_STEPS) {
        next.interval =
          next.lapses > 0
            ? Balance.GRADUATING_INTERVAL_AFTER_LAPSE_DAYS
            : Balance.GRADUATING_INTERVAL_DAYS;
        next.dueDay = day + next.interval;
        next.learningStep = 0;
      } else {
        next.dueDay = day;
      }
    } else {
      stat.correct = 0;
      next.learningStep = 0;
      next.lapses += 1;
      next.lastLapseDay = day;
      next.ease = Math.max(Balance.MIN_EASE, next.ease - Balance.EASE_PENALTY);
      next.dueDay = day;
    }
  } else {
    if (result.correct) {
      stat.correct += 1;
      next.interval = growInterval(next.interval, next.ease);
      next.dueDay = day + next.interval;
    } else {
      stat.correct = 0;
      next.lapses += 1;
      next.lastLapseDay = day;
      next.ease = Math.max(Balance.MIN_EASE, next.ease - Balance.EASE_PENALTY);
      next.interval = Math.max(1, Math.round(next.interval * Balance.LAPSE_MULTIPLIER));
      next.dueDay = day + next.interval;
    }
  }

  next.reps += 1;
  unlockFacets(next);
  return next;
}

/**
 * Рост интервала при успехе.
 *
 * Нижняя граница «не меньше чем на день» обязательна: без неё единица
 * с низким ease залипает на интервале в сутки навсегда и очередь растёт
 * бесконечно. Это проверено на модели, см. docs/balance-report.md.
 *
 * @param {number} interval
 * @param {number} ease
 * @returns {number}
 */
export function growInterval(interval, ease) {
  const base = Math.max(interval, 1);
  const grown = Math.max(
    Math.round(base * ease),
    base + Balance.MIN_INTERVAL_GROWTH_DAYS,
  );
  return Math.min(grown, Balance.MAX_INTERVAL_DAYS);
}

/**
 * Открывает дополнительные грани, когда основная освоена.
 * Заказчик: сначала кана и перевод на уровне «хорошо», потом всё остальное.
 * @param {UnitProgress} p
 */
export function unlockFacets(p) {
  const main = p.facets[Facet.MEANING];
  if (main.correct >= Balance.FACET_UNLOCK_THRESHOLD) {
    p.facets[Facet.WRITING].unlocked = true;
    p.facets[Facet.USAGE].unlocked = true;
  }
}

/**
 * Выбирает грань для показа.
 *
 * Пока дополнительные грани закрыты, спрашивается только основная: решение
 * заказчика — сначала слово осваивается по одной стороне, остальное нарастает
 * вокруг уже знакомого.
 *
 * @param {UnitProgress} p
 * @param {() => number} [rnd] источник случайности; в тестах подменяется
 * @returns {FacetName}
 */
export function pickFacet(p, rnd = Math.random) {
  // порядок списка задаёт разрешение полного равенства: сначала WRITING
  const extra = [Facet.WRITING, Facet.USAGE].filter((f) => p.facets[f].unlocked);
  if (extra.length === 0) return Facet.MEANING;

  // Розыгрыш ровно один на вызов: дальше выбор детерминированный, иначе
  // при подменённом источнике случайности результат перестаёт быть
  // воспроизводимым и тестом не закрывается.
  if (rnd() >= Balance.SECONDARY_FACET_SHARE) return Facet.MEANING;

  return extra.reduce((worst, f) =>
    needsDrillMore(p.facets[f], p.facets[worst]) ? f : worst,
  );
}

/**
 * Какая из двух граней сильнее нуждается в показе.
 *
 * Ни разу не спрошенная идёт первой: отношение correct к total у неё не
 * определено, а узнать про неё нужно раньше, чем уточнять уже измеренное.
 * Сравнение строгое — при равенстве побеждает та, что пришла раньше,
 * и выбор остаётся предсказуемым.
 *
 * @param {import("./types.js").FacetStat} a
 * @param {import("./types.js").FacetStat} b
 * @returns {boolean} true, если a нуждается в показе строго сильнее b
 */
function needsDrillMore(a, b) {
  if (a.total === 0 || b.total === 0) {
    if (a.total === b.total) return false;
    return a.total === 0;
  }
  const qualityA = a.correct / a.total;
  const qualityB = b.correct / b.total;
  if (qualityA !== qualityB) return qualityA < qualityB;  // хуже отвечалась
  return a.total < b.total;                               // при равном качестве — та, что реже показывалась
}

/**
 * Единица считается ветераном по СКОЛЬЗЯЩЕМУ признаку.
 * Накопительный («срывалась когда-либо дважды») не годится: к середине игры
 * вся армия станет ветеранами навсегда и третья волна потеряет смысл.
 * @param {UnitProgress} p
 * @param {number} day
 * @returns {boolean}
 */
export function isVeteran(p, day) {
  const recentLapse =
    p.lastLapseDay >= 0 && day - p.lastLapseDay <= Balance.VETERAN_WINDOW_DAYS;
  return recentLapse || p.ease < Balance.VETERAN_EASE_THRESHOLD;
}
