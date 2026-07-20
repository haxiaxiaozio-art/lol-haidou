@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
if not exist node_modules goto install_dependencies
goto start_site

:install_dependencies
echo First launch: installing website dependencies. Please wait...
call npm install
if errorlevel 1 goto install_failed

:start_site
echo Starting HaiDou MVP. Open the Local address shown below in your browser.
powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath 'node.exe' -ArgumentList 'helper/server.mjs' -WorkingDirectory '%CD%'"
call npm run dev
pause
exit /b %errorlevel%

:missing_node
echo Node.js was not found. Install Node.js 22 or newer, then try again.
pause
exit /b 1

:install_failed
echo Dependency installation failed. Check your network, then try again.
pause
exit /b 1
