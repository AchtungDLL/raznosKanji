import test from "node:test";
import assert from "node:assert/strict";

import { Balance } from "../src/core/balance.js";
import { createProgress } from "../src/core/srs.js";
import { newQuota, forecast } from "../src/core/scheduler.js";

test("квота новых слов выдаётся полностью при отсутствии долга", () => {
  const progress = {};
  const day = 5;
  const quota = newQuota(progress, day, 8);
  assert.equal(quota, 8);
});

test("квота новых слов обнуляется при превышении порога долга BACKLOG_PAUSE_THRESHOLD", () => {
  const progress = {};
  const day = 10;
  // Создаём 125 просроченных единиц
  for (let i = 0; i < 125; i += 1) {
    const p = createProgress(`overdue_${i}`, "word", 0);
    p.interval = 1;
    p.dueDay = 5; // просрочено относительно дня 10
    progress[p.unitId] = p;
  }
  const quota = newQuota(progress, day, 8);
  assert.equal(quota, 0, "при долге >= 120 квота обязана быть 0");
});

test("квота плавно уменьшается в мягкой зоне завала", () => {
  const progress = {};
  const day = 10;
  // Порог мягкой зоны: 60, пауза: 120. Ровно посередине: 90.
  for (let i = 0; i < 90; i += 1) {
    const p = createProgress(`overdue_${i}`, "word", 0);
    p.interval = 1;
    p.dueDay = 5;
    progress[p.unitId] = p;
  }
  const quota = newQuota(progress, day, 10);
  assert.ok(quota > 0 && quota < 10, "квота должна быть урезана пропорционально");
  assert.equal(quota, 5); // ровно половина от 10
});

test("прогноз советника не мутирует переданный прогресс", () => {
  const progress = {};
  const p = createProgress("w1", "word", 1);
  p.interval = 3;
  p.dueDay = 2;
  progress.w1 = p;

  const originalCopy = structuredClone(progress);
  const result = forecast(progress, 1, 8);

  assert.deepEqual(progress, originalCopy, "progress не должен мутироваться");
  assert.equal(result.inDays, Balance.FORECAST_HORIZON_DAYS);
  assert.ok(result.expectedUnits >= 0);
  assert.ok(result.expectedMinutes >= 0);
});
