/**
 * Тесты выбора грани. Зона агента A.
 *
 * Запуск: node --test tests/
 *
 * Правило то же, что в srs.test.js: тест защищает решение, а не фиксирует
 * число, которое случайно вернула функция. Источник случайности везде
 * подменён — иначе выбор грани нечем закрыть.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { Balance } from "../src/core/balance.js";
import { Facet } from "../src/core/types.js";
import { createProgress, pickFacet } from "../src/core/srs.js";

/** Единица с открытыми дополнительными гранями и заданной статистикой. */
const unitWith = (writing, usage) => {
  const p = createProgress("w1", "word", 0);
  p.facets[Facet.WRITING] = { ...writing, unlocked: true };
  p.facets[Facet.USAGE] = { ...usage, unlocked: true };
  return p;
};

/** Розыгрыш ниже доли дополнительных — выбор уходит в них. */
const SECONDARY = () => 0;
/** Розыгрыш ровно на границе доли — выбор остаётся на основной. */
const MAIN = () => Balance.SECONDARY_FACET_SHARE;

test("пока дополнительные грани закрыты, спрашивается только основная", () => {
  // Защищает решение заказчика: слово сначала осваивается по одной стороне,
  // остальное нарастает вокруг уже знакомого.
  const p = createProgress("w1", "word", 0);
  for (const k of [0, 0.25, 0.5, 0.99, 1, 2]) {
    assert.equal(
      pickFacet(p, () => Balance.SECONDARY_FACET_SHARE * k),
      Facet.MEANING,
      "дополнительная грань спрошена до открытия",
    );
  }
});

test("закрытая грань не спрашивается, даже будучи ни разу не показанной", () => {
  // Защищает порядок открытия: приоритет «ни разу не спрашивали» не имеет
  // права протащить в показ ещё не открытую грань.
  const p = createProgress("w1", "word", 0);
  p.facets[Facet.WRITING] = { correct: 9, total: 9, unlocked: true };
  // USAGE остаётся закрытой с нулевой статистикой — самая «голодная» по правилу
  for (let i = 0; i <= 20; i += 1) {
    assert.notEqual(pickFacet(p, () => i / 20), Facet.USAGE, "спрошена закрытая грань");
  }
});

test("доля дополнительных граней берётся из SECONDARY_FACET_SHARE", () => {
  // Защищает правило проекта: параметр, влияющий на нагрузку, живёт
  // в balance.js, а не в коде модуля — иначе его не подобрать.
  const p = unitWith({ correct: 1, total: 2 }, { correct: 1, total: 2 });
  const steps = 1000;
  let secondary = 0;
  // равномерная сетка вместо случайности: доля получается точной, а не «примерно»
  for (let i = 0; i < steps; i += 1) {
    if (pickFacet(p, () => i / steps) !== Facet.MEANING) secondary += 1;
  }
  assert.equal(secondary / steps, Balance.SECONDARY_FACET_SHARE);
});

test("ни разу не спрошенная грань важнее самой проваленной", () => {
  // Защищает приоритет неизвестного: про грань с total === 0 не известно
  // ничего, и это важнее, чем уточнять уже измеренное.
  const unseenUsage = unitWith({ correct: 0, total: 20 }, { correct: 0, total: 0 });
  assert.equal(pickFacet(unseenUsage, SECONDARY), Facet.USAGE);

  const unseenWriting = unitWith({ correct: 0, total: 0 }, { correct: 0, total: 20 });
  assert.equal(pickFacet(unseenWriting, SECONDARY), Facet.WRITING);
});

test("из открытых дополнительных выбирается та, что отвечалась хуже", () => {
  // Защищает смысл выбора: показы уходят туда, где знание слабее,
  // а не поровну и не по порядку объявления граней.
  const weakWriting = unitWith({ correct: 1, total: 10 }, { correct: 8, total: 10 });
  assert.equal(pickFacet(weakWriting, SECONDARY), Facet.WRITING);

  const weakUsage = unitWith({ correct: 8, total: 10 }, { correct: 1, total: 10 });
  assert.equal(pickFacet(weakUsage, SECONDARY), Facet.USAGE);
});

test("при равном качестве выбирается грань, которую показывали реже", () => {
  // Защищает выравнивание охвата: одинаково освоенные грани не должны
  // расходиться по числу показов.
  const rareUsage = unitWith({ correct: 5, total: 10 }, { correct: 1, total: 2 });
  assert.equal(pickFacet(rareUsage, SECONDARY), Facet.USAGE);

  const rareWriting = unitWith({ correct: 1, total: 2 }, { correct: 5, total: 10 });
  assert.equal(pickFacet(rareWriting, SECONDARY), Facet.WRITING);
});

test("при полном равенстве выбор стабилен и от розыгрыша не зависит", () => {
  // Защищает воспроизводимость: розыгрыш в pickFacet ровно один, дальше
  // всё детерминировано — иначе поведение нечем закрыть тестом.
  const p = unitWith({ correct: 3, total: 6 }, { correct: 3, total: 6 });
  for (const k of [0, 0.25, 0.5, 0.75, 0.99]) {
    assert.equal(
      pickFacet(p, () => Balance.SECONDARY_FACET_SHARE * k),
      Facet.WRITING,
      "порядок разрешения полного равенства поехал",
    );
  }
});

test("на границе доли выбор возвращается к основной грани", () => {
  // Защищает саму долю: дополнительные забирают ровно SECONDARY_FACET_SHARE
  // показов, остальное остаётся у основной — интервал у единицы общий,
  // и грани делят показы, а не добавляют их.
  const p = unitWith({ correct: 0, total: 0 }, { correct: 0, total: 0 });
  assert.equal(pickFacet(p, MAIN), Facet.MEANING);
  assert.equal(pickFacet(p, SECONDARY), Facet.WRITING);
});
