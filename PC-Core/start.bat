@echo off
title MusicBridge PC Core - Eren Teknoloji
cd /d "%~dp0"
echo ===================================================
echo   MusicBridge PC Core Baslatiliyor...
echo ===================================================
if not exist node_modules (
    echo Gerekli paketler yukleniyor...
    call npm install ws --no-audit --no-fund
)
node server.js
pause
