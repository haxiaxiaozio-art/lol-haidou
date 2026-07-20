@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node

call :helper_ready
if not errorlevel 1 goto already_running

call :stop_legacy_helper
if errorlevel 3 goto elevated_stop
if errorlevel 1 goto port_conflict
goto launch_helper

:launch_helper
echo HaiDou local data helper is starting at http://127.0.0.1:3212
echo Keep this window open. The website will automatically show LOL login status.
node helper\server.mjs
set "HAIDOU_EXIT=%errorlevel%"
echo.
echo HaiDou local data helper stopped with code %HAIDOU_EXIT%.
pause
exit /b %HAIDOU_EXIT%

:helper_ready
powershell.exe -NoProfile -NonInteractive -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3212/v1/health' -TimeoutSec 1; if ($health.service -eq 'haidou-local-helper' -and $health.version -ge 4) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %errorlevel%

:stop_legacy_helper
powershell.exe -NoProfile -NonInteractive -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3212/v1/health' -TimeoutSec 1 } catch { exit 0 }; if ($health.service -ne 'haidou-local-helper') { exit 2 }; $connection = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3212 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -eq $connection) { exit 0 }; $ownerProcess = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue; if ($null -eq $ownerProcess -or $ownerProcess.ProcessName -ne 'node') { exit 2 }; try { Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop; Start-Sleep -Milliseconds 400; exit 0 } catch { exit 3 }"
exit /b %errorlevel%

:elevated_stop
for /f "delims=" %%P in ('powershell.exe -NoProfile -NonInteractive -Command "$connection = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3212 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $connection) { Write-Output $connection.OwningProcess }"') do set "HAIDOU_OLD_PID=%%P"
if not defined HAIDOU_OLD_PID goto port_conflict
echo Windows needs permission once to replace the older HaiDou helper.
powershell.exe -NoProfile -NonInteractive -Command "try { $process = Start-Process -Verb RunAs -Wait -WindowStyle Hidden -FilePath 'taskkill.exe' -ArgumentList '/PID','%HAIDOU_OLD_PID%','/F' -PassThru; exit $process.ExitCode } catch { exit 1 }"
if errorlevel 1 goto elevation_failed
timeout /t 1 /nobreak >nul
goto launch_helper

:already_running
echo HaiDou local data helper is already running at http://127.0.0.1:3212
echo Open https://haxiaxiaozio-art.github.io/lol-haidou/?v=2 to check LOL login status.
pause
exit /b 0

:port_conflict
echo Port 3212 is being used by another program and was not changed.
echo Close that program, then run this helper again.
pause
exit /b 1

:elevation_failed
echo Administrator permission was not granted, so the older HaiDou helper is still running.
pause
exit /b 1

:missing_node
echo Node.js was not found. Install Node.js 22 or newer, then try again.
pause
exit /b 1
