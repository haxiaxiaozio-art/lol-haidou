@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
node helper\server.mjs
pause
exit /b %errorlevel%

:missing_node
echo Node.js was not found. Install Node.js 22 or newer, then try again.
pause
exit /b 1
