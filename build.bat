@echo off
setlocal
cd /d "%~dp0"
java Build.java build
if errorlevel 1 (
  echo.
  echo Check that a full JDK 17 or newer is installed and java is on PATH.
  pause
  exit /b 1
)
