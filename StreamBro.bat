@echo off
title StreamBro
cd /d "%~dp0"
echo Starting StreamBro...
npx electron .
if errorlevel 1 pause
