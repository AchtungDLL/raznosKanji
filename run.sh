#!/usr/bin/env bash
# Быстрый запуск. Открывает игру в браузере.
# Локальный сервер нужен: модули и JSON не грузятся по file:// из-за политики браузера.
set -e
cd "$(dirname "$0")"
PORT=8123
command -v python3 >/dev/null || { echo "Нужен python3"; exit 1; }
echo "Открываю http://localhost:$PORT — закрыть: Ctrl+C"
(sleep 1 && (xdg-open "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT" 2>/dev/null || true)) &
python3 -m http.server $PORT
