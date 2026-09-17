#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Конвертер колод Anki (.apkg) во внутренний формат проекта.

Вход:
  Kaishi 1.5k Russian.apkg     — 1497 слов, тип заметки «Kaishi 1.5k RU», 18 полей
  Kanji drawing practice.apkg  — 2358 кандзи, тип «Wanikani Kanji», 23 поля

Выход (в каталоге --out):
  words.json   — учебные единицы-слова
  kanji.json   — учебные единицы-кандзи
  links.json   — связь «кандзи -> слова, в которых он встречается»
  report.json  — отчёт о полноте и качестве данных

Важно про уровни JLPT. Поле Jlpt в колоде кандзи использует СТАРУЮ шкалу
(до реформы 2010 года), где 4 — самый лёгкий уровень, а 1 — самый трудный.
Проверено накопительно: 103 / 284 / 1023 кандзи совпадают со справочными
объёмами старого экзамена. Если взять «Jlpt == 4» за N4, получится набор N5.
Соответствие приблизительное: 4 кю -> N5, 3 кю -> N4, 2 кю -> N2, 1 кю -> N1.
Уровня N3 в старой шкале не существовало, поэтому его в данных нет.

Запуск:
  python3 convert_decks.py --kaishi <путь.apkg> --kanji <путь.apkg> --out data/
