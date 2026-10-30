@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run Install.cmd first.
  pause
  exit /b 1
)
.venv\Scripts\python.exe server.py --port 8766
if errorlevel 1 pause
