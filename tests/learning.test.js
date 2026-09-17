import test from "node:test";
import assert from "node:assert/strict";

import { Balance } from "../src/core/balance.js";
import { Facet } from "../src/core/types.js";
import { createProgress, applyAnswer } from "../src/core/srs.js";

function answer(unitId, facet, correct) {
  return { unitId, facet, correct, elapsedMs: 3000 };
}

test("единица после одного верного ответа остаётся в изучении", () => {
  const day = 1;
  let p = createProgress("w1", "word", day);
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), day);

  assert.equal(p.interval, 0, "интервал должен оставаться 0");
  assert.equal(p.learningStep, 1, "шаг изучения должен быть 1");
  assert.equal(p.dueDay, day, "dueDay должен остаться равным day");
  assert.equal(p.lapses, 0);
});

test("новая единица после двух верных ответов подряд выходит из изучения с интервалом в 1 день", () => {
  const day = 1;
  let p = createProgress("w1", "word", day);
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), day);
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), day);

  assert.equal(p.interval, Balance.GRADUATING_INTERVAL_DAYS, "выпускной интервал");
  assert.equal(p.dueDay, day + Balance.GRADUATING_INTERVAL_DAYS, "dueDay должен быть на следующий день");
  assert.equal(p.learningStep, 0, "learningStep сбрасывается в 0");
  assert.equal(p.lapses, 0);
});

test("ответ верно — неверно — верно — верно даёт выпуск с lapses === 1", () => {
  const day = 1;
  let p = createProgress("w1", "word", day);
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), day);
  assert.equal(p.learningStep, 1);

  // Срыв в изучении
  p = applyAnswer(p, answer("w1", Facet.MEANING, false), day);
  assert.equal(p.interval, 0);
  assert.equal(p.learningStep, 0, "ошибка сбрасывает шаг изучения");
  assert.equal(p.lapses, 1);
  assert.equal(p.dueDay, day);
  assert.equal(p.lastLapseDay, day);

  // Шаг 1 после срыва
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), day);
  assert.equal(p.interval, 0);
  assert.equal(p.learningStep, 1);
  assert.equal(p.dueDay, day);

  // Шаг 2 после срыва — выпуск
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), day);
  assert.equal(p.interval, Balance.GRADUATING_INTERVAL_AFTER_LAPSE_DAYS);
  assert.equal(p.dueDay, day + Balance.GRADUATING_INTERVAL_AFTER_LAPSE_DAYS);
  assert.equal(p.learningStep, 0);
  assert.equal(p.lapses, 1);
});

test("ошибка в изучении снижает ease, но не ниже MIN_EASE", () => {
  const day = 1;
  let p = createProgress("w1", "word", day);
  const startEase = p.ease;
  p = applyAnswer(p, answer("w1", Facet.MEANING, false), day);
  assert.equal(p.ease, startEase - Balance.EASE_PENALTY);

  // Много ошибок подряд
  for (let i = 0; i < 20; i += 1) {
    p = applyAnswer(p, answer("w1", Facet.MEANING, false), day);
  }
  assert.equal(p.ease, Balance.MIN_EASE, "ease не должен падать ниже пола");
  assert.equal(p.interval, 0, "интервал остаётся 0");
});