"""

import argparse
import html
import json
import pathlib
import re
import sqlite3
import tempfile
import zipfile

import zstandard

FIELD_SEP = "\x1f"

# старая шкала кю -> современный уровень
KYU_TO_JLPT = {"4": "N5", "3": "N4", "2": "N2", "1": "N1"}

CYRILLIC = re.compile(r"[а-яёА-ЯЁ]")
KANJI_RE = re.compile(r"[一-鿿]")
SOUND_RE = re.compile(r"\[sound:([^\]]+)\]")


def open_collection(apkg_path: pathlib.Path, workdir: pathlib.Path) -> sqlite3.Connection:
    """Распаковывает .apkg и открывает базу. Поддерживает anki21b (zstd) и anki2."""
    with zipfile.ZipFile(apkg_path) as z:
        z.extractall(workdir)

    modern = workdir / "collection.anki21b"
    target = workdir / "collection.sqlite"
    if modern.exists():
        raw = modern.read_bytes()
        dctx = zstandard.ZstdDecompressor()
        try:
            data = dctx.decompress(raw)
        except zstandard.ZstdError:
            # в кадре не указан размер содержимого — распаковываем потоково
            data = dctx.decompressobj().decompress(raw)
        target.write_bytes(data)
    else:
        target = workdir / "collection.anki2"

    con = sqlite3.connect(target)
    # Anki использует собственную функцию сравнения; без неё падают запросы к decks
    con.create_collation(
        "unicase",
        lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()),
    )
    return con


def read_notes(con: sqlite3.Connection) -> list[dict]:
    field_names = {}
    for ntid, _ in con.execute("SELECT id, name FROM notetypes"):
        field_names[ntid] = [
            r[0] for r in con.execute(
                "SELECT name FROM fields WHERE ntid=? ORDER BY ord", (ntid,))
        ]
    notes = []
    for nid, mid, flds in con.execute("SELECT id, mid, flds FROM notes"):
        values = flds.split(FIELD_SEP)
        note = dict(zip(field_names[mid], values))
        note["_id"] = nid
        notes.append(note)
    return notes


def plain(value: str) -> str:
    """Убирает разметку и схлопывает пробелы."""
    value = re.sub(r"<(script|style).*?</\1>", " ", value or "", flags=re.S | re.I)
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def sounds(value: str) -> list[str]:
    return SOUND_RE.findall(value or "")


def parse_vocab_table(raw: str) -> list[dict]:
    """Поле Vocabulary — HTML-таблица из строк «слово / значение»."""
    out = []
    for row in re.findall(r"<tr>(.*?)</tr>", raw or "", flags=re.S | re.I):
        cells = [plain(c) for c in re.findall(r"<td>(.*?)</td>", row, flags=re.S | re.I)]
        if len(cells) >= 2 and cells[0]:
            out.append({"word": cells[0], "meaning": cells[1]})
    return out


def convert_words(notes: list[dict]) -> list[dict]:
    words = []
    for n in notes:
        word = plain(n.get("Word", ""))
        if not word:
            continue
        freq_raw = plain(n.get("Frequency", ""))
        words.append({
            "id": f"w{n['_id']}",
            "word": word,
            "reading": plain(n.get("Word Reading", "")),
            "furigana": plain(n.get("Word Furigana", "")),
            "meaning_ru": plain(n.get("Word Meaning (Russian)", "")),
            "meaning_en": plain(n.get("Word Meaning", "")),
            "sentence": plain(n.get("Sentence", "")),
            "sentence_furigana": plain(n.get("Sentence Furigana", "")),
            "sentence_ru": plain(n.get("Sentence Meaning (Russian)", "")),
            "sentence_en": plain(n.get("Sentence Meaning", "")),
            "pitch": plain(n.get("Pitch Accent", "")),
            "notes_ru": plain(n.get("Notes (Russian)", "")),
            "pitch_notes_ru": plain(n.get("Pitch Accent Notes (Russian)", "")),
            "frequency": int(freq_raw) if freq_raw.isdigit() else None,
            "audio_word": sounds(n.get("Word Audio", "")),
            "audio_sentence": sounds(n.get("Sentence Audio", "")),
            "kanji": sorted(set(KANJI_RE.findall(word))),
        })
    words.sort(key=lambda w: (w["frequency"] is None, w["frequency"] or 0))
    return words


def convert_kanji(notes: list[dict]) -> list[dict]:
    out = []
    for n in notes:
        ch = plain(n.get("Kanji", ""))
        if not ch:
            continue
        kyu = plain(n.get("Jlpt", ""))
        meaning_ru = plain(n.get("WkMeaning", ""))
        if not CYRILLIC.search(meaning_ru):
            meaning_ru = ""          # в этом поле лежит английский — русского нет
        stroke_raw = plain(n.get("StrokeCount", ""))
        level_raw = plain(n.get("Level", ""))
        out.append({
            "id": f"k{n['_id']}",
            "kanji": ch,
            "meaning_ru": meaning_ru,
            "meaning_en": plain(n.get("MergedMeaning", "")) or plain(n.get("KanjidicMeaning", "")),
            "on": plain(n.get("On", "")),
            "kun": plain(n.get("Kun", "")),
            "kyu": kyu or None,
            "jlpt": KYU_TO_JLPT.get(kyu),
            "stroke_count": int(stroke_raw) if stroke_raw.isdigit() else None,
            "radical": plain(n.get("Radical", "")),
            "similar_looking": [c for c in plain(n.get("SimilarLooking", "")) if KANJI_RE.match(c)],
            "wk_level": int(level_raw) if level_raw.isdigit() else None,
            "freq_note": plain(n.get("Freq", "")),
            "has_stroke_svg": bool(plain(n.get("Strokes", ""))),
            "vocabulary": parse_vocab_table(n.get("Vocabulary", "")),
        })
    return out


def build_links(words: list[dict], kanji: list[dict]) -> dict:
    known = {k["kanji"] for k in kanji}
    links: dict[str, list[str]] = {}
    for w in words:
        for ch in w["kanji"]:
            if ch in known:
                links.setdefault(ch, []).append(w["id"])
    return links


def build_report(words, kanji, links) -> dict:
    def filled(items, key):
        return sum(1 for i in items if i.get(key))

    by_jlpt = {}
    for lvl in ("N5", "N4", "N2", "N1", None):
        grp = [k for k in kanji if k["jlpt"] == lvl]
        if not grp:
            continue
        by_jlpt[lvl or "без уровня"] = {
            "всего": len(grp),
            "с русским значением": filled(grp, "meaning_ru"),
            "с анимацией черт": filled(grp, "has_stroke_svg"),
        }

    return {
        "слова": {
            "всего": len(words),
            "с русским значением": filled(words, "meaning_ru"),
            "с примером": filled(words, "sentence"),
            "с русским переводом примера": filled(words, "sentence_ru"),
            "с частотой": filled(words, "frequency"),
            "со ссылкой на аудио слова": filled(words, "audio_word"),
            "содержат кандзи из второй колоды":
                sum(1 for w in words if any(c in links for c in w["kanji"])),
        },
        "кандзи": {
            "всего": len(kanji),
            "с русским значением": filled(kanji, "meaning_ru"),
            "с анимацией черт": filled(kanji, "has_stroke_svg"),
            "со списком похожих": filled(kanji, "similar_looking"),
            "по уровням": by_jlpt,
        },
        "связи": {
            "кандзи, встречающихся в словах": len(links),
            "в среднем слов на кандзи":
                round(sum(len(v) for v in links.values()) / max(len(links), 1), 2),
        },
        "предупреждения": [
            "Поле Jlpt — старая шкала кю (4 самый лёгкий). Для N4 нужны уровни 4 и 3.",
            "Медиафайлы в .apkg не приложены: ссылки на аудио есть, самих файлов нет.",
            "Поле Picture в колоде слов пустое у всех записей.",
            "Анимация черт есть у меньшинства кандзи — на ней нельзя строить обязательную механику.",
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kaishi", required=True, type=pathlib.Path)
    ap.add_argument("--kanji", required=True, type=pathlib.Path)
    ap.add_argument("--out", required=True, type=pathlib.Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
        con = open_collection(args.kaishi, pathlib.Path(t1))
        words = convert_words(read_notes(con))
        con.close()

        con = open_collection(args.kanji, pathlib.Path(t2))
        kanji = convert_kanji(read_notes(con))
        con.close()

    links = build_links(words, kanji)
    report = build_report(words, kanji, links)

    for name, payload in (("words", words), ("kanji", kanji),
                          ("links", links), ("report", report)):
        path = args.out / f"{name}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{path}  ({path.stat().st_size // 1024} КБ)")

    print()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
