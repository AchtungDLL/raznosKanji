/**
 * Тесты ядра. Образец для агента A: так выглядит проверка, которой я верю.
 *
 * Запуск: node --test tests/
 *
 * Правило: тест проверяет ПОВЕДЕНИЕ и его причину, а не то, что функция
 * возвращает какое-то число. Каждый тест здесь защищает решение, принятое
 * в спецификации или в расчёте баланса.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { Balance } from "../src/core/balance.js";
import { Facet } from "../src/core/types.js";
import {
  createProgress,
  applyAnswer,
  growInterval,
  isVeteran,
} from "../src/core/srs.js";
import { buildSiege } from "../src/core/scheduler.js";

const answer = (unitId, facet, correct) => ({ unitId, facet, correct, elapsedMs: 3000 });

test("интервал всегда растёт минимум на день", () => {
  // Защищает от залипания: единица с низким ease при чистом умножении
  // остаётся на интервале в сутки навсегда, и очередь растёт бесконечно.
  for (const ease of [1.3, 1.5, 2.5]) {
    for (const interval of [1, 2, 5, 30]) {
      assert.ok(
        growInterval(interval, ease) > interval,
        `интервал ${interval} при ease ${ease} не вырос`,
      );
    }
  }
});

test("интервал не превышает потолок", () => {
  assert.equal(growInterval(300, 2.5), Balance.MAX_INTERVAL_DAYS);
});

test("ошибка снижает ease, но не ниже пола", () => {
  let p = createProgress("w1", "word", 0);
  for (let i = 0; i < 20; i += 1) {
    p = applyAnswer(p, answer("w1", Facet.MEANING, false), i);
  }
  assert.equal(p.ease, Balance.MIN_EASE);
});

test("дополнительные грани закрыты, пока основная не освоена", () => {
  let p = createProgress("w1", "word", 0);
  assert.equal(p.facets[Facet.WRITING].unlocked, false);

  for (let i = 0; i < Balance.FACET_UNLOCK_THRESHOLD - 1; i += 1) {
    p = applyAnswer(p, answer("w1", Facet.MEANING, true), i);
  }
  assert.equal(
    p.facets[Facet.WRITING].unlocked,
    false,
    "открылись раньше порога",
  );

  p = applyAnswer(p, answer("w1", Facet.MEANING, true), 5);
  assert.equal(p.facets[Facet.WRITING].unlocked, true);
  assert.equal(p.facets[Facet.USAGE].unlocked, true);
});

test("ошибка по основной грани сбрасывает серию", () => {
  let p = createProgress("w1", "word", 0);
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), 0);
  p = applyAnswer(p, answer("w1", Facet.MEANING, true), 1);
  p = applyAnswer(p, answer("w1", Facet.MEANING, false), 2);
  assert.equal(p.facets[Facet.MEANING].correct, 0);
});

test("признак ветерана скользящий, а не накопительный", () => {
  // Накопительный признак делает всю армию ветеранами навсегда —
  // третья волна теряет смысл к середине игры.
  let p = createProgress("w1", "word", 0);
  p = applyAnswer(p, answer("w1", Facet.MEANING, false), 10);
  assert.ok(isVeteran(p, 12), "сразу после срыва должна быть ветераном");

  p.ease = Balance.START_EASE;                      // ease восстановили вручную
  const later = 10 + Balance.VETERAN_WINDOW_DAYS + 1;
  assert.equal(
    isVeteran(p, later),
    false,
    "через три недели без срывов ветераном быть перестаёт",
  );
});

test("первая волна берётся из резерва вне срока, а не из очереди", () => {
  // Главная находка расчёта: в очереди на сегодня лёгкого материала нет,
  // он приходит редко именно потому, что выучен.
  const progress = {};
  // зрелые вне срока — должны попасть в пехоту
  for (let i = 0; i < 30; i += 1) {
    const p = createProgress(`mature${i}`, "word", 0);
    p.interval = 40 + i;
    p.dueDay = 100;                                  // срок далеко впереди
    progress[p.unitId] = p;
  }
  // просроченные и проблемные — офицеры и ветераны
  for (let i = 0; i < 5; i += 1) {
    const p = createProgress(`due${i}`, "word", 0);
    p.interval = 3;
    p.dueDay = 10;
    progress[p.unitId] = p;
  }
  const vet = createProgress("vet1", "word", 0);
  vet.interval = 2;
  vet.dueDay = 10;
  vet.lastLapseDay = 9;
  progress.vet1 = vet;

  const siege = buildSiege(progress, 10);

  assert.equal(siege.infantry.length, Balance.INFANTRY_SIZE);
  assert.ok(
    siege.infantry.every((id) => id.startsWith("mature")),
    "в пехоту попало что-то кроме зрелого резерва",
  );
  assert.equal(siege.officers.length, 5);
  assert.deepEqual(siege.veterans, ["vet1"]);
});

test("незавершённый бой не теряет ответы", () => {
  // Требование заказчика: каждый ответ пишется сразу, независимо от того,
  // доиграл ли игрок до конца.
  //
  // Тест намеренно НЕ проверяет конкретное значение dueDay. Единица в фазе
  // изучения остаётся в сегодняшней очереди (dueDay === day) и получает
  // интервал только при выпуске — привязка теста к «dueDay больше нуля»
  // означала бы, что он защищает не сохранность ответа, а отсутствие фазы
  // изучения. Ровно на этом противоречии он однажды и сломался.
  const day = 0;
  let p = createProgress("w1", "word", day);
  const before = p.reps;

  p = applyAnswer(p, answer("w1", Facet.MEANING, true), day);

  assert.equal(p.reps, before + 1, "показ не засчитан");
  assert.equal(p.facets[Facet.MEANING].total, 1, "ответ не попал в счётчик грани");
  assert.ok(p.dueDay >= day, "срок следующего показа оказался в прошлом");
});
