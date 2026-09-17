/**
 * Логика захода (боя). Зона агента B.
 *
 * Отвечает за:
 * - формирование пула вопросов (новые единицы по newQuota + повторения);
 * - генерацию вариантов ответов (1 верный + 3 дистрактора из других слов);
 * - передачу ответа в ядро через applyAnswer;
 * - немедленное сохранение каждого ответа в IndexedDB;
 * - управление сессией (продолжить, сдаться, завершить).
 *
 * @typedef {import("../core/types.js").SaveFile} SaveFile
 * @typedef {import("../core/types.js").DaySession} DaySession
 * @typedef {import("../core/types.js").WordUnit} WordUnit
 */

import { Balance } from "../core/balance.js";
import { Facet, Wave } from "../core/types.js";
import { createProgress, applyAnswer } from "../core/srs.js";
import { buildSiege, newQuota } from "../core/scheduler.js";
import { saveToDb } from "./db.js";

/**
 * Подбирает 3 неверных варианта перевода из других слов.
 * @param {WordUnit[]} allWords
 * @param {WordUnit} currentWord
 * @param {number} [count=3]
 * @returns {string[]}
 */
export function pickDistractors(allWords, currentWord, count = 3) {
  const currentMeaning = currentWord.meaning_ru.trim().toLowerCase();
  const used = new Set([currentMeaning]);
  const distractors = [];

  // Случайная выборка из всех слов
  const pool = [...allWords];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  for (const w of pool) {
    if (!w.meaning_ru) continue;
    const m = w.meaning_ru.trim().toLowerCase();
    if (!used.has(m)) {
      used.add(m);
      distractors.push(w.meaning_ru.trim());
      if (distractors.length >= count) break;
    }
  }

  return distractors;
}

/**
 * Перемешивает массив.
 * @template T
 * @param {T[]} array
 * @returns {T[]}
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Запускает новый заход (сессию боя).
 * Включает новые единицы по newQuota и повторения.
 *
 * @param {SaveFile} save
 * @param {WordUnit[]} allWords
 * @returns {Promise<DaySession>}
 */
export async function startBattleSession(save, allWords) {
  const day = save.currentDay;

  // Формируем осаду по ядру: пехота, офицеры, ветераны
  const siege = buildSiege(save.progress, day);

  // Новые единицы на сегодня по квоте
  const quota = newQuota(
    save.progress,
    day,
    save.settings.newPerDay || Balance.NEW_PER_DAY_DEFAULT,
  );

  const existingIds = new Set(Object.keys(save.progress));
  const newUnitIds = [];

  if (quota > 0) {
    for (const w of allWords) {
      if (!existingIds.has(w.id)) {
        save.progress[w.id] = createProgress(w.id, "word", day);
        newUnitIds.push(w.id);
        existingIds.add(w.id);
        if (newUnitIds.length >= quota) break;
      }
    }
  }

  // Собираем любые единицы, которые уже в изучении (interval === 0)
  const existingLearningIds = Object.keys(save.progress).filter(
    (id) => save.progress[id].interval === 0 && !newUnitIds.includes(id),
  );
  const learningQueue = [...newUnitIds, ...existingLearningIds];

  // Определяем начальную непустую стадию:
  // 1. Пехота (разгон)
  // 2. Офицеры (очередь на сегодня)
  // 3. Ветераны (трудное)
  // 4. Пополнение (новые единицы)
  let initialStage = "infantry";
  let initialWave = Wave.INFANTRY;
  let initialRemaining = [...siege.infantry];

  if (initialRemaining.length === 0) {
    initialStage = "officers";
    initialWave = Wave.OFFICERS;
    initialRemaining = [...siege.officers];
  }
  if (initialRemaining.length === 0) {
    initialStage = "veterans";
    initialWave = Wave.VETERANS;
    initialRemaining = [...siege.veterans];
  }
  if (initialRemaining.length === 0) {
    initialStage = "new";
    initialWave = Wave.OFFICERS;
    initialRemaining = [...learningQueue];
  }

  /** @type {DaySession} */
  const session = {
    day,
    currentWave: initialWave,
    stage: initialStage,
    remaining: initialRemaining,
    queue: {
      infantry: [...siege.infantry],
      officers: [...siege.officers],
      veterans: [...siege.veterans],
      newUnits: [...learningQueue],
    },
    stamina: Balance.STAMINA_START,
    answered: 0,
    correct: 0,
    surrendered: false,
  };

  save.session = session;
  await saveToDb(save);
  return session;
}

/**
 * Возвращает текущий вопрос захода.
 * Проводит игрока строго по волнам осады: пехота -> офицеры -> ветераны -> новые единицы.
 * Если материал кончился или достигнут лимит захода, возвращает null.
 *
 * @param {SaveFile} save
 * @param {WordUnit[]} allWords
 * @returns {{ unitId: string, word: WordUnit, prompt: string, expected: string, options: string[], wave: string, stage: string, stageTitle: string, remainingInStage: number } | null}
 */
