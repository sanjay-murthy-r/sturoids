@echo off
title Sturoids - PC installer builder
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Get the LTS version from https://nodejs.org
  echo then run this file again.
  pause
  exit /b 1
)

echo [1/3] Installing project dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 ( echo npm install failed. ^& pause ^& exit /b 1 )

echo [2/3] Building the app for the PC...
if exist desktop\app rmdir /s /q desktop\app
call npx expo export --platform web --output-dir desktop\app
if errorlevel 1 ( echo The PC build failed. ^& pause ^& exit /b 1 )

echo [3/3] Making the Windows installer...
cd desktop
call npm install --no-audit --no-fund
call npm run dist
if errorlevel 1 ( echo The installer build failed. ^& pause ^& exit /b 1 )

echo.
echo Done. The installer is in desktop\dist (Sturoids-Setup-*.exe). Double-click it to install.
start "" "%~dp0desktop\dist"
pause
