@echo off
setlocal
cd /d "%~dp0"
set "HAIDOU_SITE=https://haxiaxiaozio-art.github.io/lol-haidou/?v=2"

where node >nul 2>nul
if errorlevel 1 goto missing_node

call :helper_ready
if errorlevel 1 (
  echo Starting the HaiDou local data helper...
  start "HaiDou Data Helper" /min cmd.exe /d /k call "%CD%\start-helper.cmd"
) else (
  echo HaiDou local data helper is already running.
)

echo Opening the public HaiDou website...
start "" "%HAIDOU_SITE%"
echo.
echo Keep the data helper window running while reading LOL match history.
echo The website will show whether the helper, LOL client, and player login are connected.
pause
exit /b 0

:helper_ready
powershell.exe -NoProfile -NonInteractive -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3212/v1/health' -TimeoutSec 1; if ($health.service -eq 'haidou-local-helper' -and $health.version -ge 5) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %errorlevel%

:missing_node
echo Node.js was not found. Install Node.js 22 or newer, then try again.
echo You can still open the demo website at %HAIDOU_SITE%
start "" "%HAIDOU_SITE%"
pause
exit /b 1
