@echo off
title MusicBridge - Durdur
cd /d "%~dp0"
echo ==============================================================
echo   MusicBridge - Arka Plan Sureclerini Kapat
echo   Eren Teknoloji - 2026
echo ==============================================================
echo.
echo Calisan MusicBridge surecleri kapaniyor...

powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.js*' -or $_.CommandLine -like '*windows-media-bridge.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo [TAMAMLANDI] MusicBridge ve tum bagli surecler durduruldu.
timeout /t 2 >nul
