@echo off
title MusicBridge - Baslangicta Calistir Kurulumu
cd /d "%~dp0"
echo ==============================================================
echo   MusicBridge - Windows Baslangicta Calistir Kurulumu
echo   Eren Teknoloji - 2026
echo ==============================================================
echo.
echo MusicBridge Windows Baslangic klasorune ekleniyor...

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $startup = [Environment]::GetFolderPath('Startup'); $s = $ws.CreateShortcut($startup + '\MusicBridge.lnk'); $s.TargetPath = '%~dp0MusicBridge-ArkaPlanda-Baslat.vbs'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Save()"

echo.
echo [BASARILI] MusicBridge Windows Baslangicina eklendi!
echo Bilgisayariniz her acildiginda hicbir acik pencere veya siyah konsol olmadan
echo otomatik olarak arka planda baslayacaktir.
echo.
pause
