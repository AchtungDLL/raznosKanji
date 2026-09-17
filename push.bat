@echo off
setlocal
rem ------------------------------------------------------------------
rem  Push project to github.com/AchtungDLL/raznosKanji
rem  ASCII only on purpose: cmd.exe reads .bat as cp866,
rem  so any Cyrillic here would break the parser.
rem ------------------------------------------------------------------
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git not found. Install from https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist ".git" (
  echo First run: creating repository...
  git init
  if errorlevel 1 goto fail
  git branch -M main
  git remote add origin https://github.com/AchtungDLL/raznosKanji.git
  if errorlevel 1 goto fail
)

rem Commit author for THIS repository only (no --global).
rem Change the two values below if you want a different name or address.
git config user.name >nul 2>nul || git config user.name "AchtungDLL"
git config user.email >nul 2>nul || git config user.email "yumenoshinshi132341@gmail.com"

echo Staging files...
git add -A
if errorlevel 1 goto fail

rem MSG must be set OUTSIDE the if-block: cmd expands %VAR% when it parses
rem the whole block, so a value assigned inside it is not visible there yet.
set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update"

git diff --cached --quiet
if errorlevel 1 (
  git commit -m "%MSG%"
  if errorlevel 1 goto fail
) else (
  echo Nothing to commit.
)

echo Pulling remote changes...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo Pull failed. Remote has commits that do not merge cleanly.
  echo Open a terminal here and run: git status
  pause
  exit /b 1
)

echo Pushing...
git push -u origin main
if errorlevel 1 goto fail

echo.
echo Done. Repository updated.
pause
exit /b 0

:fail
echo.
echo Failed. See the message above.
pause
exit /b 1
