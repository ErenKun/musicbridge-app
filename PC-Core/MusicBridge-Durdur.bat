@echo off
title MusicBridge - Durdur
cd /d "%~dp0"
echo ==============================================================
echo   MusicBridge - Arka Plan Sureclerini Kapat
echo   Eren Teknoloji - 2026
echo ==============================================================
echo.
echo Calisan MusicBridge surecleri kapaniyor...

powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%%server.js%%' OR CommandLine LIKE '%%windows-media-bridge.ps1%%' OR CommandLine LIKE '%%MusicBridge-Tray.ps1%%'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo [TAMAMLANDI] MusicBridge ve tum bagli surecler durduruldu.
ping -n 2 127.0.0.1 >nul
