@echo off
powershell.exe -NoProfile -File "%~dp0install-helper.ps1"
exit /b %errorlevel%
