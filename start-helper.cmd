@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node

call :helper_ready
if not errorlevel 1 goto already_running

call :stop_legacy_helper
if errorlevel 1 goto port_conflict

call :is_admin
if not errorlevel 1 goto launch_helper

for /f "delims=" %%N in ('where node') do if not defined HAIDOU_NODE set "HAIDOU_NODE=%%N"
echo Administrator permission is required to read an elevated WeGame LOL client.
echo Windows will show a User Account Control prompt for Node.js.
powershell.exe -NoProfile -NonInteractive -Command "try { Start-Process -Verb RunAs -WindowStyle Normal -FilePath '%HAIDOU_NODE%' -ArgumentList 'helper/server.mjs' -WorkingDirectory '%CD%'; exit 0 } catch { exit 1 }"
if errorlevel 1 goto elevation_failed
echo HaiDou local data helper was started with administrator permission.
echo Return to the website; player login status refreshes automatically.
pause
exit /b 0

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
powershell.exe -NoProfile -NonInteractive -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3212/v1/health' -TimeoutSec 1 } catch { exit 0 }; if ($health.service -ne 'haidou-local-helper') { exit 2 }; $connection = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 3212 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -eq $connection) { exit 0 }; $ownerProcess = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue; if ($null -eq $ownerProcess -or $ownerProcess.ProcessName -ne 'node') { exit 2 }; Stop-Process -Id $connection.OwningProcess -Force; Start-Sleep -Milliseconds 400; exit 0"
exit /b %errorlevel%

:is_admin
powershell.exe -NoProfile -NonInteractive -Command "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = New-Object Security.Principal.WindowsPrincipal($identity); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 }; exit 1"
exit /b %errorlevel%

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
echo Administrator permission was not granted, so the WeGame LOL client cannot be read.
pause
exit /b 1

:missing_node
echo Node.js was not found. Install Node.js 22 or newer, then try again.
pause
exit /b 1
