#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Симуляция нагрузки SRS для проекта «Осада» (рабочее имя).

Зачем: до того как проектировать ползунки, советника и размер ежедневной осады,
нужно знать в цифрах, сколько повторений накопится у игрока при разном темпе
ввода новых единиц. Иначе баланс проектируется вслепую.

Модель: упрощённый SM-2 в духе Anki.
  - Новая единица: 2 показа в день ввода (шаги изучения), затем интервал 1 день.
  - Успех: interval = max(round(interval * ease), interval + 1).
    Верхняя граница max(round(...), interval+1) обязательна: без неё карточка
    с ease 1.3 навсегда залипает на интервале в 1 день и очередь растёт вечно.
  - Провал: ease -= 0.20 (пол 1.3), interval = max(1, round(interval * LAPSE_MULT)),
    плюс один дополнительный показ в тот же день.
  - Вероятность провала зависит от зрелости карточки (см. p_fail).

Модель намеренно упрощённая. Её задача — порядок величин и форма кривой,
а не точный прогноз. Все параметры вынесены в константы: агент A подставляет
реальные и перепроверяет этим же скриптом.

Контрольная проверка адекватности: в реальном Anki при ретенции ~90%
установившаяся нагрузка составляет примерно 8-10 повторений в день на каждую
новую карточку в день. Если модель даёт принципиально другое — она сломана.

