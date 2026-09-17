import test from "node:test";
import assert from "node:assert/strict";

import { Balance } from "../src/core/balance.js";
import { gameDayOf, nextRolloverMs } from "../src/core/day.js";

test("день создания игры считается днём первым (1)", () => {
  const created = new Date(2026, 8, 17, 12, 0, 0).getTime();
  assert.equal(gameDayOf(created, created), 1);

  // В тот же день вечером — всё ещё день 1
  const evening = new Date(2026, 8, 17, 23, 59, 0).getTime();
  assert.equal(gameDayOf(evening, created), 1);
});

test("граница четырёх утра: 03:59 относится к предыдущему дню, 04:01 к следующему", () => {
  // Игра создана в 12:00 дня 17 сентября
  const created = new Date(2026, 8, 17, 12, 0, 0).getTime();

  // Следующее утро, 18 сентября, 03:59 — это ещё день 1
  const at0359 = new Date(2026, 8, 18, 3, 59, 0).getTime();
  assert.equal(gameDayOf(at0359, created), 1, "03:59 обязано быть днём 1");

  // Ровно 04:00 — смена суток, день 2
  const at0400 = new Date(2026, 8, 18, 4, 0, 0).getTime();
  assert.equal(gameDayOf(at0400, created), 2, "04:00 обязано быть днём 2");

  // 04:01 — день 2
  const at0401 = new Date(2026, 8, 18, 4, 1, 0).getTime();
  assert.equal(gameDayOf(at0401, created), 2, "04:01 обязано быть днём 2");
});

test("игра создана до четырёх утра (в 02:00)", () => {
  // Создана в 02:00 17 сентября: её день 1 длится до 04:00 17 сентября
  const created = new Date(2026, 8, 17, 2, 0, 0).getTime();

  // В 03:59 того же утра — день 1
  const sameMorning = new Date(2026, 8, 17, 3, 59, 0).getTime();
  assert.equal(gameDayOf(sameMorning, created), 1);

  // В 04:01 того же утра — наступил день 2
  const nextMorning = new Date(2026, 8, 17, 4, 1, 0).getTime();
  assert.equal(gameDayOf(nextMorning, created), 2);
});

test("nextRolloverMs возвращает ближайшую смену суток в 04:00", () => {
  // В 03:59 сменится сегодня в 04:00
  const t1 = new Date(2026, 8, 17, 3, 59, 0).getTime();
  const next1 = new Date(nextRolloverMs(t1));
  assert.equal(next1.getDate(), 17);
  assert.equal(next1.getHours(), Balance.DAY_ROLLOVER_HOUR);
  assert.equal(next1.getMinutes(), 0);

  // В 04:01 сменится завтра в 04:00
  const t2 = new Date(2026, 8, 17, 4, 1, 0).getTime();
  const next2 = new Date(nextRolloverMs(t2));
  assert.equal(next2.getDate(), 18);
  assert.equal(next2.getHours(), Balance.DAY_ROLLOVER_HOUR);
  assert.equal(next2.getMinutes(), 0);

  // Ровно в 04:00 сменится завтра в 04:00
  const t3 = new Date(2026, 8, 17, 4, 0, 0).getTime();
  const next3 = new Date(nextRolloverMs(t3));
  assert.equal(next3.getDate(), 18);
  assert.equal(next3.getHours(), Balance.DAY_ROLLOVER_HOUR);
  assert.equal(next3.getMinutes(), 0);
});
