@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-helper.ps1"
exit /b %errorlevel%