export function getCurrentQuestion(save, allWords) {
  const session = save.session;
  if (!session || session.surrendered) return null;

  const maxLen = save.settings.battleLength || Balance.BATTLE_LENGTH_DEFAULT;
  if (session.answered >= maxLen) {
    return null; // лимит захода исчерпан
  }

  if (!session.stage) {
    session.stage = session.currentWave || "officers";
  }

  // Переход между волнами при опустошении текущей очереди
  while (!session.remaining || session.remaining.length === 0) {
    if (session.stage === "infantry") {
      session.stage = "officers";
      session.currentWave = Wave.OFFICERS;
      session.remaining = session.queue?.officers ? [...session.queue.officers] : [];
    } else if (session.stage === "officers") {
      session.stage = "veterans";
      session.currentWave = Wave.VETERANS;
      session.remaining = session.queue?.veterans ? [...session.queue.veterans] : [];
    } else if (session.stage === "veterans") {
      session.stage = "new";
      session.currentWave = Wave.OFFICERS;
      session.remaining = session.queue?.newUnits ? [...session.queue.newUnits] : [];
    } else {
      // Все стадии осады и новые единицы пройдены — материал кончился!
      return null;
    }
  }

  if (!session.remaining || session.remaining.length === 0) {
    return null;
  }

  const unitId = session.remaining[0];
  const word = allWords.find((w) => w.id === unitId);
  if (!word) {
    session.remaining.shift();
    return getCurrentQuestion(save, allWords);
  }

  const distractors = pickDistractors(allWords, word, 3);
  const options = shuffle([word.meaning_ru.trim(), ...distractors]);

  const STAGE_TITLES = {
    infantry: "Волна 1: Пехота · Разгон",
    officers: "Волна 2: Офицеры · Очередь на сегодня",
    veterans: "Волна 3: Ветераны · Трудное",
    new: "Пополнение · Новые слова",
  };

  return {
    unitId: word.id,
    word,
    prompt: word.reading,
    expected: word.meaning_ru.trim(),
    options,
    wave: session.currentWave,
    stage: session.stage,
    stageTitle: STAGE_TITLES[session.stage] || "Осада",
    remainingInStage: session.remaining.length,
  };
}

/**
 * Обрабатывает ответ игрока.
 * Немедленно передаёт результат в ядро через applyAnswer
 * и сохраняет обновлённое состояние в IndexedDB.
 *
 * @param {SaveFile} save
 * @param {string} unitId
 * @param {WordUnit} word
 * @param {string} selectedMeaning
 * @param {string} expectedMeaning
 * @param {number} elapsedMs
 * @returns {Promise<{ isCorrect: boolean, expected: string, word: WordUnit, answered: number, correct: number, total: number }>}
 */
export async function submitAnswer(
  save,
  unitId,
  word,
  selectedMeaning,
  expectedMeaning,
  elapsedMs,
) {
  const isCorrect =
    selectedMeaning.trim().toLowerCase() === expectedMeaning.trim().toLowerCase();

  // 1. Немедленно отдаём ответ в ядро
  const result = {
    unitId,
    facet: Facet.MEANING,
    correct: isCorrect,
    elapsedMs,
  };

  if (!save.progress[unitId]) {
    save.progress[unitId] = createProgress(unitId, "word", save.currentDay);
  }

  save.progress[unitId] = applyAnswer(
    save.progress[unitId],
    result,
    save.currentDay,
  );

  // 2. Обновляем сессию захода
  const session = save.session;
  if (session) {
    session.answered += 1;
    if (isCorrect) {
      session.correct = (session.correct || 0) + 1;
    }
    // Убираем отвеченный вопрос из головы очереди
    if (session.remaining && session.remaining.length > 0) {
      session.remaining.shift();
    }
    // В фазе изучения новых единиц (stage === "new"):
    // если единица ещё не выпустилась (interval === 0), она остаётся в сегодняшней очереди
    if (session.stage === "new") {
      const p = save.progress[unitId];
      if (p && p.interval === 0) {
        session.remaining.push(unitId);
      }
    }
  }

  // 3. Немедленно сохраняем в IndexedDB
  await saveToDb(save);

  const maxLen = save.settings.battleLength || Balance.BATTLE_LENGTH_DEFAULT;

  return {
    isCorrect,
    expected: expectedMeaning,
    word,
    answered: session ? session.answered : 0,
    correct: session ? session.correct || 0 : 0,
    total: maxLen,
  };
}

/**
 * Игрок сдаётся в бою. Завершает текущий заход.
 * Сохранение немедленно обновляется.
 *
 * @param {SaveFile} save
 * @returns {Promise<void>}
 */
export async function surrenderBattle(save) {
  if (save.session) {
    save.session.surrendered = true;
    await saveToDb(save);
  }
}

/**
 * Завершает заход по достижении лимита.
 * @param {SaveFile} save
 * @returns {Promise<void>}
 */
export async function finishBattleSession(save) {
  save.session = null;
  await saveToDb(save);
}
