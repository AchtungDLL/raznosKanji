/**
 * Главный контроллер интерфейса. Зона агента B.
 *
 * Координирует экраны:
 * - стартовый экран (лобби, статус, продолжить / в бой, экспорт, импорт);
 * - экран боя (вопрос, 4 плитки перевода, контекст, немедленная запись ответа).
 *
 * @typedef {import("../core/types.js").SaveFile} SaveFile
 * @typedef {import("../core/types.js").WordUnit} WordUnit
 */

import { loadContent, wordsByFrequency } from "../content/index.js";
import { Balance } from "../core/balance.js";
import { loadSave, saveToDb, exportSave, importSave } from "./db.js";
import {
  startBattleSession,
  getCurrentQuestion,
  submitAnswer,
  surrenderBattle,
  finishBattleSession,
} from "./battle.js";

/** @type {SaveFile} */
let currentSave;
/** @type {WordUnit[]} */
let allWords = [];
/** @type {any} */
let currentQuestion = null;
let questionStartTime = 0;
let isAnswered = false;

// DOM элементы
const elStartScreen = document.getElementById("screen-start");
const elBattleScreen = document.getElementById("screen-battle");
const elSummaryScreen = document.getElementById("screen-summary");

const elBtnStart = document.getElementById("btn-start");
const elBtnContinue = document.getElementById("btn-continue");
const elBtnSurrender = document.getElementById("btn-surrender");
const elBtnNext = document.getElementById("btn-next");
const elBtnFinishSummary = document.getElementById("btn-finish-summary");

const elBtnExport = document.getElementById("btn-export");
const elBtnImport = document.getElementById("btn-import");
const elFileInput = document.getElementById("input-import-file");

const elInterruptedBanner = document.getElementById("interrupted-banner");
const elInterruptedText = document.getElementById("interrupted-text");

const elStatDay = document.getElementById("stat-day");
const elStatWords = document.getElementById("stat-words");
const elStatDue = document.getElementById("stat-due");

const elBattleCounter = document.getElementById("battle-counter");
const elReadingPrompt = document.getElementById("reading-prompt");
const elOptionsContainer = document.getElementById("options-container");

const elContextBox = document.getElementById("context-box");
const elFullWord = document.getElementById("full-word");
const elFullReading = document.getElementById("full-reading");
const elFullMeaning = document.getElementById("full-meaning");
const elSentence = document.getElementById("sentence");
const elSentenceRu = document.getElementById("sentence-ru");

const elSummaryAnswered = document.getElementById("summary-answered");
const elSummaryCorrect = document.getElementById("summary-correct");
const elSummaryPercent = document.getElementById("summary-percent");

/**
 * Переключает отображаемый экран.
 * @param {"start"|"battle"|"summary"} screenName
 */
function switchScreen(screenName) {
  elStartScreen.classList.toggle("active", screenName === "start");
  elBattleScreen.classList.toggle("active", screenName === "battle");
  elSummaryScreen.classList.toggle("active", screenName === "summary");
}

/**
 * Подсчитывает число единиц, готовых к повторению на сегодня.
 * @param {SaveFile} save
 * @returns {number}
 */
function countDueUnits(save) {
  let count = 0;
  for (const p of Object.values(save.progress)) {
    if (p.interval > 0 && p.dueDay <= save.currentDay) {
      count += 1;
    }
  }
  return count;
}

/**
 * Проверяет, есть ли прерванный заход.
 * @param {SaveFile} save
 * @returns {boolean}
 */
function hasInterruptedSession(save) {
  const session = save.session;
  if (!session) return false;
  if (session.surrendered) return false;
  const maxLen = save.settings.battleLength || Balance.BATTLE_LENGTH_DEFAULT;
  return session.answered < maxLen;
}

/**
 * Отрисовывает стартовый экран.
 */
