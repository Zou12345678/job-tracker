@echo off
cd /d "%~dp0"
rem Prefer Python, fall back to Node.js - server.py and server.js behave identically
rem "where python" also matches the Microsoft Store stub, so actually run it to verify
python -c "import sys" >nul 2>nul
if not errorlevel 1 (
  python server.py
  pause
  exit /b 0
)
where node >nul 2>nul
if not errorlevel 1 (
  node server.js
  pause
  exit /b 0
)
echo [Error] Neither Python nor Node.js found. Install either one:
echo   Python:  https://www.python.org/downloads/  (check "Add to PATH" when installing)
echo   Node.js: https://nodejs.org
pause
exit /b 1
