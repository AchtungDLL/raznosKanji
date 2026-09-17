/**
 * Вычисление игрового дня и момента смены суток. Зона агента A.
 *
 * Чистые функции, зависящие только от входных параметров.
 * Работают в локальном времени игрока, потому что осада должна обновляться
 * утром по его местным часам.
 */

import { Balance } from "./balance.js";

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

/**
 * Возвращает полуночный timestamp календарных суток для момента времени,
 * сдвинутого назад на Balance.DAY_ROLLOVER_HOUR часов.
 *
 * @param {number} timestampMs
 * @returns {number}
 */
function getEffectiveMidnightMs(timestampMs) {
  const shifted = new Date(timestampMs - Balance.DAY_ROLLOVER_HOUR * MS_PER_HOUR);
  return new Date(
    shifted.getFullYear(),
    shifted.getMonth(),
    shifted.getDate(),
  ).getTime();
}

/**
 * Возвращает номер игрового дня для указанного момента.
 * День первый (1) — тот, в который игра была создана.
 *
 * @param {number} timestampMs
 * @param {number} createdAtMs
 * @returns {number}
 */
export function gameDayOf(timestampMs, createdAtMs) {
  const currentMidnight = getEffectiveMidnightMs(timestampMs);
  const createdMidnight = getEffectiveMidnightMs(createdAtMs);
  const diffDays = Math.round((currentMidnight - createdMidnight) / MS_PER_DAY);
  return Math.max(1, 1 + diffDays);
}

/**
 * Возвращает момент ближайшей смены суток в миллисекундах.
 *
 * @param {number} timestampMs
 * @returns {number}
 */
export function nextRolloverMs(timestampMs) {
  const d = new Date(timestampMs);
  const todayRollover = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    Balance.DAY_ROLLOVER_HOUR,
    0,
    0,
    0,
  ).getTime();

  if (timestampMs < todayRollover) {
    return todayRollover;
  }

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + 1,
    Balance.DAY_ROLLOVER_HOUR,
    0,
    0,
    0,
  ).getTime();
}
