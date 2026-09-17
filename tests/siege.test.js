import test from "node:test";
import assert from "node:assert/strict";

import { Balance } from "../src/core/balance.js";
import { Facet } from "../src/core/types.js";
import { createProgress, applyAnswer } from "../src/core/srs.js";
import { buildSiege, newQuota, forecast } from "../src/core/scheduler.js";
import { startBattleSession, getCurrentQuestion, submitAnswer } from "../src/ui/battle.js";

/**
 * Вспомогательный генератор слов для тестов
 */
function makeWords(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `w${i + 1}`,
    word: `単語${i + 1}`,
    reading: `たんご${i + 1}`,
    meaning_ru: `слово ${i + 1}`,
    type: "word",
    sentence: `例文 ${i + 1}`,
    sentence_ru: `Пример ${i + 1}`,
  }));
}

test("buildSiege правильно распределяет единицы по трём когортам", () => {
  const day = 10;
  const progress = {};

  // w1: interval=40, dueDay=100 (зрелая вне срока, не ветеран) -> пехота
  let p1 = createProgress("w1", "word", 0);
  p1.interval = 40;
  p1.dueDay = 100;
  progress["w1"] = p1;

  // w2: interval=5, dueDay=10 (подошёл срок, не ветеран) -> офицеры
  let p2 = createProgress("w2", "word", 0);
  p2.interval = 5;
  p2.dueDay = 10;
  p2.lapses = 0;
  progress["w2"] = p2;

  // w3: interval=3, dueDay=10 (подошёл срок, ветеран) -> ветераны
  let p3 = createProgress("w3", "word", 0);
  p3.interval = 3;
  p3.dueDay = 10;
  p3.lastLapseDay = 9;
  progress["w3"] = p3;

  const siege = buildSiege(progress, day);
  assert.ok(siege.infantry.includes("w1"));
  assert.ok(siege.officers.includes("w2"));
  assert.ok(siege.veterans.includes("w3"));
});

test("startBattleSession и getCurrentQuestion соблюдают последовательность волн", async () => {
  const words = makeWords(20);
  const day = 5;
  const progress = {};

  // Пехота: зрелая единица с большим сроком
  let pInf = createProgress("w1", "word", 0);
  pInf.interval = 40;
  pInf.dueDay = day + 100;
  progress["w1"] = pInf;

  // Офицер
  let pOff = createProgress("w2", "word", 0);
  pOff.interval = 4;
  pOff.dueDay = day;
  progress["w2"] = pOff;

  // Ветеран
  let pVet = createProgress("w3", "word", 0);
  pVet.interval = 2;
  pVet.dueDay = day;
  pVet.lastLapseDay = day - 1;
  progress["w3"] = pVet;

  const save = {
    version: 1,
    createdAt: Date.now(),
    currentDay: day,
    dayRollsOverAtHour: 4,
    settings: {
      newPerDay: 2,
      battleLength: 10,
    },
    progress,
    session: null,
  };

  const session = await startBattleSession(save, words);
  assert.ok(session);

  // Проверяем первый вопрос - пехота
  const q1 = getCurrentQuestion(save, words);
  assert.equal(q1.stage, "infantry");
  assert.ok(q1.stageTitle.includes("Пехота"));

  // Отвечаем на пехоту
  await submitAnswer(save, q1.unitId, q1.word, q1.expected, q1.expected, 1000);

  // Следующий вопрос - офицеры
  const q2 = getCurrentQuestion(save, words);
  assert.equal(q2.stage, "officers");
  assert.ok(q2.stageTitle.includes("Офицеры"));

  // Отвечаем на офицера
  await submitAnswer(save, q2.unitId, q2.word, q2.expected, q2.expected, 1000);

  // Следующий вопрос - ветераны
  const q3 = getCurrentQuestion(save, words);
  assert.equal(q3.stage, "veterans");
  assert.ok(q3.stageTitle.includes("Ветераны"));

  // Отвечаем на ветерана
  await submitAnswer(save, q3.unitId, q3.word, q3.expected, q3.expected, 1000);

  // Следующий вопрос - новые слова (пополнение)
  const q4 = getCurrentQuestion(save, words);
  assert.equal(q4.stage, "new");
  assert.ok(q4.stageTitle.includes("Пополнение"));
});
