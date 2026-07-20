@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node

call :helper_ready
if not errorlevel 1 goto already_running

echo HaiDou local data helper is starting at http://127.0.0.1:3212
echo Keep this window open. The website will automatically show LOL login status.
node helper\server.mjs
set "HAIDOU_EXIT=%errorlevel%"
echo.
echo HaiDou local data helper stopped with code %HAIDOU_EXIT%.
pause
exit /b %HAIDOU_EXIT%

:helper_ready
powershell.exe -NoProfile -NonInteractive -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3212/v1/health' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %errorlevel%

:already_running
echo HaiDou local data helper is already running at http://127.0.0.1:3212
echo Open https://haxiaxiaozio-art.github.io/lol-haidou/?v=2 to check LOL login status.
pause
exit /b 0

:missing_node
echo Node.js was not found. Install Node.js 22 or newer, then try again.
pause
exit /b 1