Запуск: python3 srs_load_sim.py
"""

import random
from dataclasses import dataclass, field

SEED = 20260917
HORIZON_DAYS = 365
DECK_SIZE = 1500          # Kaishi 1.5k
SEC_PER_ANSWER = 6.0      # средняя длительность одного ответа, секунд

START_EASE = 2.5
MIN_EASE = 1.3
EASE_PENALTY = 0.20
LAPSE_MULT = 0.3          # какая доля интервала остаётся после срыва
MAX_INTERVAL = 365

SNAPSHOT_DAYS = (30, 90, 180, 364)


def p_fail(interval: int, lapses: int) -> float:
    """Вероятность «не вспомнил». Новичок в японском, консервативная оценка."""
    base = 0.22 if interval < 7 else (0.15 if interval < 21 else 0.10)
    return base + 0.02 * min(lapses, 4)


@dataclass
class Card:
    idx: int
    interval: int = 0
    ease: float = START_EASE
    due: int = 0
    lapses: int = 0
    reps: int = 0
    last_lapse_day: int = -9999


@dataclass
class DayStat:
    day: int
    new: int = 0
    due: int = 0
    answers: int = 0
    minutes: float = 0.0


@dataclass
class SimResult:
    new_per_day: int
    days: list = field(default_factory=list)
    snapshots: dict = field(default_factory=dict)
    introduced: int = 0
    day_deck_finished: int | None = None


VETERAN_WINDOW = 21       # «недавно» для скользящего признака, дней
VETERAN_EASE = 2.1        # ниже этого карточка считается трудной


def wave_split(cards, day: int, rule: str = "cumulative") -> dict:
    """Разбивка сегодняшней очереди на волны осады в духе Q17.

    Два конкурирующих правила отнесения к «ветеранам»:

    cumulative — срывался 2+ раза за всю историю. Интуитивно очевидное
        правило, но оно необратимо: карточка, однажды попавшая в ветераны,
        остаётся там навсегда, даже если игрок давно её освоил.

    sliding — срывался в последние VETERAN_WINDOW дней либо имеет низкий
        ease. Правило обратимое: выученное слово возвращается в пехоту.

    Смысл сравнения — показать, что от выбора правила зависит, соберётся
    ли задуманная структура осады вообще.
    """
    infantry = officers = veterans = 0
    for c in cards:
        if c.due > day:
            continue
        if rule == "cumulative":
            is_vet = c.lapses >= 2
        else:
            is_vet = (day - c.last_lapse_day <= VETERAN_WINDOW) or c.ease < VETERAN_EASE
        if is_vet:
            veterans += 1
        elif c.interval < 14:
            officers += 1
        else:
            infantry += 1
    return {"пехота": infantry, "офицеры": officers, "ветераны": veterans}


def simulate(new_per_day: int, horizon: int = HORIZON_DAYS,
             deck_size: int = DECK_SIZE, skip_days: set | None = None,
             daily_cap: int | None = None) -> SimResult:
    """skip_days — дни, когда игрок не заходил (повторения копятся).
    daily_cap — потолок повторений за день; остальное переносится на завтра."""
    rng = random.Random(SEED)
    skip_days = skip_days or set()
    cards: list[Card] = []
    res = SimResult(new_per_day=new_per_day)
    introduced = 0

    for day in range(horizon):
        stat = DayStat(day=day)
        if day in skip_days:
            res.days.append(stat)
            if day in SNAPSHOT_DAYS:
                res.snapshots[day] = wave_split(cards, day)
            continue

        # снимок состава очереди делается ДО обработки дня,
        # иначе все due уже сдвинуты в будущее и волны выходят пустыми
        if day in SNAPSHOT_DAYS:
            res.snapshots[day] = {
                "cumulative": wave_split(cards, day, "cumulative"),
                "sliding": wave_split(cards, day, "sliding"),
                # «спящие» зрелые: срок ещё не подошёл, но слово освоено.
                # Резерв, из которого можно подмешать лёгкую первую волну.
                "reserve": sum(1 for c in cards
                               if c.due > day and c.interval >= 21
                               and c.ease >= VETERAN_EASE),
            }

        due_today = [c for c in cards if c.due <= day]
        due_today.sort(key=lambda c: c.due)     # сначала самые просроченные
        stat.due = len(due_today)

        if daily_cap is not None and len(due_today) > daily_cap:
            for c in due_today[daily_cap:]:
                c.due = day + 1
            due_today = due_today[:daily_cap]

        for c in due_today:
            c.reps += 1
            stat.answers += 1
            if rng.random() < p_fail(c.interval, c.lapses):
                c.lapses += 1
                c.last_lapse_day = day
                c.ease = max(MIN_EASE, c.ease - EASE_PENALTY)
                c.interval = max(1, round(c.interval * LAPSE_MULT))
                c.due = day + c.interval
                stat.answers += 1              # повторный показ в тот же день
            else:
                grown = max(round(max(c.interval, 1) * c.ease), c.interval + 1)
                c.interval = min(grown, MAX_INTERVAL)
                c.due = day + c.interval

        n = 0
        while n < new_per_day and introduced < deck_size:
            cards.append(Card(idx=introduced, interval=1, due=day + 1))
            introduced += 1
            n += 1
            stat.answers += 2                  # два шага изучения в день ввода
        stat.new = n
        if introduced >= deck_size and res.day_deck_finished is None:
            res.day_deck_finished = day

        stat.minutes = stat.answers * SEC_PER_ANSWER / 60.0
        res.days.append(stat)

    res.introduced = introduced
    return res


def peak(res: SimResult) -> DayStat:
    """День максимальной нагрузки — то, обо что игрок разбивается."""
    return max(res.days, key=lambda d: d.answers)


def weekly_table(res: SimResult, weeks=(1, 2, 4, 8, 12, 26, 52)):
    rows = []
    for w in weeks:
        lo, hi = (w - 1) * 7, w * 7
        window = res.days[lo:hi]
        if not window:
            continue
        rows.append((
            w,
            sum(d.due for d in window) / len(window),
            sum(d.answers for d in window) / len(window),
            sum(d.minutes for d in window) / len(window),
        ))
    return rows


def main():
    rates = [5, 8, 10, 15, 20, 30]
    finals = {}

    print("=" * 78)
    print("НАГРУЗКА SRS ПРИ РАЗНОМ ТЕМПЕ ВВОДА НОВЫХ ЕДИНИЦ")
    print(f"Колода {DECK_SIZE} единиц, горизонт {HORIZON_DAYS} дней, "
          f"{SEC_PER_ANSWER:.0f} сек на ответ")
    print("=" * 78)

    for rate in rates:
        res = simulate(rate)
        finals[rate] = res
        fin = res.day_deck_finished
        print(f"\n--- {rate} новых в день " + "-" * 45)
        print("Колода пройдена: " +
              (f"день {fin} (~{fin/30:.1f} мес.)" if fin else "не пройдена за год"))
        print(f"{'неделя':>7} | {'повторений/день':>16} | "
              f"{'ответов/день':>13} | {'минут/день':>11}")
        print("-" * 60)
        for w, due, ans, mins in weekly_table(res):
            print(f"{w:>7} | {due:>16.0f} | {ans:>13.0f} | {mins:>11.1f}")

    print("\n" + "=" * 78)
    print("ПИК НАГРУЗКИ — главное число проекта")
    print("Именно об это игрок разбивается и уходит.")
    print("=" * 78)
    print(f"{'новых/день':>11} | {'пик ответов':>12} | {'пик минут':>10} | "
          f"{'на какой день':>14}")
    print("-" * 60)
    for rate in rates:
        p = peak(finals[rate])
        print(f"{rate:>11} | {p.answers:>12} | {p.minutes:>10.0f} | {p.day:>14}")

    print("\n" + "=" * 78)
    print("ПРОВЕРКА АДЕКВАТНОСТИ МОДЕЛИ")
    print("Практика Anki: ~8-10 повторений в день на каждую новую карточку")
    print("в день, пока колода ещё поступает. Считаем на участке до её конца.")
    print("=" * 78)
    for rate in rates:
        res = finals[rate]
        end = res.day_deck_finished or (HORIZON_DAYS - 1)
        lo = max(0, end - 30)
        window = res.days[lo:end] or res.days[-30:]
        avg = sum(d.due for d in window) / len(window)
        print(f"{rate:>2} нов./день -> {avg:>5.0f} повторений/день "
              f"(соотношение {avg/rate:>4.1f})")

    print("\n" + "=" * 78)
    print("СОСТАВ ОСАДЫ ПО ВОЛНАМ: два правила отнесения к ветеранам")
    print("Слева — накопительное (срывался 2+ раза когда-либо),")
    print("справа — скользящее (срывался за последние 3 недели или низкий ease).")
    print("=" * 78)
    for rate in (8, 15, 30):
        print(f"\n{rate} новых в день:")
        for d in SNAPSHOT_DAYS:
            snap = finals[rate].snapshots.get(d)
            if not snap:
                continue
            line = f"  день {d:>3}: "
            for rule in ("cumulative", "sliding"):
                w = snap[rule]
                total = sum(w.values()) or 1
                line += (f"[{'накопит.' if rule == 'cumulative' else 'скольз.'}] "
                         f"пех {w['пехота']*100//total:>2}% "
                         f"оф {w['офицеры']*100//total:>2}% "
                         f"вет {w['ветераны']*100//total:>2}%   ")
            line += f"| резерв зрелых вне срока: {snap['reserve']:>4}"
            print(line)

    print("=" * 78)
    print("ЦЕНА ПРОПУСКА: игрок не заходил 3 дня подряд (дни 100-102)")
    print("=" * 78)
    for rate in (8, 10, 15, 20):
        res = simulate(rate, skip_days={100, 101, 102})
        before, after = res.days[99], res.days[103]
        print(f"{rate:>2} нов./день: накануне {before.due:>3} повторений "
              f"({before.minutes:>4.1f} мин) -> после трёх пропусков "
              f"{after.due:>3} ({after.minutes:>5.1f} мин), "
              f"рост в {after.due / max(before.due, 1):.1f} раза")

    print("\n" + "=" * 78)
    print("ЭФФЕКТ ПОТОЛКА (колода 5000 единиц, чтобы поток новых не иссякал)")
    print("Проверяем, спасает ли ограничение очереди от снежного кома.")
    print("=" * 78)
    for rate in (10, 20, 30):
        for cap in (None, 120):
            res = simulate(rate, deck_size=5000, daily_cap=cap)
            p = peak(res)
            backlog = res.days[HORIZON_DAYS - 1].due
            label = "без потолка" if cap is None else f"потолок {cap}"
            print(f"{rate:>2} нов./день, {label:>12}: "
                  f"пик {p.answers:>4} ответов ({p.minutes:>4.0f} мин), "
                  f"очередь на день 365 = {backlog:>5}")
        print()

    print("\n" + "=" * 78)
    print("СКОЛЬКО ДНЕЙ ДО КОНЦА КОЛОДЫ")
    print("=" * 78)
    for rate in rates:
        d = finals[rate].day_deck_finished
        print(f"{rate:>2} нов./день -> " +
              (f"{d:>3} дней (~{d/30:.1f} мес.)" if d else "больше года"))


if __name__ == "__main__":
    main()
