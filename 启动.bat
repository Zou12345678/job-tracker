@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js not found. Install it from https://nodejs.org and retry.
  pause
  exit /b 1
)
node server.js
pause
