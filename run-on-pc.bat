@echo off
rem Double-click to open Sturoids in the Android emulator. Drag an .apk onto this file to install it first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-on-pc.ps1" -Apk "%~1"
pause
