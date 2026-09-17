/**
 * Модуль хранения прогресса в IndexedDB. Зона агента B.
 *
 * Хранит SaveFile (types.js), версия 1.
 * Каждый ответ игрока сохраняется немедленно.
 *
 * @typedef {import("../core/types.js").SaveFile} SaveFile
 */

import { Balance } from "../core/balance.js";

const DB_NAME = "osada_db";
const DB_VERSION = 1;
const STORE_NAME = "save";
const SAVE_KEY = "current";

/**
 * Открывает или создаёт базу данных IndexedDB.
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("indexedDB is not available in current environment"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Создаёт новое чистое сохранение.
 * @returns {SaveFile}
 */
export function createNewSave() {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    currentDay: 1,
    dayRollsOverAtHour: Balance.DAY_ROLLOVER_HOUR,
    settings: {
      newPerDay: Balance.NEW_PER_DAY_DEFAULT,
      battleLength: Balance.BATTLE_LENGTH_DEFAULT,
    },
    progress: {},
    session: null,
    campaign: {
      currentLevelId: "",
      completedLevels: [],
    },
  };
}

/**
 * Загружает сохранение из IndexedDB.
 * Если сохранения нет, создаёт новое и возвращает его.
 * @returns {Promise<SaveFile>}
 */
export async function loadSave() {
  try {
    const db = await openDb();
    const save = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(SAVE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (save && save.version === 1) {
      return save;
    }

    // Резервная проверка localStorage
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem("osada_save");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.version === 1) {
            await saveToDb(parsed);
            return parsed;
          }
        }
      } catch {}
    }

    const fresh = createNewSave();
    await saveToDb(fresh);
    return fresh;
  } catch (err) {
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem("osada_save");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.version === 1) return parsed;
        }
      } catch {}
    }
    return createNewSave();
  }
}

/**
 * Записывает сохранение в IndexedDB.
 * Вызывается на каждый ответ игрока.
 * @param {SaveFile} save
 * @returns {Promise<void>}
 */
export async function saveToDb(save) {
  // Зеркалируем в localStorage для надёжности
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem("osada_save", JSON.stringify(save));
    } catch {}
  }

  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(save, SAVE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    // В средах без IndexedDB запись в localStorage уже выполнена
  }
}

/**
 * Экспорт сохранения в файл JSON.
 * @param {SaveFile} save
 */
export function exportSave(save) {
  const jsonStr = JSON.stringify(save, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `osada-save-day${save.currentDay}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Импорт сохранения из файла JSON.
 * @param {File} file
 * @returns {Promise<SaveFile>}
 */
export function importSave(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = /** @type {string} */ (e.target?.result);
        const parsed = JSON.parse(text);
        if (!parsed || parsed.version !== 1 || typeof parsed.progress !== "object") {
          throw new Error("Неверный формат сохранения: ожидается JSON с version: 1");
        }
        await saveToDb(parsed);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
