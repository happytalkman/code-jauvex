@echo off
rem The web version on Windows: double-click. Installs what is missing, then starts the app (scripts\windows-start.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-start.ps1"
pause
