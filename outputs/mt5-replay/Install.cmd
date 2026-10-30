@echo off
setlocal
cd /d "%~dp0"
if exist .venv\Scripts\python.exe goto install
py -3 -m venv .venv
if errorlevel 1 goto fail
:install
if not exist .venv\Scripts\pip.exe (
  .venv\Scripts\python.exe -m ensurepip --upgrade
  if errorlevel 1 goto fail
)
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto fail
echo Installation complete. Run Start.cmd with MT5 open.
pause
exit /b 0
:fail
echo Installation failed. Install 64-bit Python 3.10 or newer and try again.
pause
exit /b 1
