@echo off
rem Быстрый запуск. Открывает игру в браузере.
rem Локальный сервер нужен: модули и JSON не грузятся по file:// из-за политики браузера.
cd /d "%~dp0"
where python >nul 2>nul || (echo Нужен Python & pause & exit /b 1)
start "" http://localhost:8123
python -m http.server 8123
