@echo off
rem Start Claude hotkeys and the session list without a console window
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0claude-hotkeys.ps1"
