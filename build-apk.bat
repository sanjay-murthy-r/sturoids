@echo off
title Sturoids - APK builder
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Get the LTS version from https://nodejs.org
  echo then run this file again.
  pause
  exit /b 1
)

echo [1/4] Installing project dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )

echo [2/4] Installing the EAS build tool...
call npm install -g eas-cli --no-audit --no-fund

echo [3/4] Checking Expo login (free account: https://expo.dev/signup)...
call npx eas whoami >nul 2>nul
if errorlevel 1 call npx eas login

echo [4/4] Starting the cloud APK build (takes ~10-20 min)...
echo A download link appears here and on expo.dev when it finishes.
call npx eas build -p android --profile preview

pause
