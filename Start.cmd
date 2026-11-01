@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run Install.cmd first.
  pause
  exit /b 1
)
title TradeTrace Control
.venv\Scripts\python.exe launcher.py --port 8766
if errorlevel 1 pause
