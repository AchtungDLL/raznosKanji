@echo off
rem Local launch. ASCII only: cmd.exe reads .bat as cp866.
cd /d "%~dp0"
where python >nul 2>nul || (echo Need Python & pause & exit /b 1)
start "" http://localhost:8123
python -m http.server 8123
