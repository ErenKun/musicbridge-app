@echo off
title MusicBridge - Baslangictan Kaldir
cd /d "%~dp0"
echo ==============================================================
echo   MusicBridge - Windows Baslangictan Kaldirma
echo   Eren Teknoloji - 2026
echo ==============================================================
echo.
echo MusicBridge Windows Baslangic klasorunden siliniyor...

powershell -NoProfile -Command "$startup = [Environment]::GetFolderPath('Startup'); $file = $startup + '\MusicBridge.lnk'; if (Test-Path $file) { Remove-Item $file -Force; Write-Host 'Kisayol silindi.' } else { Write-Host 'Zaten ekli degildi.' }"

echo.
echo [BASARILI] MusicBridge Windows Baslangicindan kaldirildi.
echo.
pause