function renderStartScreen() {
  switchScreen("start");

  const day = currentSave.currentDay;
  elStatDay.textContent = String(day + 1); // Игровой день с 1 для удобства восприятия
  elStatWords.textContent = String(Object.keys(currentSave.progress).length);
  elStatDue.textContent = String(countDueUnits(currentSave));

  const interrupted = hasInterruptedSession(currentSave);
  if (interrupted) {
    const session = currentSave.session;
    const maxLen = currentSave.settings.battleLength || Balance.BATTLE_LENGTH_DEFAULT;
    const answered = session.answered;
    const correct = session.correct || 0;

    elInterruptedBanner.style.display = "block";
    elInterruptedText.textContent =
      `Прерванный заход: отвечено ${answered} из ${maxLen} · верно ${correct}`;
    elBtnContinue.style.display = "inline-flex";
    elBtnContinue.textContent = `Продолжить бой (${answered}/${maxLen})`;
    elBtnStart.textContent = "Начать заново";
  } else {
    elInterruptedBanner.style.display = "none";
    elBtnContinue.style.display = "none";
    elBtnStart.textContent = "В бой";
  }
}

/**
 * Запускает или продолжает заход.
 * @param {boolean} isResume
 */
async function startBattle(isResume = false) {
  if (!isResume) {
    await startBattleSession(currentSave, allWords);
  }
  switchScreen("battle");
  renderNextQuestion();
}

/**
 * Обновляет счётчик прогресса на экране боя.
 */
function updateCounter() {
  const session = currentSave.session;
  const answered = session ? session.answered : 0;
  const correct = session ? session.correct || 0 : 0;
  const total = currentSave.settings.battleLength || Balance.BATTLE_LENGTH_DEFAULT;
  elBattleCounter.textContent = `Отвечено: ${answered} / ${total} · Верно: ${correct}`;
}

/**
 * Отображает экран завершения захода.
 */
function showSummaryScreen() {
  switchScreen("summary");
  const session = currentSave.session;
  const answered = session ? session.answered : 0;
  const correct = session ? session.correct || 0 : 0;
  const pct = answered > 0 ? Math.round((correct / answered) * 100) : 0;

  elSummaryAnswered.textContent = String(answered);
  elSummaryCorrect.textContent = String(correct);
  elSummaryPercent.textContent = `${pct}%`;
}

/**
 * Отрисовывает следующий вопрос боя.
 */
function renderNextQuestion() {
  currentQuestion = getCurrentQuestion(currentSave, allWords);

  if (!currentQuestion) {
    showSummaryScreen();
    return;
  }

  updateCounter();

  // Вопрос: чтение каной крупно
  elReadingPrompt.textContent = currentQuestion.prompt;

  // Скрываем контекст и кнопку «Дальше»
  elContextBox.style.display = "none";
  elBtnNext.style.display = "none";

  // Отрисовываем 4 плитки вариантов ответа
  elOptionsContainer.innerHTML = "";
  currentQuestion.options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile-btn";
    btn.id = `tile-${idx}`;
    btn.dataset.index = String(idx);
    btn.innerHTML = `
      <span class="tile-num">${idx + 1}</span>
      <span class="tile-text">${opt}</span>
    `;
    btn.addEventListener("click", () => handleOptionSelected(idx));
    elOptionsContainer.appendChild(btn);
  });

  isAnswered = false;
  questionStartTime = performance.now();
}

/**
 * Обрабатывает клик по варианту ответа.
 * @param {number} selectedIndex
 */
