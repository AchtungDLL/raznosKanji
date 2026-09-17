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
  const quota = newQuota(save.progress, day, save.settings.newPerDay);

  const existingIds = new Set(Object.keys(save.progress));
  const newUnitIds = [];

  // Добавляем новые единицы по квоте
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

  // Собираем повторения из осады
  const siege = buildSiege(save.progress, day);
  const siegeUnits = [
    ...siege.officers,
    ...siege.veterans,
    ...siege.infantry,
  ];

  // Объединяем новые единицы и повторения
  let pool = [...newUnitIds, ...siegeUnits];

  // Если пул пуст (всё выучено или день 0 без повторений), берём уже имеющиеся в прогрессе
  if (pool.length === 0) {
    pool = Object.keys(save.progress);
  }

  // Если совсем ничего нет в прогрессе, берём первые слова по частотности
  if (pool.length === 0) {
    const fallback = allWords.slice(0, save.settings.newPerDay);
    for (const w of fallback) {
      save.progress[w.id] = createProgress(w.id, "word", day);
      pool.push(w.id);
    }
  }

  // Перемешиваем пул для равномерного чередования
  pool = shuffle(pool);

  /** @type {DaySession} */
  const session = {
    day,
    currentWave: Wave.OFFICERS,
    remaining: pool,
    stamina: 100,
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
 * Если очередь опустела, но лимит захода не достигнут, пополняет очередь из прогресса.
 * Если заход завершён, возвращает null.
 *
 * @param {SaveFile} save
 * @param {WordUnit[]} allWords
 * @returns {{ unitId: string, word: WordUnit, prompt: string, expected: string, options: string[] } | null}
 */
export function getCurrentQuestion(save, allWords) {
  const session = save.session;
  if (!session || session.surrendered) return null;

  const maxLen = save.settings.battleLength || Balance.BATTLE_LENGTH_DEFAULT;
  if (session.answered >= maxLen) {
    return null; // лимит захода исчерпан
  }

  // Если единицы кончились, пополняем очередь единицами из прогресса для закрепления
  if (!session.remaining || session.remaining.length === 0) {
    let pool = Object.keys(save.progress);
    if (pool.length === 0) {
      pool = allWords.slice(0, 8).map((w) => w.id);
    }
    session.remaining = shuffle(pool);
  }

  const unitId = session.remaining[0];
  const word = allWords.find((w) => w.id === unitId);
  if (!word) {
    // Если по какой-то причине ID не найден в колоде, пропускаем
    session.remaining.shift();
    return getCurrentQuestion(save, allWords);
  }

  const distractors = pickDistractors(allWords, word, 3);
  const options = shuffle([word.meaning_ru.trim(), ...distractors]);

  return {
    unitId: word.id,
    word,
    prompt: word.reading,
    expected: word.meaning_ru.trim(),
    options,
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
    // При ошибке возвращаем единицу в хвост очереди для повторения в текущем заходе
    if (!isCorrect) {
      session.remaining.push(unitId);
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