async function handleOptionSelected(selectedIndex) {
  if (isAnswered || !currentQuestion) return;
  isAnswered = true;

  const elapsedMs = Math.round(performance.now() - questionStartTime);
  const selectedMeaning = currentQuestion.options[selectedIndex];

  // Отключаем все плитки от повторных кликов
  const tileButtons = elOptionsContainer.querySelectorAll(".tile-btn");
  tileButtons.forEach((b) => (b.disabled = true));

  // Отдаём ответ в ядро и немедленно сохраняем в IndexedDB
  const answerInfo = await submitAnswer(
    currentSave,
    currentQuestion.unitId,
    currentQuestion.word,
    selectedMeaning,
    currentQuestion.expected,
    elapsedMs,
  );

  // Подсвечиваем выбранную плитку и эталонную
  tileButtons.forEach((btn, idx) => {
    const text = currentQuestion.options[idx].trim().toLowerCase();
    const isTarget = text === currentQuestion.expected.trim().toLowerCase();

    if (idx === selectedIndex) {
      if (answerInfo.isCorrect) {
        btn.classList.add("selected-correct");
      } else {
        btn.classList.add("selected-wrong");
      }
    } else if (isTarget) {
      btn.classList.add("reveal-correct");
    }
  });

  // Обновляем счётчик
  updateCounter();

  // Показываем слово целиком и пример-предложение с переводом
  const word = currentQuestion.word;
  elFullWord.textContent = word.word;
  elFullReading.textContent = word.reading;
  elFullMeaning.textContent = word.meaning_ru;
  elSentence.textContent = word.sentence || "";
  elSentenceRu.textContent = word.sentence_ru || "";

  elContextBox.style.display = "block";
  elBtnNext.style.display = "inline-flex";
  elBtnNext.focus();
}

/**
 * Переход к следующему вопросу после изучения контекста.
 */
function handleNextQuestion() {
  const maxLen = currentSave.settings.battleLength || Balance.BATTLE_LENGTH_DEFAULT;
  if (currentSave.session && currentSave.session.answered >= maxLen) {
    showSummaryScreen();
  } else {
    renderNextQuestion();
  }
}

/**
 * Сдаться в бою.
 */
async function handleSurrender() {
  await surrenderBattle(currentSave);
  renderStartScreen();
}

/**
 * Завершить заход с экрана сводки.
 */
async function handleFinishSummary() {
  await finishBattleSession(currentSave);
  renderStartScreen();
}

/**
 * Обработка нажатий клавиш:
 * 1-4: выбор плитки;
 * Enter/Space: переход дальше.
 * @param {KeyboardEvent} e
 */
function handleKeyDown(e) {
  if (!elBattleScreen.classList.contains("active")) return;

  if (!isAnswered) {
    if (["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      const idx = parseInt(e.key, 10) - 1;
      handleOptionSelected(idx);
    }
  } else {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleNextQuestion();
    }
  }
}

/**
 * Инициализация приложения.
 */
async function init() {
  try {
    // 1. Загрузка данных контента
    await loadContent("./data");
    allWords = wordsByFrequency();

    // 2. Загрузка сохранения из IndexedDB
    currentSave = await loadSave();

    // 3. Подключение обработчиков
    elBtnStart.addEventListener("click", () => startBattle(false));
    elBtnContinue.addEventListener("click", () => startBattle(true));
    elBtnSurrender.addEventListener("click", handleSurrender);
    elBtnNext.addEventListener("click", handleNextQuestion);
    elBtnFinishSummary.addEventListener("click", handleFinishSummary);

    elBtnExport.addEventListener("click", () => exportSave(currentSave));
    elBtnImport.addEventListener("click", () => elFileInput.click());
    elFileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        currentSave = await importSave(file);
        renderStartScreen();
        alert("Сохранение успешно импортировано!");
      } catch (err) {
        alert("Ошибка импорта: " + (err.message || err));
      } finally {
        elFileInput.value = "";
      }
    });

    window.addEventListener("keydown", handleKeyDown);

    // 4. Отрисовка начального экрана
    renderStartScreen();
  } catch (err) {
    console.error("Ошибка инициализации:", err);
    document.body.innerHTML = `
      <div style="padding: 32px; color: #b5654f; font-family: sans-serif;">
        <h2>Ошибка запуска приложения</h2>
        <p>${err.message || err}</p>
        <p style="color: #9a9086">Убедитесь, что запуск происходит через локальный сервер (порт 3000).</p>
      </div>
    `;
  }
}

// Запуск
init();
